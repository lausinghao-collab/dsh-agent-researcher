/** 最小 ZIP 读取器（无第三方依赖）：只支持 Office 文件常见的 stored/deflate 条目。 */
import { inflateRawSync } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

/**
 * 读取 ZIP 归档，返回 entry 名称 → 解压后字节（Uint8Array）。
 * @param {Uint8Array} input - 完整 ZIP 文件内容。
 * @returns {Map<string, Uint8Array>}
 */
export function readZip(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buf.length < 22) throw new Error('不是有效的 ZIP 文件（过短）');

  let eocd = -1;
  const stop = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= stop; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件（找不到目录尾部）');

  const total = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const files = new Map();

  for (let i = 0; i < total; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error('ZIP 中央目录损坏');
    }
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');

    if (localOffset + 30 > buf.length) throw new Error(`ZIP 条目损坏：${name}`);
    const localNameLength = buf.readUInt16LE(localOffset + 26);
    const localExtraLength = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buf.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) files.set(name, new Uint8Array(compressed));
    else if (method === 8) files.set(name, new Uint8Array(inflateRawSync(compressed)));
    else throw new Error(`ZIP 条目使用了不支持的压缩方式 ${method}：${name}`);

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return files;
}

/** 从 entry 列表里按正则取排序后的文件名。 */
export function sortedEntries(files, pattern) {
  return [...files.keys()].filter((name) => pattern.test(name)).sort((a, b) => {
    const na = Number(/(\d+)\D*$/.exec(a)?.[1] ?? 0);
    const nb = Number(/(\d+)\D*$/.exec(b)?.[1] ?? 0);
    return na - nb || a.localeCompare(b);
  });
}
