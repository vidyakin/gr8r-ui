/* Код бейджа работника (задача 1271, docs/architecture/construction.md): 'W' + 8 символов base32.
   Код идентифицирует участника, но не даёт доступа к приложению и не содержит ставки.
   Алфавит без похожих символов (0/O, 1/I/L) — код печатается и вводится руками. */

export const BADGE_CODE_PREFIX = 'W';
/** base32 без похожих 0/O и 1/I: 24 буквы + 8 цифр = 32 символа */
export const BADGE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const BADGE_CODE_LENGTH = 8;

/** Новый код бейджа из случайных чисел (0..1); по умолчанию Math.random */
export function badgeCode(random: () => number = Math.random): string {
  let out = BADGE_CODE_PREFIX;
  for (let i = 0; i < BADGE_CODE_LENGTH; i++) {
    const r = Math.floor(random() * BADGE_CODE_ALPHABET.length);
    out += BADGE_CODE_ALPHABET[Math.min(Math.max(r, 0), BADGE_CODE_ALPHABET.length - 1)];
  }
  return out;
}

/** Код для сравнения: без пробелов и в верхнем регистре (скан камеры и ручной ввод дают разный регистр и пробелы) */
export const normalizeBadgeCode = (code: string): string => code.replace(/\s+/g, '').toUpperCase();
