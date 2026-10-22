/* Чтение ZIP-архива для тестов: центральный каталог + данные локальных заголовков (CRC проверяется, как у распаковщика). */
import { inflateRawSync } from 'node:zlib';
import { crc32 } from '../src/pdf/zip';

export interface ReadEntry {
  name: string;
  method: number;
  data: Uint8Array;
}

export function readZip(bytes: Uint8Array): ReadEntry[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--)
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('no EOCD: the archive is not a ZIP');
  const count = dv.getUint16(eocd + 10, true);
  let pos = dv.getUint32(eocd + 16, true);
  const out: ReadEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(pos, true) !== 0x02014b50) throw new Error('broken central directory');
    const method = dv.getUint16(pos + 10, true);
    const crc = dv.getUint32(pos + 16, true);
    const csize = dv.getUint32(pos + 20, true);
    const usize = dv.getUint32(pos + 24, true);
    const nameLen = dv.getUint16(pos + 28, true);
    const extraLen = dv.getUint16(pos + 30, true);
    const commentLen = dv.getUint16(pos + 32, true);
    const localOffset = dv.getUint32(pos + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    if (dv.getUint32(localOffset, true) !== 0x04034b50) throw new Error('broken local header');
    const lNameLen = dv.getUint16(localOffset + 26, true);
    const lExtraLen = dv.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const body = bytes.subarray(start, start + csize);
    const data = method === 8 ? new Uint8Array(inflateRawSync(body)) : body.slice();
    if (data.length !== usize) throw new Error(`size mismatch in ${name}`);
    if (crc32(data) !== crc) throw new Error(`CRC mismatch in ${name}`);
    out.push({ name, method, data });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
