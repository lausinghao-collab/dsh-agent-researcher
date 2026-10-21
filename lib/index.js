/**
 * 「资料搜集员」的工具集：图表、来源台账、报告校验、批量检索、本地文档读取。
 *
 * 插件随 agent preset 挂载，把"研究"里容易出错、重复劳动的部分做成工具：
 * 出图、登记来源、检查引用、一次多查询检索、抽取 docx/xlsx/pptx 文本。
 */
import z from '@deepseek-ai/schemastery';
import path from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { CHART_TYPES, renderChart } from './charts.js';
import { extractDocument } from './documents.js';
import {
  addSources,
  emptyLedger,
  lintReport,
  parseLedger,
  serializeLedger,
} from './sources.js';
import { formatResearchResults, mergeResearchResults } from './search.js';

export const name = 'research-tools';

/** 插件所需服务：工具注册表、文件系统、工作目录、联网检索。 */
export const inject = ['tools', 'fs', 'workingDirectory', 'web'];

/** 工具配置：图表目录、来源台账、检索上限、文档字节上限。 */
export const Config = z.object({
  defaultDir: z.string().default('reports/assets'),
  sourcesFile: z.string().default('reports/sources.json'),
  searchMaxQueries: z.number().default(6),
  sourcesVerifyLimit: z.number().default(20),
  maxDocumentBytes: z.number().default(31457280),
});

const STYLE_DOC = [
  'bar：柱状图，比较同量纲分类的大小（data.items 或 data.labels+values）',
  'hbar：条形图/排行榜，分类多或名称长时优先（data.items）',
  'line：折线图，时间趋势（data.labels + data.values 或 data.series）',
  'area：面积图，趋势与累计量（同上）',
  'donut：环形图，占比结构（data.items，需正数）',
  'stacked：堆叠柱状图，多系列构成（data.labels + data.series）',
  'waterfall：瀑布图，增量与贡献拆解（data.items，可标 isTotal）',
  'kpi：指标卡，2–6 个关键数字（data.items，可带 delta/note）',
  'scatter：散点图，两个数值变量的相关性（data.points: [{x,y,label?}]）',
].join('\n');

function pad(value) {
  return String(value).padStart(2, '0');
}

