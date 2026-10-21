/**
 * 纯函数式 SVG 图表渲染器（无第三方依赖）。
 *
 * 设计目标：给「资料搜集员」agent 一个可靠的出图能力——模型只需给数据，
 * 图表样式、坐标轴、图例、数值标注、来源脚注由这里统一生成，避免手写 SVG
 * 出现错位、字体、坐标问题。
 *
 * 支持样式：bar / hbar / line / area / donut / stacked / waterfall / kpi / scatter
 */

const FONT =
  "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans SC', 'Segoe UI', sans-serif";

const THEMES = {
  light: {
    bg: '#ffffff',
    ink: '#1b2028',
    muted: '#667085',
    faint: '#98a2b3',
    grid: '#e9ecf1',
    axis: '#c7ced8',
    card: '#f7f8fa',
    border: '#e6e9ef',
    accent: '#2f6feb',
    up: '#d6453f',
    down: '#2e8b57',
  },
  dark: {
    bg: '#0f141b',
    ink: '#e8edf5',
    muted: '#a3adbd',
    faint: '#7c8798',
    grid: '#26303d',
    axis: '#3a4658',
    card: '#161d27',
    border: '#28323f',
    accent: '#5b8cff',
    up: '#ff6b63',
    down: '#3fae7d',
  },
};

const PALETTES = {
  light: ['#2f6feb', '#d6453f', '#2e8b57', '#e8833a', '#7a5af8', '#1fa6a6', '#b87a3a', '#6b7a99'],
  dark: ['#5b8cff', '#ff6b63', '#3fae7d', '#f0a35e', '#9b82ff', '#3fc3c3', '#d8a25e', '#93a1b8'],
};

const TYPES = ['bar', 'hbar', 'line', 'area', 'donut', 'stacked', 'waterfall', 'kpi', 'scatter'];

const MARGIN = { left: 110, right: 80, top: 200, bottom: 140 };

/** XML 文本转义。 */
export function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** 数值格式化：大数自动折算为万/亿，保留合适小数。 */
export function formatNumber(value, unit = '') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  let out;
  if (abs >= 1e8) out = trimZeros(value / 1e8) + '亿';
  else if (abs >= 1e4) out = trimZeros(value / 1e4) + '万';
  else out = Number.isInteger(value) ? String(value) : trimZeros(value);
  return out + unit;
}

function trimZeros(value) {
  return Number(value.toFixed(2)).toString();
}

/** 千分位数字（KPI 卡片用，避免「30,037」被折成「3万」丢失精度）。 */
function formatPlain(value, unit = '') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const rounded = Number(value.toFixed(2));
  const [integer, decimal] = String(rounded).split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (decimal ? `${grouped}.${decimal}` : grouped) + unit;
}

/** 坐标轴刻度：返回对齐到「好看的步长」的 min/max 与刻度值。 */
export function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, ticks: [0, 1] };
  if (min > max) [min, max] = [max, min];
  if (min === max) {
    if (min === 0) return { min: 0, max: 1, ticks: [0, 0.5, 1] };
    min = Math.min(0, min);
    max = max === 0 ? 1 : max * 1.2;
  }
  const span = max - min || 1;
  const rawStep = span / count;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const norm = rawStep / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return { min: lo, max: hi, ticks };
}

