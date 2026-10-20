/* UUID v7 в коде (RFC 9562): 48 бит времени в мс + 12-битный счётчик + случайные биты.
   Счётчик даёт монотонность внутри одной миллисекунды — идентификаторы из одного процесса сортируются в порядке создания.
   В БД тот же формат выдаёт функция uuid_generate_v7() (миграция 0000) — она DEFAULT первичных ключей. */
let lastMs = 0;
let seq = 0;

export function uuidv7(now = Date.now()): string {
  let ms = now;
  if (ms <= lastMs) {
    ms = lastMs;
    seq = (seq + 1) & 0xfff;
    if (seq === 0) ms = ++lastMs; // счётчик переполнился — двигаем время вперёд
  } else {
    // старт со случайного небольшого значения: остаётся запас до переполнения
    seq = crypto.getRandomValues(new Uint16Array(1))[0]! & 0x3ff;
  }
  lastMs = ms;
  const b = crypto.getRandomValues(new Uint8Array(16));
  const t = BigInt(ms);
  for (let i = 0; i < 6; i++) b[i] = Number((t >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = 0x70 | (seq >> 8);
  b[7] = seq & 0xff;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const isUuid = (s: unknown): s is string =>
  typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
