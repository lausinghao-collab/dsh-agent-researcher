/** 来源台账与引用校验（纯函数，便于测试）。 */

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** 规范化 URL：补协议、去掉 fragment、统一 host 大小写。 */
export function normalizeUrl(input) {
  const raw = String(input ?? '').trim();
  if (raw === '') return '';
  // 允许直接写 github.com/xxx 这类无协议地址
  const withScheme = SCHEME.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
    return url.toString();
  } catch {
    return raw;
  }
}

/** 新建空台账。 */
export function emptyLedger() {
  return { version: 1, updatedAt: new Date().toISOString(), sources: [] };
}

/** 解析台账 JSON 文本，容忍空文件；结构不合法时抛错。 */
export function parseLedger(text) {
  if (!text || text.trim() === '') return emptyLedger();
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || !Array.isArray(data.sources)) {
    throw new Error('来源台账格式不正确：缺少 sources 数组');
  }
  const sources = data.sources
    .filter((item) => item && typeof item.url === 'string' && item.url)
    .map((item, position) => ({
      index: Number.isInteger(item.index) && item.index > 0 ? item.index : position + 1,
      url: normalizeUrl(item.url),
      title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : normalizeUrl(item.url),
      note: typeof item.note === 'string' ? item.note : '',
      addedAt: typeof item.addedAt === 'string' ? item.addedAt : '',
      verifiedAt: typeof item.verifiedAt === 'string' ? item.verifiedAt : '',
      status: typeof item.status === 'string' ? item.status : 'unverified',
      httpCode: Number.isInteger(item.httpCode) ? item.httpCode : undefined,
    }))
    .sort((a, b) => a.index - b.index);
  return { version: 1, updatedAt: data.updatedAt ?? '', sources };
}

/** 台账序列化。 */
export function serializeLedger(ledger) {
  return JSON.stringify({ ...ledger, updatedAt: new Date().toISOString() }, null, 2) + '\n';
}

/**
 * 追加来源（按 URL 去重），返回新增与已存在条目。
 * @param {object} ledger - parseLedger 的返回值。
 * @param {Array<{url: string, title?: string, note?: string}>} entries
 */
export function addSources(ledger, entries) {
  const sources = ledger.sources.map((item) => ({ ...item }));
  const added = [];
  const existing = [];
  let nextIndex = sources.reduce((max, item) => Math.max(max, item.index), 0) + 1;
  for (const entry of entries) {
    const url = normalizeUrl(entry?.url);
    if (!url) throw new Error('来源条目缺少 url');
    const found = sources.find((item) => item.url === url);
    if (found) {
      if (typeof entry.title === 'string' && entry.title.trim() && entry.title.trim() !== found.title) {
        found.title = entry.title.trim();
      }
      if (typeof entry.note === 'string' && entry.note.trim()) {
        found.note = found.note ? `${found.note}；${entry.note.trim()}` : entry.note.trim();
      }
      existing.push({ index: found.index, url: found.url, title: found.title });
      continue;
    }
    const item = {
      index: nextIndex++,
      url,
      title: typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim() : url,
      note: typeof entry.note === 'string' ? entry.note.trim() : '',
      addedAt: new Date().toISOString(),
      verifiedAt: '',
      status: 'unverified',
    };
    sources.push(item);
    added.push({ index: item.index, url: item.url, title: item.title });
  }
  return { ledger: { version: 1, updatedAt: new Date().toISOString(), sources }, added, existing };
}