function text(value, x, y, { size = 24, weight = 400, fill = '#1b2028', anchor = 'start', opacity = 1 } = {}) {
  const style = opacity === 1 ? '' : ` opacity="${opacity}"`;
  return `<text x="${round(x)}" y="${round(y)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${style}>${escapeXml(value)}</text>`;
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function truncate(value, maxChars) {
  const str = String(value ?? '');
  if ([...str].length <= maxChars) return str;
  return [...str].slice(0, Math.max(1, maxChars - 1)).join('') + '…';
}

function line(x1, y1, x2, y2, stroke, width = 1, dash = '') {
  return `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" stroke="${stroke}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
}

function rect(x, y, w, h, fill, { rx = 0, stroke = '', strokeWidth = 0, opacity = 1 } = {}) {
  return `<rect x="${round(x)}" y="${round(y)}" width="${round(Math.max(w, 0))}" height="${round(Math.max(h, 0))}" rx="${rx}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${strokeWidth}"` : ''}${opacity === 1 ? '' : ` opacity="${opacity}"`}/>`;
}

function polyline(points, stroke, width = 3.5, opacity = 1) {
  if (points.length === 0) return '';
  const d = points.map(([x, y]) => `${round(x)},${round(y)}`).join(' ');
  return `<polyline points="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"${opacity === 1 ? '' : ` opacity="${opacity}"`}/>`;
}

function circle(x, y, r, fill, { opacity = 1, stroke = '', strokeWidth = 0 } = {}) {
  return `<circle cx="${round(x)}" cy="${round(y)}" r="${r}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${strokeWidth}"` : ''}${opacity === 1 ? '' : ` opacity="${opacity}"`}/>`;
}

function labelChip(x, y, label, theme, { anchor = 'start' } = {}) {
  return text(label, x, y, { size: 26, weight: 500, fill: theme.muted, anchor });
}

/** 图例：色块 + 名称，横排。 */
function legendEntries(entries, x, y, theme, { anchor = 'start' } = {}) {
  const parts = [];
  let cursor = x;
  const totalWidth = entries.reduce((sum, e) => sum + 34 + estimateTextWidth(e.label, 24) + 42, 0);
  if (anchor === 'end') cursor = x - totalWidth;
  for (const entry of entries) {
    parts.push(rect(cursor, y - 16, 18, 18, entry.color, { rx: 4 }));
    parts.push(text(entry.label, cursor + 26, y, { size: 24, fill: theme.muted }));
    cursor += 34 + estimateTextWidth(entry.label, 24) + 42;
  }
  return { parts, width: totalWidth, end: cursor };
}

function estimateTextWidth(value, size) {
  let width = 0;
  for (const ch of String(value ?? '')) width += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? size : size * 0.58;
  return width;
}

function plotFrame({ width, height, subtitle }) {
  const top = subtitle ? MARGIN.top + 20 : MARGIN.top;
  return {
    x: MARGIN.left,
    y: top,
    w: width - MARGIN.left - MARGIN.right,
    h: height - top - MARGIN.bottom,
  };
}

function header(parts, spec, theme, width) {
  parts.push(text(spec.title, 72, 104, { size: 50, weight: 700, fill: theme.ink }));
  if (spec.subtitle) parts.push(text(spec.subtitle, 72, 152, { size: 26, fill: theme.muted }));
  if (spec.note) {
    parts.push(text(spec.note, width - 72, 152, { size: 24, fill: theme.faint, anchor: 'end' }));
  }
}

function footer(parts, spec, theme, width, height) {
  if (!spec.source) return;
  parts.push(text(`数据来源：${spec.source}`, MARGIN.left, height - 52, { size: 22, fill: theme.faint }));
}

// ── 数据规整 ───────────────────────────────────────────────────────────────

function itemsOf(spec) {
  const data = spec.data ?? {};
  if (Array.isArray(data.items)) {
    return data.items.map((item, index) => {
      const value = Number(item?.value);
      if (typeof item?.label !== 'string' || !Number.isFinite(value)) {
        throw new Error(`data.items[${index}] 需要 label（字符串）与 value（数字）`);
      }
      return { label: item.label, value, isTotal: item.isTotal === true, delta: item.delta, note: item.note };
    });
  }
  if (Array.isArray(data.labels) && Array.isArray(data.values)) {
    return data.labels.map((label, index) => {
      const value = Number(data.values[index]);
      if (!Number.isFinite(value)) throw new Error(`data.values[${index}] 不是数字`);
      return { label: String(label), value, isTotal: false };
    });
  }
  throw new Error('缺少数据：请提供 data.items 或 data.labels + data.values');
}

function seriesOf(spec) {
  const data = spec.data ?? {};
  if (Array.isArray(data.series) && data.series.length > 0) {
    return data.series.map((series, index) => {
      if (!Array.isArray(series?.values) || series.values.length === 0) {
        throw new Error(`data.series[${index}].values 不能为空`);
      }
      const values = series.values.map((value, i) => {
        const n = Number(value);
        if (!Number.isFinite(n)) throw new Error(`data.series[${index}].values[${i}] 不是数字`);
        return n;
      });
      return { name: typeof series.name === 'string' ? series.name : `系列 ${index + 1}`, values };
    });
  }
  if (Array.isArray(data.labels) && Array.isArray(data.values)) {
    return [{ name: spec.unit ? `数值（${spec.unit}）` : '数值', values: itemsOf(spec).map((item) => item.value) }];
  }
  throw new Error('缺少数据：折线/面积/堆叠图需要 data.labels + data.values，或 data.series');
}

function labelsOf(spec) {
  const data = spec.data ?? {};
  if (Array.isArray(data.labels) && data.labels.length > 0) return data.labels.map(String);
  throw new Error('缺少 data.labels（横轴分类）');
}

// ── 各图表样式 ─────────────────────────────────────────────────────────────

function drawBar(spec, theme, palette, { width, height, plot }) {
  const items = itemsOf(spec);
  if (items.length === 0) throw new Error('柱状图需要至少 1 个数据点');
  const values = items.map((item) => item.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const scale = niceTicks(min, max === min ? min + 1 : max * 1.08 || 1, 5);
  const yOf = (value) => plot.y + plot.h - ((value - scale.min) / (scale.max - scale.min)) * plot.h;
  const parts = [];

  for (const tick of scale.ticks) {
    const y = yOf(tick);
    parts.push(line(plot.x, y, plot.x + plot.w, y, tick === 0 ? theme.axis : theme.grid, tick === 0 ? 2 : 1));
    parts.push(text(formatNumber(tick), plot.x - 18, y + 8, { size: 22, fill: theme.faint, anchor: 'end' }));
  }

  const band = plot.w / items.length;
  const barWidth = Math.min(96, band * 0.56);
  const showValues = spec.showValues !== false;
  items.forEach((item, index) => {
    const x = plot.x + band * index + (band - barWidth) / 2;
    const y = yOf(item.value);
    const zero = yOf(0);
    const h = Math.abs(zero - y);
    const color = spec.colorByItem
      ? palette[index % palette.length]
      : item.value < 0
        ? theme.down
        : theme.accent;
    parts.push(rect(x, Math.min(y, zero), barWidth, Math.max(h, 1), color, { rx: Math.min(10, barWidth / 4) }));
    if (showValues) {
      parts.push(
        text(formatNumber(item.value, spec.unit), x + barWidth / 2, item.value >= 0 ? y - 16 : y + 34, {
          size: 24,
          weight: 600,
          fill: theme.ink,
          anchor: 'middle',
        }),
      );
    }
    const label = truncate(item.label, Math.max(3, Math.floor(band / 26)));
    parts.push(text(label, plot.x + band * index + band / 2, plot.y + plot.h + 40, { size: 24, fill: theme.muted, anchor: 'middle' }));
  });

  return parts;
}

function drawHBar(spec, theme, palette, { width, height, plot }) {
  const items = itemsOf(spec);
  if (items.length === 0) throw new Error('条形图需要至少 1 个数据点');
  const labelWidth = Math.max(...items.map((item) => estimateTextWidth(truncate(item.label, 14), 24)));
  const area = { ...plot };
  const shift = Math.max(0, Math.min(320, labelWidth + 44) - MARGIN.left);
  area.x = plot.x + shift;
  area.w = plot.w - shift;
  const values = items.map((item) => item.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const scale = niceTicks(min, max === min ? min + 1 : max * 1.02 || 1, 5);
  const xOf = (value) => area.x + ((value - scale.min) / (scale.max - scale.min)) * area.w;
  const parts = [];

  for (const tick of scale.ticks) {
    const x = xOf(tick);
    parts.push(line(x, area.y, x, area.y + area.h, tick === 0 ? theme.axis : theme.grid, tick === 0 ? 2 : 1));
    parts.push(text(formatNumber(tick), x, area.y + area.h + 34, { size: 22, fill: theme.faint, anchor: 'middle' }));
  }

  const band = area.h / items.length;
  const barHeight = Math.min(58, band * 0.6);
  const showValues = spec.showValues !== false;
  items.forEach((item, index) => {
    const y = area.y + band * index + (band - barHeight) / 2;
    const x = xOf(Math.min(0, item.value));
    const zero = xOf(0);
    const w = Math.abs(xOf(item.value) - zero);
    const color = spec.colorByItem
      ? palette[index % palette.length]
      : item.value < 0
        ? theme.down
        : theme.accent;
    parts.push(text(truncate(item.label, 14), area.x - 24, y + barHeight / 2 + 9, { size: 24, fill: theme.muted, anchor: 'end' }));
    parts.push(rect(x, y, Math.max(w, 1), barHeight, color, { rx: Math.min(10, barHeight / 4) }));
    if (showValues) {
      parts.push(
        text(formatNumber(item.value, spec.unit), item.value >= 0 ? x + w + 16 : x - 16, y + barHeight / 2 + 9, {
          size: 24,
          weight: 600,
          fill: theme.ink,
          anchor: item.value >= 0 ? 'start' : 'end',
        }),
      );
    }
  });

  return parts;
}

function drawSeriesChart(spec, theme, palette, { width, height, plot }, { area = false } = {}) {
  const labels = labelsOf(spec);
  const series = seriesOf(spec);
  const allValues = series.flatMap((item) => item.values);
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const scale = niceTicks(min - (max - min) * 0.08, max + (max - min) * 0.08 || max + 1, 5);
  const yOf = (value) => plot.y + plot.h - ((value - scale.min) / (scale.max - scale.min)) * plot.h;
  const n = Math.max(...series.map((item) => item.values.length));
  const xOf = (index) => (n === 1 ? plot.x + plot.w / 2 : plot.x + (index / (n - 1)) * plot.w);
  const parts = [];

  for (const tick of scale.ticks) {
    const y = yOf(tick);
    parts.push(line(plot.x, y, plot.x + plot.w, y, theme.grid));
    parts.push(text(formatNumber(tick), plot.x - 18, y + 8, { size: 22, fill: theme.faint, anchor: 'end' }));
    parts.push(line(plot.x, y, plot.x + 8, y, theme.axis, 1.5));
  }

  const step = Math.ceil(n / 12);
  labels.forEach((label, index) => {
    if (index % step !== 0 && index !== n - 1) return;
    parts.push(text(truncate(label, 10), xOf(index), plot.y + plot.h + 40, { size: 24, fill: theme.muted, anchor: 'middle' }));
  });

  const legend = legendEntries(
    series.map((item, index) => ({ label: item.name, color: palette[index % palette.length] })),
    width - MARGIN.right,
    plot.y - 34,
    theme,
    { anchor: 'end' },
  );
  parts.push(...legend.parts);

  series.forEach((item, seriesIndex) => {
    const color = palette[seriesIndex % palette.length];
    const points = item.values.map((value, index) => [xOf(index), yOf(value)]);
    if (area) {
      const base = yOf(Math.max(scale.min, 0));
      const d = `M ${points.map(([x, y]) => `${round(x)} ${round(y)}`).join(' L ')} L ${round(points.at(-1)[0])} ${round(base)} L ${round(points[0][0])} ${round(base)} Z`;
      parts.push(`<path d="${d}" fill="${color}" opacity="${series.length > 1 ? 0.1 : 0.16}"/>`);
    }
    parts.push(polyline(points, color));
    for (const [x, y] of points) parts.push(circle(x, y, 5, color, { stroke: theme.bg, strokeWidth: 2 }));
    if (spec.showValues === true && n <= 12) {
      item.values.forEach((value, index) => {
        parts.push(text(formatNumber(value, spec.unit), xOf(index), yOf(value) - 16, { size: 22, weight: 600, fill: theme.ink, anchor: 'middle' }));
      });
    }
  });

  return parts;
}

function polar(cx, cy, radius, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
}

function arcPath(cx, cy, outer, inner, startAngle, endAngle) {
  const [x0, y0] = polar(cx, cy, outer, startAngle);
  const [x1, y1] = polar(cx, cy, outer, endAngle);
  const [x2, y2] = polar(cx, cy, inner, endAngle);
  const [x3, y3] = polar(cx, cy, inner, startAngle);
  const large = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${round(x0)} ${round(y0)} A ${outer} ${outer} 0 ${large} 1 ${round(x1)} ${round(y1)} L ${round(x2)} ${round(y2)} A ${inner} ${inner} 0 ${large} 0 ${round(x3)} ${round(y3)} Z`;
}

