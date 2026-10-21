/**
 * write_chart：把数据渲染成多风格 SVG 图表并写入会话工作区。
 *
 * 这个插件随「资料搜集员」agent preset 一起挂载，给模型一个比手写 SVG 更可靠的
 * 出图方式：模型只负责给结构化数据，样式、坐标轴、图例、标注、来源脚注由
 * lib/charts.js 统一生成。
 */
import z from '@deepseek-ai/schemastery';
import path from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { CHART_TYPES, renderChart } from './charts.js';

export const name = 'tool-chart';

/** 插件所需服务：工具注册表、文件系统、会话工作目录。 */
export const inject = ['tools', 'fs', 'workingDirectory'];

/** 图表文件默认输出目录（相对会话工作目录）。 */
export const Config = z.object({
  defaultDir: z.string().default('reports/assets'),
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
}
