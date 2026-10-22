/** 表格导出：CSV / TSV（RFC4180 风格的 CSV 引号处理）。 */

function cell(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

/** 渲染分隔符文本；CSV 处理引号/逗号/换行，TSV 把制表符与换行替换为空格。 */
export function toDelimited(headers, rows, delimiter = ',') {
  if (!Array.isArray(headers) || headers.length === 0) throw new Error('表格需要 headers（列名数组）');
  if (!Array.isArray(rows)) throw new Error('表格需要 rows（二维数组）');
  const width = headers.length;
  const render = (value) => {
    const text = cell(value);
    if (delimiter === ',') {
      return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    }
    return text.replace(/\t/g, ' ').replace(/[\r\n]+/g, ' ');
  };
  const lines = [headers.map(render).join(delimiter)];
  for (const [index, row] of rows.entries()) {
    if (!Array.isArray(row)) throw new Error(`第 ${index + 1} 行不是数组`);
    const normalized = Array.from({ length: width }, (_, column) => row[column] ?? '');
    if (row.length > width) throw new Error(`第 ${index + 1} 行有 ${row.length} 列，超过表头的 ${width} 列`);
    lines.push(normalized.map(render).join(delimiter));
  }
  return lines.join('\r\n') + '\r\n';
}

/** 根据文件扩展名判断导出格式。 */
export function formatFromPath(filePath) {
  const ext = String(filePath ?? '').toLowerCase();
  if (ext.endsWith('.tsv') || ext.endsWith('.tab')) return 'tsv';
  return 'csv';
}