function drawDonut(spec, theme, palette, { width, height, plot }) {
  const items = itemsOf(spec);
  const positives = items.filter((item) => item.value > 0);
  if (positives.length === 0) throw new Error('环形图需要至少 1 个正数数据点');
  const total = positives.reduce((sum, item) => sum + item.value, 0);
  const cx = plot.x + plot.w * 0.36;
  const cy = plot.y + plot.h / 2;
  const outer = Math.min(plot.w * 0.34, plot.h * 0.46);
  const inner = outer * 0.62;
  const parts = [];
  let angle = 0;
  const legend = [];

  positives.forEach((item, index) => {
    const sweep = (item.value / total) * 360;
    const color = palette[index % palette.length];
    parts.push(`<path d="${arcPath(cx, cy, outer, inner, angle, angle + sweep)}" fill="${color}"/>`);
    legend.push({ label: `${item.label}`, color, value: item.value, percent: (item.value / total) * 100 });
    angle += sweep;
  });

  parts.push(text(formatNumber(total, spec.unit), cx, cy + 10, { size: 54, weight: 700, fill: theme.ink, anchor: 'middle' }));
  parts.push(text('合计', cx, cy + 52, { size: 24, fill: theme.faint, anchor: 'middle' }));

  const legendX = cx + outer + 90;
  const lineHeight = 52;
  const percentValues = spec.unit === '%' && Math.abs(total - 100) < 0.5;
  let legendY = cy - (legend.length * lineHeight) / 2 + 10;
  for (const entry of legend) {
    parts.push(rect(legendX, legendY - 18, 20, 20, entry.color, { rx: 5 }));
    parts.push(text(truncate(entry.label, 12), legendX + 32, legendY, { size: 26, fill: theme.ink }));
    parts.push(text(`${entry.percent.toFixed(1)}%`, legendX + 32 + estimateTextWidth(truncate(entry.label, 12), 26) + 26, legendY, { size: 24, fill: theme.muted }));
    if (!percentValues) {
      parts.push(
        text(`${formatNumber(entry.value, spec.unit)}`, width - MARGIN.right, legendY, { size: 24, weight: 600, fill: theme.ink, anchor: 'end' }),
      );
    }
    legendY += lineHeight;
  }

  return parts;
}

