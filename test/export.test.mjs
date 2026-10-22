import test from 'node:test';
import assert from 'node:assert/strict';
import { formatFromPath, toDelimited } from '../lib/table.js';
import { REPORT_TEMPLATES, scaffoldReport, TEMPLATE_NAMES } from '../lib/templates.js';
import { renderMarkdownToHtml, wrapHtml } from '../lib/html.js';
import { addSources, emptyLedger, formatReferences } from '../lib/sources.js';

test('CSV：引号、逗号、换行转义', () => {
  const csv = toDelimited(
    ['名称', '说明'],
    [
      ['上证指数', '含,逗号'],
      ['科创50', '含"引号"'],
      ['多行', '第一行\n第二行'],
    ],
    ',',
  );
  assert.match(csv, /^名称,说明\r\n/);
  assert.match(csv, /"含,逗号"/);
  assert.match(csv, /"含""引号"""/);
  assert.match(csv, /"第一行\n第二行"/);
});

test('TSV：替换制表符与换行，按扩展名推断格式', () => {
  const tsv = toDelimited(['a', 'b'], [['x\ty', 'p\nq']], '\t');
  assert.equal(tsv, 'a\tb\r\nx y\tp q\r\n');
  assert.equal(formatFromPath('data.tsv'), 'tsv');
  assert.equal(formatFromPath('data.csv'), 'csv');
  assert.equal(formatFromPath('data.txt'), 'csv');
});

test('表格列数不一致时报错', () => {
  assert.throws(() => toDelimited(['a'], [['1', '2']], ','), /超过表头的/);
  assert.throws(() => toDelimited([], [[]], ','), /headers/);
});

test('报告模板：已知模板生成骨架，未知模板报错', () => {
  assert.deepEqual(TEMPLATE_NAMES.sort(), Object.keys(REPORT_TEMPLATES).sort());
  const md = scaffoldReport({ template: 'policy_brief', topic: '固态电池政策', date: '2026-10-22', citation: 'GB/T 7714' });
  assert.match(md, /^# 固态电池政策｜政策简报/);
  assert.match(md, /## 1\. 摘要/);
  assert.match(md, /参考来源/);
  assert.match(md, /GB\/T 7714/);
  assert.throws(() => scaffoldReport({ template: 'nope' }), /未知模板/);
});

test('HTML：渲染标题、表格、列表、链接与代码', () => {
  const md = [
    '# 报告标题',
    '',
    '**加粗** 与 `code`，[链接](https://example.com/a)。',
    '',
    '| 指标 | 数值 |',
    '| --- | --- |',
    '| 上证指数 | 4094.4 |',
    '',
    '- 条目一',
    '- 条目二',
    '',
    '```js',
    'const a = 1 < 2;',
    '```',
  ].join('\n');
  const html = renderMarkdownToHtml(md);
  assert.match(html, /<h1>报告标题<\/h1>/);
  assert.match(html, /<strong>加粗<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<a href="https:\/\/example\.com\/a"/);
  assert.match(html, /<table><thead><tr><th>指标<\/th>/);
  assert.match(html, /<ul><li>条目一<\/li><li>条目二<\/li><\/ul>/);
  assert.match(html, /1 &lt; 2/);
  assert.ok(!html.includes('\n# '));
});

test('HTML：图片解析器可内联 SVG，wrapHtml 输出完整文档', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>数据来源：示例</text></svg>';
  const html = renderMarkdownToHtml('![图](a.svg)', {
    resolveAsset: (src) => (src === 'a.svg' ? svg : undefined),
  });
  assert.match(html, /<svg xmlns=/);
  const doc = wrapHtml({ title: '标题', subtitle: '副标题', body: html });
  assert.match(doc, /^<!DOCTYPE html>/);
  assert.match(doc, /<title>标题<\/title>/);
  assert.match(doc, /副标题/);
});

test('参考文献格式：numeric / gbt7714 / apa', () => {
  const ledger = addSources(emptyLedger(), [
    { url: 'https://a.example.com/x', title: '来源 A', note: '国家统计局' },
  ]).ledger;
  const numeric = formatReferences(ledger.sources, 'numeric');
  assert.match(numeric, /^1\. 来源 A（国家统计局） — https:\/\/a\.example\.com\/x$/);
  const gbt = formatReferences(ledger.sources, 'gbt7714');
  assert.match(gbt, /\[EB\/OL\]/);
  assert.match(gbt, /https:\/\/a\.example\.com\/x/);
  const apa = formatReferences(ledger.sources, 'apa');
  assert.match(apa, /Retrieved/);
  assert.match(apa, /from https:\/\/a\.example\.com\/x/);
});
