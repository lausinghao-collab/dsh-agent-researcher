import test from 'node:test';
import assert from 'node:assert/strict';
import { formatResearchResults, mergeResearchResults } from '../lib/search.js';

const results = [
  { sources: [{ title: '官方数据', url: 'https://stats.gov.cn/a' }, { title: '媒体 A', url: 'https://news.example.com/1' }] },
  { sources: [{ title: '重复来源', url: 'https://stats.gov.cn/a#section' }, { title: '媒体 B', url: 'https://news.example.com/2' }] },
];

test('mergeResearchResults：跨查询去重并保留元数据', () => {
  const merged = mergeResearchResults({ queries: ['q1', 'q2'], results, maxResults: 10 });
  assert.equal(merged.results.length, 3);
  assert.equal(merged.results[0].title, '官方数据');
  assert.equal(merged.results[0].query, 'q1');
  assert.equal(merged.duplicateOrOverflow, 1);
  assert.ok(merged.results.every((item) => item.url.startsWith('https://')));
});

test('mergeResearchResults：域名白名单与黑名单', () => {
  const allow = mergeResearchResults({ queries: ['q1', 'q2'], results, maxResults: 10, allowDomains: ['gov.cn'] });
  assert.deepEqual(allow.results.map((item) => item.url), ['https://stats.gov.cn/a']);

  const block = mergeResearchResults({ queries: ['q1', 'q2'], results, maxResults: 10, blockDomains: ['stats.gov.cn'] });
  assert.equal(block.results.length, 2);
  assert.ok(block.results.every((item) => !item.url.includes('stats.gov.cn')));
});

test('mergeResearchResults：结果上限', () => {
  const merged = mergeResearchResults({ queries: ['q1', 'q2'], results, maxResults: 2 });
  assert.equal(merged.results.length, 2);
});

test('formatResearchResults 输出标题、URL 与摘要', () => {
  const merged = mergeResearchResults({
    queries: ['q1'],
    results: [{ sources: [{ title: '标题', url: 'https://a.example.com/x', snippet: '摘要内容', publishedAt: '2026-06-30' }] }],
  });
  const text = formatResearchResults(merged.results);
  assert.match(text, /1\. 标题/);
  assert.match(text, /https:\/\/a\.example\.com\/x/);
  assert.match(text, /日期：2026-06-30/);
  assert.match(text, /摘要内容/);
});
