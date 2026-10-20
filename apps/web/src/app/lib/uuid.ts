/* UUID v7 на клиенте: идентификаторы сущностей создаются до ответа сервера (оптимистичные обновления, Undo),
   сервер принимает их как есть. Сортируются по времени, как и серверные. */
let lastMs = 0;
let counter = 0;

export function uuidv7(): string {
  const now = Date.now();
  if (now > lastMs) {
    lastMs = now;
    counter = 0;
  } else {
    counter++; // монотонность внутри одной миллисекунды
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[0] = (lastMs / 2 ** 40) & 0xff;
  b[1] = (lastMs / 2 ** 32) & 0xff;
  b[2] = (lastMs / 2 ** 24) & 0xff;
  b[3] = (lastMs / 2 ** 16) & 0xff;
  b[4] = (lastMs / 2 ** 8) & 0xff;
  b[5] = lastMs & 0xff;
  b[6] = 0x70 | ((counter >> 8) & 0x0f);
  b[7] = counter & 0xff;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Ключ нового статуса-колонки: строчные буквы и цифры, начинается с буквы (так требует API) */
export const newStatusKey = () => 'st' + Math.random().toString(36).slice(2, 8).padEnd(6, '0');