function drawStacked(spec, theme, palette, { width, height, plot }) {
  const labels = labelsOf(spec);
  const series = seriesOf(spec);
  const sums = labels.map((_, index) => series.reduce((sum, item) => sum + (item.values[index] ?? 0), 0));
  const max = Math.max(0, ...sums);
  const min = Math.min(0, ...sums);
  const scale = niceTicks(min, max === min ? min + 1 : max * 1.05, 5);
  const yOf = (value) => plot.y + plot.h - ((value - scale.min) / (scale.max - scale.min)) * plot.h;
  const parts = [];

  for (const tick of scale.ticks) {
    const y = yOf(tick);
    parts.push(line(plot.x, y, plot.x + plot.w, y, tick === 0 ? theme.axis : theme.grid, tick === 0 ? 2 : 1));
    parts.push(text(formatNumber(tick), plot.x - 18, y + 8, { size: 22, fill: theme.faint, anchor: 'end' }));
  }

  const band = plot.w / labels.length;
  const barWidth = Math.min(96, band * 0.56);
  labels.forEach((label, index) => {
    let base = 0;
    series.forEach((item, seriesIndex) => {
      const value = item.values[index] ?? 0;
      const y0 = yOf(base);
      const y1 = yOf(base + value);
      const x = plot.x + band * index + (band - barWidth) / 2;
      parts.push(
        rect(x, Math.min(y0, y1), barWidth, Math.max(Math.abs(y1 - y0), 1), palette[seriesIndex % palette.length], {
          rx: 6,
        }),
      );
      base += value;
    });
    if (spec.showValues !== false) {
      const total = sums[index];
      parts.push(text(formatNumber(total, spec.unit), plot.x + band * index + band / 2, yOf(total) - 14, { size: 22, weight: 600, fill: theme.ink, anchor: 'middle' }));
    }    parts.push(text(truncate(label, Math.max(3, Math.floor(band / 26))), plot.x + band * index + band / 2, plot.y + plot.h + 40, { size: 24, fill: theme.muted, anchor: 'middle' }));
  });

  const legend = legendEntries(
    series.map((item, index) => ({ label: item.name, color: palette[index % palette.length] })),
    width - MARGIN.right,
    plot.y - 34,
    theme,
    { anchor: 'end' },
  );
  parts.push(...legend.parts);

  return parts;
}

