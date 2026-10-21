import test from 'node:test';
import assert from 'node:assert/strict';
import { renderChart, CHART_TYPES, formatNumber, niceTicks } from '../lib/charts.js';

const TITLE = '2026 年上半年 A 股主要指数涨跌幅';
const SOURCE = '示例来源 / 2026-06-30';

function assertSvg(svg) {
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="\d+" viewBox="0 0 \d+ \d+"/);
  assert.ok(svg.trimEnd().endsWith('</svg>'));
  assert.ok(!svg.includes('NaN'), 'SVG 不应包含 NaN');
  assert.ok(!svg.includes('undefined'), 'SVG 不应包含 undefined');
  assert.ok(!svg.includes('Infinity'), 'SVG 不应包含 Infinity');
  assert.ok(svg.includes('数据来源：'), '应包含来源脚注');
}

const categories = () => ({
  items: [
    { label: '科创50', value: 64.25 },
    { label: '创业板指', value: 35.58 },
    { label: '上证指数', value: 3.16 },
    { label: '上证50', value: -1.38 },
  ],
});

test('支持全部图表样式且输出合法 SVG', () => {
  const specs = {
    bar: { type: 'bar', unit: '%', data: categories() },
    hbar: { type: 'hbar', unit: '%', data: categories() },
    line: {
      type: 'line',
      data: {
        labels: ['1月', '2月', '3月', '4月', '5月', '6月'],
        series: [
          { name: '上证指数', values: [4010, 4190, 3795, 4112, 4069, 4094] },
          { name: '创业板指', values: [3300, 3400, 3150, 3600, 3900, 4343] },
        ],
      },
    },
    area: {
      type: 'area',
      data: {
        labels: ['1月', '2月', '3月', '4月', '5月', '6月'],
        values: [4010, 4190, 3795, 4112, 4069, 4094],
      },
    },
    donut: {
      type: 'donut',
      unit: '%',
      data: { items: [{ label: '电子', value: 38 }, { label: '通信', value: 21 }, { label: '机械设备', value: 16 }, { label: '其他', value: 25 }] },
    },
    stacked: {
      type: 'stacked',
      data: {
        labels: ['2024', '2025', '2026E'],
        series: [
          { name: '算力', values: [120, 210, 320] },
          { name: '存储', values: [80, 130, 190] },
          { name: '其他', values: [60, 70, 85] },
        ],
      },
    },
    waterfall: {
      type: 'waterfall',
      unit: '亿元',
      data: {
        items: [
          { label: '2025 收入', value: 1000, isTotal: true },
          { label: '算力', value: 260 },
          { label: '存储', value: 120 },
          { label: '传统业务', value: -90 },
          { label: '2026 收入', value: 1290, isTotal: true },
        ],
      },
    },
    kpi: {
      type: 'kpi',
      data: {
        items: [
          { label: '上证指数', value: 4094.4, delta: '+3.16%', note: '2026 H1' },
          { label: '科创50', value: 64.25, delta: '+64.25%', note: '上半年' },
          { label: '个股上涨占比', value: 32, delta: '-14.99% 中位数', note: '5528 只' },
          { label: '两融余额', value: 30037, delta: '+18%', note: '亿元' },
        ],
      },
    },
    scatter: {
      type: 'scatter',
      data: {
        points: [
          { x: 3.16, y: 32, label: '上证' },
          { x: 19.82, y: 48, label: '深成指' },
          { x: 35.58, y: 62, label: '创业板' },
          { x: 64.25, y: 78, label: '科创50' },
        ],
        x_label: '指数涨跌幅（%）',
        y_label: '上涨个股占比（%）',
      },
    },
  };

  assert.deepEqual(Object.keys(specs).sort(), [...CHART_TYPES].sort());
  for (const [type, spec] of Object.entries(specs)) {
    const svg = renderChart({ title: `${TITLE} · ${type}`, source: SOURCE, theme: 'light', ...spec });
    assertSvg(svg);
  }
});

test('标题与文字做 XML 转义', () => {
  const svg = renderChart({
    type: 'bar',
    title: 'A & B <测试> "引号"',
    source: 'S & T',
    data: categories(),
  });
  assert.ok(svg.includes('A &amp; B &lt;测试&gt; &quot;引号&quot;'));
  assert.ok(svg.includes('数据来源：S &amp; T'));
});

test('深色主题与自定义颜色生效', () => {
  const svg = renderChart({
    type: 'bar',
    title: TITLE,
    source: SOURCE,
    theme: 'dark',
    colorByItem: true,
    data: { ...categories(), colors: ['#ff0000', '#00ff00'] },
  });
  assertSvg(svg);
  assert.ok(svg.includes('#ff0000'));
  assert.ok(svg.includes('#00ff00'));
});

test('环形图与堆叠图在多系列/多分类下不产生 NaN', () => {
  const donut = renderChart({ type: 'donut', title: TITLE, source: SOURCE, data: categories() });
  assertSvg(donut);
  const stacked = renderChart({
    type: 'stacked',
    title: TITLE,
    source: SOURCE,
    data: { labels: ['A', 'B'], series: [{ name: 'S1', values: [1, 2] }, { name: 'S2', values: [3, 4] }] },
  });
  assertSvg(stacked);
});

test('缺少或非法数据给出明确错误', () => {
  assert.throws(() => renderChart({ type: 'bar', title: TITLE, data: {} }), /缺少数据/);
  assert.throws(() => renderChart({ type: 'hbar', title: TITLE, data: { items: [{ label: 'x', value: 'abc' }] } }), /label/);
  assert.throws(() => renderChart({ type: 'donut', title: TITLE, data: { items: [{ label: 'x', value: 0 }] } }), /正数/);
  assert.throws(() => renderChart({ type: 'scatter', title: TITLE, data: { points: [] } }), /散点图/);
  assert.throws(() => renderChart({ type: 'nope', title: TITLE, data: categories() }), /不支持的图表样式/);
  assert.throws(() => renderChart({ type: 'bar', title: '', data: categories() }), /title/);
});

test('条形图按行数自动增高', () => {
  const many = Array.from({ length: 24 }, (_, index) => ({ label: `行业 ${index + 1}`, value: index + 1 }));
  const svg = renderChart({ type: 'hbar', title: TITLE, source: SOURCE, data: { items: many } });
  const match = /height="(\d+)"/.exec(svg);
  assert.ok(match && Number(match[1]) > 1000, '24 行条形图应高于默认高度');
});

test('formatNumber 与 niceTicks 基本行为', () => {
  assert.equal(formatNumber(1234.5), '1234.5');
  assert.equal(formatNumber(12345), '1.23万');
  assert.equal(formatNumber(123456789), '1.23亿');
  assert.equal(formatNumber(3.16, '%'), '3.16%');
  const scale = niceTicks(0, 64.25, 5);
  assert.ok(scale.ticks.length >= 4);
  assert.equal(scale.ticks[0], 0);
  assert.ok(scale.max >= 64.25);
});
