/* Минимальная сборка ZIP-архива (deflate или store) — без внешних зависимостей: сжатие берётся из node:zlib,
   CRC32 считается здесь же. Формат — обычный ZIP (PKZIP 2.0): локальные заголовки, центральный каталог, EOCD.
   Нужен для выгрузки счетов архивом: PDF одного счёта не сжимается, но архив из десятков счетов — вполне. */
import { deflateRawSync } from 'node:zlib';

export interface ZipEntry {
  /** Имя файла внутри архива (без пути) */
  name: string;
  data: Uint8Array;
}

/** Таблица CRC32 (полином 0xEDB88320) — считается один раз при загрузке модуля */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

/** CRC32 файла (как в ZIP) */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Дата и время в формате DOS (две поля: время, дата) */
function dosTime(now: Date): { time: number; date: number } {
  return {
    time: (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1),
    date: ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate(),
  };
}

/** Собирает ZIP-архив: для каждой записи — локальный заголовок, данные и запись в центральном каталоге */
export function createZip(entries: ZipEntry[], now: Date = new Date()): Uint8Array {
  const { time, date } = dosTime(now);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const raw = entry.data;
    const crc = crc32(raw);
    // сжатие даёт выигрыш только если он реально есть (мелкие PDF иногда растут)
    const deflated = raw.length > 64 ? new Uint8Array(deflateRawSync(raw, { level: 6 })) : null;
    const useDeflate = !!deflated && deflated.length < raw.length;
    const body = useDeflate ? deflated! : raw;
    const method = useDeflate ? 8 : 0;

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // подпись локального заголовка
    lv.setUint16(4, 20, true); // версия
    lv.setUint16(6, 0x0800, true); // флаг: имя в UTF-8
    lv.setUint16(8, method, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    locals.push(local, body);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // подпись записи каталога
    cv.setUint16(4, 20, true); // версия создателя
    cv.setUint16(6, 20, true); // версия для распаковки
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true); // extra
    cv.setUint16(32, 0, true); // comment
    cv.setUint16(34, 0, true); // disk
    cv.setUint16(36, 0, true); // internal attrs
    cv.setUint32(38, 0o600 << 16, true); // external attrs: обычный файл
    cv.setUint32(42, offset, true); // смещение локального заголовка
    central.set(name, 46);
    centrals.push(central);

    offset += local.length + body.length;
  }

  const centralSize = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // подпись EOCD
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true); // comment

  const total = locals.reduce((s, c) => s + c.length, 0) + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}