function drawWaterfall(spec, theme, palette, { width, height, plot }) {
  const items = itemsOf(spec);
  const steps = [];
  let cumulative = 0;
  for (const item of items) {
    if (item.isTotal) {
      steps.push({ ...item, start: 0, end: item.value });
      cumulative = item.value;
    } else {
      steps.push({ ...item, start: cumulative, end: cumulative + item.value });
      cumulative += item.value;
    }
  }
  const values = steps.flatMap((step) => [step.start, step.end]);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const scale = niceTicks(min, max === min ? min + 1 : max * 1.05, 5);
  const yOf = (value) => plot.y + plot.h - ((value - scale.min) / (scale.max - scale.min)) * plot.h;
  const parts = [];

  for (const tick of scale.ticks) {
    const y = yOf(tick);
    parts.push(line(plot.x, y, plot.x + plot.w, y, tick === 0 ? theme.axis : theme.grid, tick === 0 ? 2 : 1));
    parts.push(text(formatNumber(tick), plot.x - 18, y + 8, { size: 22, fill: theme.faint, anchor: 'end' }));
  }

  const band = plot.w / steps.length;
  const barWidth = Math.min(96, band * 0.56);
  steps.forEach((step, index) => {
    const x = plot.x + band * index + (band - barWidth) / 2;
    const y0 = yOf(step.start);
    const y1 = yOf(step.end);
    const positive = step.end >= step.start;
    const color = step.isTotal ? theme.accent : positive ? theme.up : theme.down;
    parts.push(rect(x, Math.min(y0, y1), barWidth, Math.max(Math.abs(y1 - y0), 2), color, { rx: 8 }));
    const valueLabel = step.isTotal ? formatNumber(step.end, spec.unit) : `${step.value > 0 ? '+' : ''}${formatNumber(step.value, spec.unit)}`;
    parts.push(text(valueLabel, x + barWidth / 2, Math.min(y0, y1) - 14, { size: 22, weight: 600, fill: theme.ink, anchor: 'middle' }));
    parts.push(text(truncate(step.label, Math.max(3, Math.floor(band / 26))), plot.x + band * index + band / 2, plot.y + plot.h + 40, { size: 24, fill: theme.muted, anchor: 'middle' }));
    if (index < steps.length - 1) {
      const next = steps[index + 1];
      const connectY = yOf(step.end);
      const nextX = plot.x + band * (index + 1) + (band - barWidth) / 2;
      parts.push(line(x + barWidth, connectY, nextX, connectY, theme.faint, 1.5, '6 6'));
    }
  });

  return parts;
}

