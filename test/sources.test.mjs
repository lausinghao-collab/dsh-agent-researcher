import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addSources,
  emptyLedger,
  lintReport,
  normalizeUrl,
  parseLedger,
  referenceList,
  serializeLedger,
} from '../lib/sources.js';

test('normalizeUrl 补协议、去 fragment、统一 host', () => {
  assert.equal(normalizeUrl('Example.COM/a#x'), 'https://example.com/a');
  assert.equal(normalizeUrl('https://example.com:443/a'), 'https://example.com/a');
  assert.equal(normalizeUrl('http://example.com:80/'), 'http://example.com/');
  assert.equal(normalizeUrl('  '), '');
});

test('台账解析与序列化', () => {
  const ledger = emptyLedger();
  const merged = addSources(ledger, [
    { url: 'https://a.example.com/x', title: '来源 A' },
    { url: 'https://b.example.com/y', note: '备注' },
  ]);
  assert.equal(merged.ledger.sources.length, 2);
  assert.deepEqual(merged.added.map((item) => item.index), [1, 2]);

  const round = parseLedger(serializeLedger(merged.ledger));
  assert.equal(round.sources.length, 2);
  assert.equal(round.sources[0].title, '来源 A');
  assert.match(referenceList(round), /1\. 来源 A — https:\/\/a\.example\.com\/x/);

  const again = addSources(round, [
    { url: 'https://a.example.com/x', title: '新标题' },
    { url: 'https://c.example.com/z' },
  ]);
  assert.equal(again.added.length, 1);
  assert.equal(again.existing.length, 1);
  assert.equal(again.ledger.sources.length, 3);
  assert.equal(again.ledger.sources[0].title, '新标题');
});

test('parseLedger 拒绝错误结构', () => {
  assert.throws(() => parseLedger('{"foo":1}'), /sources/);
  assert.throws(() => parseLedger('not json'), SyntaxError);
});

function ledgerWith(urls) {
  return addSources(
    emptyLedger(),
    urls.map((url, index) => ({ url, title: `来源 ${index + 1}` })),
  ).ledger;
}

test('lintReport：引用、来源清单与图片检查', () => {
  const ledger = ledgerWith(['https://a.example.com/x', 'https://b.example.com/y']);
  const good = [
    '# 报告',
    '',
    '结论见 [1]，补充见 [2]。',
    '',
    '![图表](assets/chart.svg)',
    '',
    '## 参考来源',
    '',
    '1. 来源 A — https://a.example.com/x',
    '2. 来源 B — https://b.example.com/y',
  ].join('\n');
  const result = lintReport({
    markdown: good,
    ledger,
    exists: (_base, relative) => relative === 'assets/chart.svg',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.cited, [1, 2]);
  assert.equal(result.issues.filter((issue) => issue.level === 'error').length, 0);

  const missing = lintReport({ markdown: '结论见 [3]', ledger, exists: () => true });
  assert.equal(missing.ok, false);
  assert.ok(missing.issues.some((issue) => issue.level === 'error' && /\[3\]/.test(issue.message)));

  const uncited = lintReport({
    markdown: '结论见 [1]\n\n## 参考来源\n\n1. https://a.example.com/x',
    ledger,
    exists: () => true,
  });
  assert.ok(uncited.issues.some((issue) => issue.level === 'warning' && /没有引用/.test(issue.message)));

  const brokenImage = lintReport({
    markdown: good,
    ledger,
    exists: () => false,
  });
  assert.equal(brokenImage.ok, false);
  assert.ok(brokenImage.issues.some((issue) => /图片不存在/.test(issue.message)));

  const noRefSection = lintReport({ markdown: '结论见 [1]', ledger, exists: () => true });
  assert.ok(noRefSection.issues.some((issue) => /参考来源/.test(issue.message)));
});

test('lintReport：解析 [1-3] 与 [1,2] 形式', () => {
  const ledger = ledgerWith(['https://a.example.com/1', 'https://a.example.com/2', 'https://a.example.com/3']);
  const result = lintReport({
    markdown: '甲 [1-3]，乙 [1,2]',
    ledger,
    exists: () => true,
  });
  assert.deepEqual(result.cited, [1, 2, 3]);
});