function timestampName() {
  const now = new Date();
  return `chart-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function resolveTarget(ctx, exec, filePath) {
  const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal);
  const target = await ctx.fs.resolve(filePath, { cwd, signal: exec.signal });
  return { cwd, target };
}

async function readTextFile(ctx, exec, filePath) {
  const { cwd, target } = await resolveTarget(ctx, exec, filePath);
  const info = await ctx.fs.stat(target, exec.signal);
  if (info === undefined || info.type !== 'file') throw new Error(`找不到文件：${filePath}`);
  return { cwd, target, text: await ctx.fs.readText(target, exec.signal), absolute: ctx.fs.processPath(target) };
}

async function fileExists(ctx, exec, absolutePath) {
  try {
    const target = await ctx.fs.resolve(absolutePath, { signal: exec.signal });
    return (await ctx.fs.stat(target, exec.signal)) !== undefined;
  } catch {
    return false;
  }
}

async function loadLedger(ctx, exec, ledgerPath) {
  const { cwd, target } = await resolveTarget(ctx, exec, ledgerPath);
  const info = await ctx.fs.stat(target, exec.signal);
  if (info === undefined) return { ledger: emptyLedger(), cwd, target };
  const text = await ctx.fs.readText(target, exec.signal);
  return { ledger: parseLedger(text), cwd, target };
}

function bulletList(items) {
  return items
    .map((item) => `- [${item.level}] ${item.message}`)
    .join('\n');
}

/** 注册 write_chart 工具。 */
export function apply(ctx, config = {}) {
  const defaultDir = config.defaultDir ?? 'reports/assets';

  ctx.tools.register(
    defineTool({
      name: 'write_chart',
      description: [
        'Render a data series into a styled, standalone SVG chart file in the session workspace.',
        'Prefer this over hand-writing SVG: it produces consistent Chinese-friendly typography,',
        'axes, legends, value labels and a data-source footnote. Use it when a report needs',
        'a chart, then reference the written file from Markdown.',
        '',
        'Supported styles:',
        STYLE_DOC,
        '',
        'After writing, embed the chart in the report with `![图注](相对路径.svg)` and keep the',
        'numbers identical to the report text. Provide `source` so the chart carries its provenance.',
        'Do not invent data points: charts must reflect verified figures.',
      ].join('\n'),
      parameters: {
        type: {
          type: 'string',
          required: true,
          enum: CHART_TYPES,
          description: 'Chart style: one of the supported styles listed in the description.',
        },
        title: { type: 'string', required: true, description: 'Chart title, written in the user language.' },
        file_path: {
          type: 'string',
          description: 'Output path relative to the session working directory, e.g. reports/assets/指数涨幅.svg. Defaults to <defaultDir>/<timestamp>.svg.',
        },
        data: {
          type: 'object',
          required: true,
          additionalProperties: false,
          description: 'Chart data. Shape depends on style: items/labels+values/series/points.',
          properties: {
            items: {
              type: 'array',
              description: 'Categorical data: [{label, value, isTotal?, delta?, note?}]',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  label: { type: 'string', required: true },
                  value: { type: 'number', required: true },
                  isTotal: { type: 'boolean' },
                  delta: { type: 'string' },
                  note: { type: 'string' },
                },
              },
            },
            labels: { type: 'array', items: { type: 'string' }, description: 'X-axis categories (line/area/stacked/bar convenience).' },
            values: { type: 'array', items: { type: 'number' }, description: 'Single-series values paired with labels.' },
            series: {
              type: 'array',
              description: 'Multi-series data for line/area/stacked: [{name, values}]',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string', required: true },
                  values: { type: 'array', required: true, items: { type: 'number' } },
                },
              },
            },
            points: {
              type: 'array',
              description: 'Scatter points: [{x, y, label?}]',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  x: { type: 'number', required: true },
                  y: { type: 'number', required: true },
                  label: { type: 'string' },
                },
              },
            },
            x_label: { type: 'string', description: 'Scatter x-axis label.' },
            y_label: { type: 'string', description: 'Scatter y-axis label.' },
            colors: { type: 'array', items: { type: 'string' }, description: 'Optional color overrides (hex), e.g. ["#d6453f","#2f6feb"].' },
          },
        },
        subtitle: { type: 'string', description: 'Optional subtitle under the title.' },
        source: { type: 'string', description: 'Data source footnote shown at the bottom, e.g. "国家统计局 / 2026-06".' },
        note: { type: 'string', description: 'Optional short note shown at the top right.' },
        unit: { type: 'string', description: 'Unit appended to value labels, e.g. "%" or "亿元".' },
        theme: { type: 'string', enum: ['light', 'dark'], description: 'Color theme. Default light.' },
        width: { type: 'number', description: 'SVG width in px. Default 1600.' },
        height: { type: 'number', description: 'SVG height in px. Default 1000 (auto-grows for hbar/kpi).' },
        show_values: { type: 'boolean', description: 'Show value labels on bars/points. Default true for bar/hbar/stacked, false for line/area.' },
        color_by_item: { type: 'boolean', description: 'Color each bar/item with the palette instead of a single accent color.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', required: true, description: 'Absolute path of the written SVG file.' },
            relative_path: { type: 'string', required: true, description: 'Path relative to the session working directory.' },
            type: { type: 'string', required: true },
            bytes: { type: 'integer', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: `Wrote ${value.type} chart (${value.bytes} bytes): ${value.relative_path}\nEmbed it in Markdown relative to the report file (e.g. assets/chart.svg).`,
          },
        ],
      },
      async execute(args, exec) {
        if (exec.agent === undefined) throw new Error('write_chart requires an agent Session');
        const svg = renderChart({
          type: args.type,
          title: args.title,
          subtitle: args.subtitle,
          source: args.source,
          note: args.note,
          unit: args.unit,
          theme: args.theme,
          width: args.width,
          height: args.height,
          showValues: args.show_values,
          colorByItem: args.color_by_item,
          data: args.data,
        });
        const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal);
        const requested = (args.file_path ?? '').trim() || `${defaultDir}/${timestampName()}.svg`;
        const target = await ctx.fs.resolve(requested, { cwd, signal: exec.signal });
        await ctx.fs.writeText(target, svg, undefined, exec.signal);
        const absolute = ctx.fs.processPath(target);
        const relative = path.relative(cwd, absolute).split(path.sep).join('/');
        return {
          path: absolute,
          relative_path: relative,
          type: args.type,
          bytes: Buffer.byteLength(svg, 'utf8'),
        };
      },
    }),
  );

  // ── 来源台账 ────────────────────────────────────────────────────────────
  const sourcesFile = config.sourcesFile ?? 'reports/sources.json';
  const verifyLimit = config.sourcesVerifyLimit ?? 20;

  ctx.tools.register(
    defineTool({
      name: 'sources',
      description: [
        'Maintain the citation ledger of the current research report.',
        '',
        '- action "add": register sources (url required, title/note optional). Returns the assigned [n] index;',
        '  duplicates return the existing index. Call this as soon as a source is verified.',
        '- action "list": show the current ledger.',
        '- action "verify": best-effort check each URL through the web provider and mark reachable/unreachable.',
        '  A failure can mean the site blocks automated access, not that the link is dead.',
        '',
        'The ledger defaults to reports/sources.json. Cite sources in the report as [n] and run',
        '`report_lint` before delivering so every citation is registered and printed.',
      ].join('\n'),
      parameters: {
        action: { type: 'string', required: true, enum: ['add', 'list', 'verify'], description: 'Operation to perform.' },
        entries: {
          type: 'array',
          description: 'Sources to register when action is "add": [{url, title?, note?}]',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              url: { type: 'string', required: true },
              title: { type: 'string' },
              note: { type: 'string', description: 'Optional note, e.g. "国家统计局 2026-06 数据" or page section.' },
            },
          },
        },
        file_path: { type: 'string', description: `Ledger path. Defaults to ${sourcesFile}.` },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        if (exec.agent === undefined) throw new Error('sources requires an agent Session');
        const ledgerPath = (args.file_path ?? '').trim() || sourcesFile;
        const loaded = await loadLedger(ctx, exec, ledgerPath);

        if (args.action === 'list') {
          const { ledger } = loaded;
          if (ledger.sources.length === 0) return `来源台账为空：${ledgerPath}`;
          const lines = ledger.sources.map(
            (item) => `[${item.index}] ${item.title}${item.note ? `（${item.note}）` : ''} — ${item.url} · ${item.status}`,
          );
          return `来源台账（${ledger.sources.length} 条）：${ledgerPath}\n${lines.join('\n')}`;
        }

        if (args.action === 'add') {
          if (!Array.isArray(args.entries) || args.entries.length === 0) {
            throw new Error('action=add 需要 entries 数组');
          }
          const merged = addSources(loaded.ledger, args.entries);
          const content = serializeLedger(merged.ledger);
          await ctx.fs.writeText(loaded.target, content, undefined, exec.signal);
          const lines = [
            ...merged.added.map((item) => `新增 [${item.index}] ${item.title} — ${item.url}`),
            ...merged.existing.map((item) => `已存在 [${item.index}] ${item.title} — ${item.url}`),
          ];
          return `台账已更新（共 ${merged.ledger.sources.length} 条）：${ledgerPath}\n${lines.join('\n')}`;
        }

        // verify
        const { ledger } = loaded;
        if (ledger.sources.length === 0) return `来源台账为空：${ledgerPath}`;
        const targets = ledger.sources.slice(0, verifyLimit);
        const results = [];
        const concurrency = 3;
        for (let start = 0; start < targets.length; start += concurrency) {
          const batch = targets.slice(start, start + concurrency);
          await Promise.all(
            batch.map(async (item) => {
              try {
                await ctx.web.fetch({ url: item.url }, exec.signal);
                item.status = 'reachable';
                results.push(`[${item.index}] reachable — ${item.url}`);
              } catch (error) {
                item.status = 'unreachable';
                results.push(`[${item.index}] unreachable（${String(error?.message ?? error).slice(0, 80)}）— ${item.url}`);
              }
              item.verifiedAt = new Date().toISOString();
            }),
          );
        }
        await ctx.fs.writeText(loaded.target, serializeLedger(ledger), undefined, exec.signal);
        const skipped = ledger.sources.length - targets.length;
        return [
          `核实 ${targets.length} 条来源${skipped > 0 ? `（其余 ${skipped} 条留待下次，上限 ${verifyLimit}）` : ''}：`,
          ...results,
          '',
          '注意：unreachable 只能说明自动访问失败，可能是站点反爬，不等于链接失效。',
        ].join('\n');
      },
    }),
  );

  // ── 报告引用校验 ────────────────────────────────────────────────────────
  ctx.tools.register(
    defineTool({
      name: 'report_lint',
      description: [
        'Validate a Markdown report against its source ledger before delivery:',
        'every [n] citation must exist in the ledger, every registered source should be cited,',
        'the reference section must list full URLs, and local image/chart paths must exist.',
        'Fix the reported errors, then deliver.',
      ].join('\n'),
      parameters: {
        report_path: { type: 'string', required: true, description: 'Markdown report path, relative to the session working directory.' },
        sources_path: { type: 'string', description: `Ledger path. Defaults to ${sourcesFile}.` },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        if (exec.agent === undefined) throw new Error('report_lint requires an agent Session');
        const report = await readTextFile(ctx, exec, args.report_path);
        const ledgerPath = (args.sources_path ?? '').trim() || sourcesFile;
        const loaded = await loadLedger(ctx, exec, ledgerPath);
        const baseDir = path.dirname(report.absolute);
        const existsMap = new Map();
        for (const match of report.text.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
          const ref = match[1];
          if (/^(https?:|data:)/.test(ref)) continue;
          const clean = decodeURI(ref);
          const absolute = path.isAbsolute(clean) ? clean : path.resolve(baseDir, clean);
          existsMap.set(clean, await fileExists(ctx, exec, absolute));
        }
        const result = lintReport({
          markdown: report.text,
          ledger: loaded.ledger,
          baseDir,
          exists: (_base, relative) => existsMap.get(relative) === true,
        });
        const errors = result.issues.filter((issue) => issue.level === 'error');
        const warnings = result.issues.filter((issue) => issue.level === 'warning');
        const header = `报告：${args.report_path}｜引用编号：${result.cited.length > 0 ? result.cited.join(', ') : '无'}｜台账：${loaded.ledger.sources.length} 条`;
        const body = result.issues.length > 0 ? `\n\n${bulletList(result.issues)}` : '';
        const verdict = result.ok
          ? `校验通过（错误 0，警告 ${warnings.length}）`
          : `校验未通过：错误 ${errors.length} 条，警告 ${warnings.length} 条`;
        return `${header}\n${verdict}${body}${errors.length > 0 ? '\n\n请修正错误后再交付。' : ''}`;
      },
    }),
  );

  // ── 批量检索 ────────────────────────────────────────────────────────────
  const searchMaxQueries = config.searchMaxQueries ?? 6;

  ctx.tools.register(
    defineTool({
      name: 'research_search',
      description: [
        'Run several web search queries at once and return one deduplicated, compact source list.',
        'Use it for multi-angle research instead of calling web_search repeatedly:',
        'write 2-5 complementary queries (different keywords / angles / languages),',
        'optionally constraining domains, then fetch the promising pages with web_fetch.',
      ].join('\n'),
      parameters: {
        queries: {
          type: 'array',
          required: true,
          description: `Search queries (1-${searchMaxQueries}), each a different angle.`,
          items: { type: 'string' },
        },
        max_results: { type: 'number', description: 'Merged result cap. Default 8.' },
        allow_domains: { type: 'array', description: 'Optional allowlist, e.g. ["gov.cn","stats.gov.cn"]', items: { type: 'string' } },
        block_domains: { type: 'array', description: 'Optional blocklist, e.g. ["zhihu.com"]', items: { type: 'string' } },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        const queries = Array.isArray(args.queries) ? args.queries.map((query) => String(query).trim()).filter(Boolean) : [];
        if (queries.length === 0) throw new Error('research_search 需要至少 1 条查询');
        if (queries.length > searchMaxQueries) throw new Error(`一次最多 ${searchMaxQueries} 条查询，当前 ${queries.length} 条`);
        const maxResults = Math.min(20, Math.max(1, Math.round(args.max_results ?? 8)));
        const failures = [];
        const results = await Promise.all(
          queries.map(async (query) => {
            try {
              return await ctx.web.search({ query, maxResults: maxResults * 2 }, exec.signal);
            } catch (error) {
              failures.push(`「${query}」：${String(error?.message ?? error).slice(0, 120)}`);
              return { sources: [] };
            }
          }),
        );
        const merged = mergeResearchResults({
          queries,
          results,
          maxResults,
          allowDomains: Array.isArray(args.allow_domains) ? args.allow_domains : [],
          blockDomains: Array.isArray(args.block_domains) ? args.block_domains : [],
        });
        const header = `执行 ${queries.length} 条查询；合并去重后 ${merged.results.length} 条来源${
          merged.filteredByDomain > 0 ? `（域名过滤 ${merged.filteredByDomain} 条）` : ''
        }。`;
        const failureNote = failures.length > 0 ? `\n\n失败的查询：\n${failures.map((item) => `- ${item}`).join('\n')}` : '';
        if (merged.results.length === 0) throw new Error(`${header}没有可用结果。${failureNote}`);
        return `${header}\n\n${formatResearchResults(merged.results)}${failureNote}\n\n需要原文时，用 web_fetch 打开上面最相关的链接；核实后把来源登记到 sources。`;
      },
    }),
  );

  // ── 本地文档读取 ────────────────────────────────────────────────────────
  const maxDocumentBytes = config.maxDocumentBytes ?? 31457280;

  ctx.tools.register(
    defineTool({
      name: 'read_document',
      description: [
        'Extract readable text from a local document in the session workspace.',
        'Supports docx, xlsx (each sheet rendered as a Markdown table), pptx, csv, tsv, txt, md, json.',
        'PDF is not parsed yet: ask the user to convert it to docx/txt, or provide key pages as text.',
        'Use it before searching the web when the user supplies local materials.',
      ].join('\n'),
      parameters: {
        file_path: { type: 'string', required: true, description: 'Document path, relative to the session working directory.' },
        max_chars: { type: 'number', description: 'Text cap returned to the model. Default 20000, max 100000.' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        if (exec.agent === undefined) throw new Error('read_document requires an agent Session');
        const { target, absolute } = await resolveTarget(ctx, exec, args.file_path);
        const info = await ctx.fs.stat(target, exec.signal);
        if (info === undefined || info.type !== 'file') throw new Error(`找不到文件：${args.file_path}`);
        if (info.size !== undefined && info.size > maxDocumentBytes) {
          throw new Error(`文件太大（${info.size} 字节），上限 ${maxDocumentBytes} 字节`);
        }
        const bytes = await ctx.fs.readBytes(target, exec.signal, maxDocumentBytes);
        const extracted = extractDocument(bytes, args.file_path);
        const limit = Math.min(100000, Math.max(1000, Math.round(args.max_chars ?? 20000)));
        const truncated = extracted.text.length > limit;
        const text = truncated ? extracted.text.slice(0, limit) : extracted.text;
        const meta = [];
        if (extracted.kind === 'xlsx') {
          const sheets = extracted.meta?.sheets;
          if (Array.isArray(sheets)) meta.push(`工作表：${sheets.map((sheet) => sheet.name).join(' / ')}`);
        }
        if (extracted.kind === 'pptx' && extracted.meta?.slides) meta.push(`幻灯片：${extracted.meta.slides} 页`);
        meta.push(`字符数：${extracted.text.length}${truncated ? `（已截断到 ${limit}）` : ''}`);
        return `文件：${absolute}\n类型：${extracted.kind}｜${meta.join('｜')}\n\n${text}`;
      },
    }),
  );
}