function drawKpi(spec, theme, palette, { width, height, plot }) {
  const items = itemsOf(spec);
  if (items.length === 0) throw new Error('KPI 图需要至少 1 个数据点');
  const parts = [];
  const columns = items.length <= 2 ? 2 : items.length <= 6 ? 3 : 4;
  const rows = Math.ceil(items.length / columns);
  const gap = 28;
  const cardWidth = (plot.w - gap * (columns - 1)) / columns;
  const cardHeight = Math.min(220, (plot.h - gap * (rows - 1)) / rows);

  items.forEach((item, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = plot.x + column * (cardWidth + gap);
    const y = plot.y + row * (cardHeight + gap);
    parts.push(rect(x, y, cardWidth, cardHeight, theme.card, { rx: 18, stroke: theme.border, strokeWidth: 1.5 }));
    parts.push(rect(x, y + 24, 6, 40, palette[index % palette.length], { rx: 3 }));
    parts.push(text(truncate(item.label, 14), x + 34, y + 62, { size: 26, fill: theme.muted }));
    parts.push(text(formatPlain(item.value, spec.unit), x + 34, y + 128, { size: 54, weight: 700, fill: theme.ink }));
    const hasDelta = typeof item.delta === 'string' && item.delta.trim() !== '';
    const hasNote = typeof item.note === 'string' && item.note.trim() !== '';
    if (hasDelta) {
      const delta = item.delta.trim();
      const positive = delta.startsWith('+') || (!delta.startsWith('-') && !/^[-−]/.test(delta));
      const deltaColor = delta.startsWith('+') ? theme.up : delta.startsWith('-') || /^[-−]/.test(delta) ? theme.down : theme.muted;
      parts.push(text(delta, x + 34, y + cardHeight - (hasNote ? 66 : 30), { size: 25, weight: 600, fill: deltaColor }));
    }
    if (hasNote) {
      parts.push(text(truncate(item.note, 20), x + 34, y + cardHeight - 26, { size: 22, fill: theme.faint }));
    }
  });

  return parts;
}