/** Markdown 报告引用校验。 */
export function lintReport({ markdown, ledger, baseDir = '', exists = () => false }) {
  const text = String(markdown ?? '');
  const sources = ledger?.sources ?? [];
  const issues = [];
  const refHeading = /^#{1,6}\s*(.*(参考来源|参考文献|参考文献列表|Sources|References|引用来源).*)$/im.exec(text);
  const body = refHeading ? text.slice(0, refHeading.index) : text;
  const refSection = refHeading ? text.slice(refHeading.index) : '';

  const cited = parseCitations(body);
  const registered = new Map(sources.map((item) => [item.index, item]));

  for (const index of [...cited].sort((a, b) => a - b)) {
    if (!registered.has(index)) {
      issues.push({ level: 'error', message: `正文引用了 [${index}]，但来源台账里没有这一条` });
    }
  }
  const uncited = sources.filter((item) => !cited.has(item.index));
  for (const item of uncited) {
    issues.push({
      level: 'warning',
      message: `来源 [${item.index}] ${item.title} 已登记，但正文没有引用它`,
    });
  }

  if (cited.size > 0 && !refHeading) {
    issues.push({ level: 'error', message: '正文有引用编号，但找不到「参考来源 / 参考文献」章节' });
  }

  const refUrls = new Set();
  if (refSection) {
    for (const match of refSection.matchAll(/https?:\/\/[^\s)>"'`<>]+/g)) refUrls.add(normalizeUrl(match[0]));
    if (refUrls.size === 0 && sources.length > 0) {
      issues.push({ level: 'error', message: '参考来源章节里没有可点击的完整 URL' });
    }
    for (const item of sources) {
      if (!refUrls.has(item.url)) {
        issues.push({ level: 'warning', message: `来源 [${item.index}] 的 URL 没有出现在参考来源清单里：${item.url}` });
      }
    }
  }

  // 台账 URL 重复
  const seen = new Set();
  for (const item of sources) {
    if (seen.has(item.url)) issues.push({ level: 'warning', message: `来源台账里 URL 重复：[${item.index}] ${item.url}` });
    seen.add(item.url);
  }

  // 图片（含图表）引用必须存在
  for (const match of body.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const ref = match[1];
    if (/^(https?:|data:)/.test(ref)) continue;
    const clean = decodeURI(ref);
    if (!exists(baseDir, clean)) {
      issues.push({ level: 'error', message: `正文引用的图片不存在：${clean}` });
    }
  }

  return {
    ok: !issues.some((issue) => issue.level === 'error'),
    cited: [...cited].sort((a, b) => a - b),
    registered: sources.map((item) => item.index),
    issues,
  };
}

/** 从正文里解析 [1]、[1,2]、[1-3] 形式的引用编号。 */
export function parseCitations(text) {
  const indices = new Set();
  for (const match of text.matchAll(/\[([0-9][0-9\s,，、\-–—]*)\]/g)) {
    for (const segment of match[1].split(/[,，、]/)) {
      const parts = segment
        .split(/[-–—]/)
        .map((part) => Number.parseInt(part.trim(), 10))
        .filter((value) => Number.isFinite(value));
      if (parts.length === 2) {
        const [start, end] = parts;
        for (let index = start; index <= end && index - start < 200; index++) indices.add(index);
      } else {
        for (const value of parts) indices.add(value);
      }
    }
  }
  return indices;
}

/** 生成参考来源清单（供报告直接粘贴）。 */
export function referenceList(ledger) {
  return (ledger?.sources ?? [])
    .map((item) => `${item.index}. ${item.title}${item.note ? `（${item.note}）` : ''} — ${item.url}`)
    .join('\n');
}

function accessDate(item) {
  const iso = item?.verifiedAt || item?.addedAt || '';
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * 按引用格式生成参考文献列表。
 * @param {Array<object>} sources - 台账里的 sources
 * @param {'numeric'|'gbt7714'|'apa'} [style]
 */
export function formatReferences(sources, style = 'numeric') {
  return (sources ?? [])
    .map((item) => {
      const note = item.note ? `（${item.note}）` : '';
      if (style === 'gbt7714') {
        return `${item.index}. ${item.title}[EB/OL]. [${accessDate(item) || '访问日期待补'}]. ${item.url}.${note ? ` ${note}` : ''}`;
      }
      if (style === 'apa') {
        return `${item.index}. ${item.title}. (n.d.).${item.note ? ` ${item.note}.` : ''} Retrieved ${accessDate(item) || 'n.d.'}, from ${item.url}`;
      }
      return `${item.index}. ${item.title}${note} — ${item.url}`;
    })
    .join('\n');
}

