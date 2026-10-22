/** 轻量 Markdown → 自包含 HTML 渲染（用于单文件报告导出，无第三方依赖）。 */

export function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", '&#39;');
}

/**
 * 渲染行内格式：粗体、行内代码、链接、图片、删除线。
 * @param {string} text
 * @param {(src: string) => string | undefined} resolveAsset - 图片地址解析（返回内联 HTML 或替换 src）
 */
function renderInline(text, resolveAsset) {
  const codes = [];
  let out = escapeHtml(text).replace(/`([^`]+)`/g, (_match, code) => {
    codes.push(code);
    return `\u0000CODE${codes.length - 1}\u0000`;
  });

  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (match, alt, src) => {
    const resolved = resolveAsset?.(src);
    if (resolved !== undefined) return `<span class="img-wrap">${resolved}</span>`;
    return `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" loading="lazy" />`;
  });

  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_match, label, url) => {
    return `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  return out.replace(/\u0000CODE(\d+)\u0000/g, (_match, index) => `<code>${codes[Number(index)]}</code>`);
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

function splitRow(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

/**
 * 渲染 Markdown 子集为 HTML 片段。
 * @param {string} markdown
 * @param {{ resolveAsset?: (src: string) => string | undefined }} [options]
 */
export function renderMarkdownToHtml(markdown, options = {}) {
  const resolveAsset = options.resolveAsset;
  const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '') {
      index++;
      continue;
    }

    const fence = /^```([\w-]*)\s*$/.exec(line);
    if (fence) {
      const code = [];
      index++;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index++;
      }
      index++;
      const lang = fence[1] ? ` class="language-${escapeAttr(fence[1])}"` : '';
      html.push(`<pre><code${lang}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2], resolveAsset)}</h${level}>`);
      index++;
      continue;
    }

    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      html.push('<hr />');
      index++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ''));
        index++;
      }
      html.push(`<blockquote><p>${quote.map((row) => renderInline(row, resolveAsset)).join('<br />')}</p></blockquote>`);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*+]\s+/, ''));
        index++;
      }
      html.push(`<ul>${items.map((item) => `<li>${renderInline(item, resolveAsset)}</li>`).join('')}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ''));
        index++;
      }
      html.push(`<ol>${items.map((item) => `<li>${renderInline(item, resolveAsset)}</li>`).join('')}</ol>`);
      continue;
    }

    if (line.trim().startsWith('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const headers = splitRow(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        rows.push(splitRow(lines[index]));
        index++;
      }
      html.push(
        `<table><thead><tr>${headers.map((cell) => `<th>${renderInline(cell, resolveAsset)}</th>`).join('')}</tr></thead>` +
          `<tbody>${rows
            .map((row) => `<tr>${headers.map((_, column) => `<td>${renderInline(row[column] ?? '', resolveAsset)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`,
      );
      continue;
    }

    const paragraph = [];
    while (
      index < lines.length &&
      lines[index].trim() !== '' &&
      !/^(#{1,6}\s|```|>\s?|\s*[-*+]\s+|\s*\d+\.\s+|\s*(---+|\*\*\*+|___+)\s*$)/.test(lines[index]) &&
      !(lines[index].trim().startsWith('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1]))
    ) {
      paragraph.push(lines[index]);
      index++;
    }
    html.push(`<p>${paragraph.map((row) => renderInline(row, resolveAsset)).join('<br />')}</p>`);
  }

  return html.join('\n');
}

/** 包装成完整、可打印的单文件 HTML。 */
export function wrapHtml({ title, body, subtitle = '' }) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { --ink: #1b2028; --muted: #667085; --accent: #2f6feb; --line: #e6e9ef; --bg: #ffffff; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 48px 20px 80px; background: #f6f7f9; color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Segoe UI", sans-serif;
    line-height: 1.75; font-size: 16px; }
  main { max-width: 900px; margin: 0 auto; background: var(--bg); padding: 56px 64px 72px;
    border-radius: 16px; box-shadow: 0 8px 32px rgba(20, 30, 50, .08); }
  h1 { font-size: 34px; line-height: 1.3; margin: 0 0 8px; }
  h2 { font-size: 25px; margin: 40px 0 12px; padding-top: 8px; border-top: 1px solid var(--line); }
  h3 { font-size: 20px; margin: 28px 0 8px; }
  h4, h5, h6 { font-size: 17px; margin: 22px 0 8px; }
  p, li { color: #2a313c; }
  a { color: var(--accent); text-decoration: none; word-break: break-all; }
  a:hover { text-decoration: underline; }
  blockquote { margin: 20px 0; padding: 12px 18px; border-left: 4px solid var(--accent);
    background: #f7f9ff; color: var(--muted); border-radius: 0 8px 8px 0; }
  blockquote p { margin: 0; }
  code { background: #f1f3f7; padding: 2px 6px; border-radius: 5px; font-size: .9em; }
  pre { background: #f5f7fa; padding: 16px 18px; border-radius: 10px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 20px 0; font-size: 15px; }
  th, td { border: 1px solid var(--line); padding: 9px 12px; text-align: left; vertical-align: top; }
  th { background: #f7f9fc; font-weight: 600; }
  tbody tr:nth-child(even) { background: #fbfcfe; }
  img, .img-wrap svg { max-width: 100%; height: auto; display: block; margin: 18px auto; }
  .img-wrap { display: block; margin: 20px 0; }
  hr { border: none; border-top: 1px solid var(--line); margin: 32px 0; }
  .doc-subtitle { color: var(--muted); margin: 0 0 28px; }
  footer { max-width: 900px; margin: 18px auto 0; color: var(--muted); font-size: 13px; text-align: center; }
  @media print {
    body { padding: 0; background: #fff; }
    main { max-width: none; padding: 0; box-shadow: none; border-radius: 0; }
    a { color: inherit; }
    h2 { break-after: avoid; }
    table, pre, blockquote, .img-wrap { break-inside: avoid; }
  }
</style>
</head>
<body>
<main>
${subtitle ? `<p class="doc-subtitle">${escapeHtml(subtitle)}</p>\n` : ''}
${body}
</main>
<footer>由 DeepSeek Harness「资料搜集员」生成的单文件报告 · 打开即可阅读/打印</footer>
</body>
</html>
`;
}