function drawScatter(spec, theme, palette, { width, height, plot }) {
  const points = Array.isArray(spec.data?.points) ? spec.data.points : [];
  if (points.length === 0) throw new Error('散点图需要 data.points（[{x, y, label?}]）');
  const xs = points.map((point) => Number(point.x));
  const ys = points.map((point) => Number(point.y));
  if (xs.some((value) => !Number.isFinite(value)) || ys.some((value) => !Number.isFinite(value))) {
    throw new Error('散点图的 x / y 必须是数字');
  }
  const xScale = niceTicks(Math.min(...xs), Math.max(...xs), 6);
  const yScale = niceTicks(Math.min(0, ...ys), Math.max(...ys) * 1.05, 5);
  const xOf = (value) => plot.x + ((value - xScale.min) / (xScale.max - xScale.min || 1)) * plot.w;
  const yOf = (value) => plot.y + plot.h - ((value - yScale.min) / (yScale.max - yScale.min || 1)) * plot.h;
  const parts = [];

  for (const tick of yScale.ticks) {
    const y = yOf(tick);
    parts.push(line(plot.x, y, plot.x + plot.w, y, theme.grid));
    parts.push(text(formatNumber(tick), plot.x - 18, y + 8, { size: 22, fill: theme.faint, anchor: 'end' }));
  }
  for (const tick of xScale.ticks) {
    const x = xOf(tick);
    parts.push(line(x, plot.y, x, plot.y + plot.h, theme.grid));
    parts.push(text(formatNumber(tick), x, plot.y + plot.h + 36, { size: 22, fill: theme.faint, anchor: 'middle' }));
  }

  const radius = points.length > 40 ? 5 : 7;
  points.forEach((point) => {
    parts.push(circle(xOf(Number(point.x)), yOf(Number(point.y)), radius, theme.accent, { opacity: 0.85 }));
    if (typeof point.label === 'string' && points.length <= 20) {
      parts.push(text(truncate(point.label, 8), xOf(Number(point.x)) + radius + 8, yOf(Number(point.y)) - 8, { size: 20, fill: theme.muted }));
    }
  });

  if (spec.data?.x_label) {
    parts.push(text(spec.data.x_label, plot.x + plot.w / 2, plot.y + plot.h + 86, { size: 24, fill: theme.muted, anchor: 'middle' }));
  }
  if (spec.data?.y_label) {
    const x = 46;
    const y = plot.y + plot.h / 2;
    parts.push(`<text x="${x}" y="${y}" font-size="24" fill="${theme.muted}" text-anchor="middle" transform="rotate(-90 ${x} ${y})">${escapeXml(spec.data.y_label)}</text>`);
  }

  return parts;
}

