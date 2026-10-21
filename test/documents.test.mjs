import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractDocument } from '../lib/documents.js';
import { readZip } from '../lib/zip.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => fs.readFileSync(path.join(here, 'fixtures', name));

test('docx：抽取标题、段落与表格文字', () => {
  const result = extractDocument(fixture('sample.docx'), 'sample.docx');
  assert.equal(result.kind, 'docx');
  assert.match(result.text, /测试文档标题/);
  assert.match(result.text, /这是一段用于测试 docx 抽取的中文内容/);
  assert.match(result.text, /上证指数/);
});

test('xlsx：按工作表输出表格', () => {
  const result = extractDocument(fixture('sample.xlsx'), 'sample.xlsx');
  assert.equal(result.kind, 'xlsx');
  assert.match(result.text, /工作表：数据/);
  assert.match(result.text, /上证指数/);
  assert.match(result.text, /4094\.4/);
  assert.match(result.text, /工作表：备注/);
  assert.match(result.text, /这是第二个工作表/);
  assert.deepEqual(
    result.meta.sheets.map((sheet) => sheet.name),
    ['数据', '备注'],
  );
});

test('pptx：按页输出文字', () => {
  const result = extractDocument(fixture('sample.pptx'), 'sample.pptx');
  assert.equal(result.kind, 'pptx');
  assert.match(result.text, /第 1 页/);
  assert.match(result.text, /年度回顾/);
  assert.match(result.text, /科创50/);
  assert.equal(result.meta.slides, 1);
});

test('纯文本类文件原样返回（含 BOM 处理）', () => {
  const csv = extractDocument(Buffer.from('\uFEFF指标,数值\n上证指数,4094.4\n'), 'data.csv');
  assert.equal(csv.kind, 'csv');
  assert.ok(csv.text.startsWith('指标,数值'));
  const json = extractDocument(Buffer.from('{"a":1}'), 'data.json');
  assert.equal(json.text, '{"a":1}');
});

test('PDF 与不支持的类型给出明确错误', () => {
  assert.throws(() => extractDocument(Buffer.from('%PDF-1.7\n...'), 'paper.pdf'), /PDF/);
  assert.throws(() => extractDocument(Buffer.from('abc'), 'old.doc'), /暂不支持/);
});

test('ZIP 解析拒绝损坏文件', () => {
  assert.throws(() => readZip(Buffer.from('not a zip')), /ZIP/);
});
