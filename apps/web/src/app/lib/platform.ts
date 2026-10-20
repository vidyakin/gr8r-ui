export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
/** Подпись модификатора для подсказок: ⌘ на Mac, Ctrl в остальных системах */
export const MOD = isMac ? '⌘' : 'Ctrl';