const DRAWERS = {
  bar: drawBar,
  hbar: drawHBar,
  line: (spec, theme, palette, layout) => drawSeriesChart(spec, theme, palette, layout),
  area: (spec, theme, palette, layout) => drawSeriesChart(spec, theme, palette, layout, { area: true }),
  donut: drawDonut,
  stacked: drawStacked,
  waterfall: drawWaterfall,
  kpi: drawKpi,
  scatter: drawScatter,
};

// ── 对外入口 ───────────────────────────────────────────────────────────────

/**
 * 把一份图表描述渲染成独立 SVG 文档。
 * @param {object} input - 图表描述：type / title / data / subtitle? / source? / theme? / width? / height? / unit? / showValues?
 * @returns {string} 完整 SVG（可直接写入 .svg 文件）
 */
export function renderChart(input) {
  if (!input || typeof input !== 'object') throw new Error('图表描述必须是对象');
  const type = String(input.type ?? '');
  if (!TYPES.includes(type)) throw new Error(`不支持的图表样式：${type}（可用：${TYPES.join(' / ')}）`);
  if (typeof input.title !== 'string' || input.title.trim() === '') throw new Error('缺少 title');
  if (!input.data || typeof input.data !== 'object') throw new Error('缺少 data');

  const spec = {
    type,
    title: input.title.trim(),
    subtitle: input.subtitle,
    note: input.note,
    source: input.source,
    theme: input.theme === 'dark' ? 'dark' : 'light',
    unit: input.unit ?? '',
    showValues: input.showValues,
    colorByItem: input.colorByItem === true,
    data: input.data,
  };
  const theme = THEMES[spec.theme];
  const customColors = Array.isArray(spec.data?.colors)
    ? spec.data.colors.filter((color) => typeof color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(color))
    : [];
  const palette = customColors.length > 0 ? customColors : PALETTES[spec.theme];

  let width = Number.isFinite(input.width) && input.width >= 640 ? Math.round(input.width) : 1600;
  let height = Number.isFinite(input.height) && input.height >= 420 ? Math.round(input.height) : 1000;

  if (type === 'hbar') {
    const rows = itemsOf(spec).length;
    height = Math.max(height, 260 + rows * 64 + 140);
  }
  if (type === 'kpi') {
    const count = itemsOf(spec).length;
    const rows = Math.ceil(count / (count <= 2 ? 2 : count <= 6 ? 3 : 4));
    height = Math.max(height, 260 + rows * 240 + 140);
  }

  const plot = plotFrame({ width, height, subtitle: spec.subtitle });
  const parts = [];
  parts.push(`<rect width="${width}" height="${height}" fill="${theme.bg}"/>`);
  header(parts, spec, theme, width);
  parts.push(...DRAWERS[type](spec, theme, palette, { width, height, plot }));
  footer(parts, spec, theme, width, height);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}" role="img" aria-label="${escapeXml(spec.title)}">${parts.join('')}</svg>\n`;
}

export { TYPES as CHART_TYPES, THEMES, PALETTES };
