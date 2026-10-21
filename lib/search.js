/** 批量检索的合并、去重与域名过滤（纯函数，便于测试）。 */
import { normalizeUrl } from './sources.js';

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function matchesDomain(host, domain) {
  const target = String(domain ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  if (!target) return false;
  return host === target || host.endsWith(`.${target}`);
}

/**
 * 合并多次搜索的结果：按 URL 去重、过滤域名、截断摘要并限制数量。
 * @param {object} input
 * @param {string[]} input.queries
 * @param {Array<{sources?: Array<{title?: string, url?: string, snippet?: string, date?: string}>}>} input.results - 与 queries 对齐的搜索结果
 * @param {number} [input.maxResults]
 * @param {string[]} [input.allowDomains]
 * @param {string[]} [input.blockDomains]
 */
export function mergeResearchResults({ queries, results, maxResults = 10, allowDomains = [], blockDomains = [] }) {
  const merged = [];
  const seen = new Set();
  let dropped = 0;
  let filtered = 0;

  const lists = (results ?? []).map((result, index) => ({ sources: result?.sources ?? [], query: queries?.[index] ?? '' }));
  const maxLen = Math.max(0, ...lists.map((list) => list.sources.length));
  for (let rank = 0; rank < maxLen; rank++) {
    for (const list of lists) {
      const source = list.sources[rank];
      if (!source || typeof source.url !== 'string' || !source.url) continue;
      const url = normalizeUrl(source.url);
      if (!url || seen.has(url)) {
        dropped++;
        continue;
      }
      const host = hostOf(url);
      if (allowDomains.length > 0 && !allowDomains.some((domain) => matchesDomain(host, domain))) {
        filtered++;
        continue;
      }
      if (blockDomains.some((domain) => matchesDomain(host, domain))) {
        filtered++;
        continue;
      }
      seen.add(url);
      if (merged.length >= maxResults) {
        dropped++;
        continue;
      }
      merged.push({
        title: typeof source.title === 'string' && source.title.trim() ? source.title.trim() : url,
        url,
        snippet: typeof source.snippet === 'string' ? source.snippet.replace(/\s+/g, ' ').trim().slice(0, 240) : '',
        date: typeof source.publishedAt === 'string' ? source.publishedAt : typeof source.date === 'string' ? source.date : '',
        query: list.query,
      });
    }
  }

  return { results: merged, duplicateOrOverflow: dropped, filteredByDomain: filtered };
}

/** 把合并结果格式化为紧凑文本，便于模型直接引用。 */
export function formatResearchResults(results) {
  return results
    .map((item, index) => {
      const meta = [item.date ? `日期：${item.date}` : '', item.snippet].filter(Boolean).join(' · ');
      return `${index + 1}. ${item.title}\n   ${item.url}${meta ? `\n   ${meta}` : ''}`;
    })
    .join('\n\n');
}
