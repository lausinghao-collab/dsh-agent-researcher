/** 本地文档抽取：docx / xlsx / pptx / csv / tsv / txt / md / json。无第三方依赖。 */
import path from 'node:path';
import { readZip, sortedEntries } from './zip.js';

const SUPPORTED = ['.docx', '.xlsx', '.pptx', '.csv', '.tsv', '.txt', '.md', '.markdown', '.json', '.log'];

/** 把 XML 片段转成纯文本：解码实体、段落换行、剥离标签。 */
export function xmlToText(xml) {
  return decodeEntities(
    xml
      .replace(/<w:tab\s*\/>/g, '\t')
      .replace(/<w:br\s*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<\/a:p>/g, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return named[body] ?? match;
  });
}

function decodeUtf8(bytes) {
  const text = new TextDecoder('utf-8').decode(bytes);
  return text.replace(/^\uFEFF/, '');
}

function sheetNameMap(files) {
  const workbook = files.get('xl/workbook.xml');
  const rels = files.get('xl/_rels/workbook.xml.rels');
  const names = new Map();
  if (!workbook || !rels) return names;
  const relText = decodeUtf8(rels);
  const relMap = new Map();
  for (const tag of relText.match(/<Relationship\b[^>]*>/g) ?? []) {
    const id = /Id="([^"]+)"/.exec(tag)?.[1];
    const target = /Target="([^"]+)"/.exec(tag)?.[1];
    if (id && target) relMap.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''));
  }
  const bookText = decodeUtf8(workbook);
  for (const match of bookText.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const target = relMap.get(match[2]);
    if (target) names.set(`xl/${target}`, decodeEntities(match[1]));
  }
  return names;
}

function parseSharedStrings(files) {
  const entry = files.get('xl/sharedStrings.xml');
  if (!entry) return [];
  const text = decodeUtf8(entry);
  const strings = [];
  for (const si of text.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    strings.push(
      decodeEntities(
        [...si[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''),
      ),
    );
  }
  return strings;
}

function columnIndex(ref) {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? 'A';
  let index = 0;
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

function parseSheet(text, sharedStrings) {
  const rows = [];
  let truncated = false;
  for (const rowMatch of text.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cell of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cell[1];
      const body = cell[2];
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = '';
      if (type === 's') value = sharedStrings[Number(raw)] ?? '';
      else if (type === 'inlineStr') value = decodeEntities([...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));
      else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
      else if (raw !== undefined) value = decodeEntities(raw);
      const index = ref ? columnIndex(ref) : cells.length;
      while (cells.length < index) cells.push('');
      cells[index] = value;
    }
    if (rows.length >= 300) {
      truncated = true;
      break;
    }
    rows.push(cells);
  }
  return { rows, truncated };
}

function toMarkdownTable(rows) {
  if (rows.length === 0) return '';
  const width = Math.min(30, Math.max(...rows.map((row) => row.length)));
  const trimmed = rows.map((row) => Array.from({ length: width }, (_, index) => (row[index] ?? '').replace(/\|/g, '\\|')));
  const header = trimmed[0];
  const body = trimmed.slice(1);
  const lines = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`];
  for (const row of body) lines.push(`| ${row.join(' | ')} |`);
  if (rows.some((row) => row.length > width)) lines.push(`\n> 表格较宽，仅显示前 ${width} 列。`);
  return lines.join('\n');
}

/**
 * 从文件字节中抽取可读文本。
 * @param {Uint8Array} bytes - 文件内容。
 * @param {string} filename - 用于判断格式的文件名。
 * @returns {{kind: string, text: string, meta: Record<string, unknown>}}
 */
export function extractDocument(bytes, filename) {
  const ext = path.extname(filename).toLowerCase();
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const kind = ext.replace(/^\./, '') || 'unknown';

  if (ext === '.docx' || ext === '.xlsx' || ext === '.pptx') {
    const files = readZip(buffer);
    if (ext === '.docx') {
      const doc = files.get('word/document.xml');
      if (!doc) throw new Error('docx 缺少 word/document.xml，可能不是有效的 Word 文档');
      return { kind: 'docx', text: xmlToText(decodeUtf8(doc)), meta: { parts: files.size } };
    }
    if (ext === '.pptx') {
      const slides = sortedEntries(files, /^ppt\/slides\/slide\d+\.xml$/);
      if (slides.length === 0) throw new Error('pptx 中没有找到幻灯片');
      const text = slides
        .map((name, index) => `## 第 ${index + 1} 页\n\n${xmlToText(decodeUtf8(files.get(name)))}`)
        .join('\n\n');
      return { kind: 'pptx', text, meta: { slides: slides.length } };
    }
    const sharedStrings = parseSharedStrings(files);
    const names = sheetNameMap(files);
    const sheets = sortedEntries(files, /^xl\/worksheets\/sheet\d+\.xml$/);
    if (sheets.length === 0) throw new Error('xlsx 中没有工作表');
    const rendered = [];
    const sheetMeta = [];
    for (const [index, name] of sheets.entries()) {
      const parsed = parseSheet(decodeUtf8(files.get(name)), sharedStrings);
      const sheetName = names.get(name) ?? `Sheet${index + 1}`;
      sheetMeta.push({ name: sheetName, rows: parsed.rows.length, truncated: parsed.truncated });
      rendered.push(`## 工作表：${sheetName}\n\n${toMarkdownTable(parsed.rows) || '（空表）'}`);
      if (parsed.truncated) rendered.push('\n> 该工作表行数过多，仅显示前 300 行。');
    }
    return { kind: 'xlsx', text: rendered.join('\n\n'), meta: { sheets: sheetMeta } };
  }

  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('latin1') === '%PDF') {
    throw new Error('暂不支持直接解析 PDF：可以先把 PDF 转成 docx/txt，或只提供其中关键页的文字/截图。');
  }

  if (ext === '.csv' || ext === '.tsv' || ext === '.txt' || ext === '.md' || ext === '.markdown' || ext === '.json' || ext === '.log' || ext === '') {
    return { kind: kind || 'text', text: decodeUtf8(buffer), meta: { bytes: buffer.length } };
  }

  throw new Error(`暂不支持的文件类型：${ext || '未知'}（支持：${SUPPORTED.join(' / ')}）`);
}

export { SUPPORTED as SUPPORTED_DOCUMENT_EXTENSIONS };
