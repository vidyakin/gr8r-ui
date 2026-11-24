/** Контрольная цифра EAN-13 для двенадцати цифр. */
export function ean13CheckDigit(base: string): string {
  if (!/^\d{12}$/.test(base)) throw new Error('EAN-13 requires 12 digits');
  const sum = [...base].reduce((n, d, i) => n + Number(d) * (i % 2 ? 3 : 1), 0);
  return String((10 - sum % 10) % 10);
}

export function isEan13(value: string): boolean {
  return /^\d{13}$/.test(value) && ean13CheckDigit(value.slice(0, 12)) === value[12];
}

/** Внутренний диапазон 200–299, девять следующих цифр — случайный номер. */
export function internalEan13(number: number): string {
  if (!Number.isInteger(number) || number < 0 || number >= 100_000_000_000) throw new Error('Invalid internal barcode number');
  const base = String(200_000_000_000 + number);
  return base + ean13CheckDigit(base);
}

export function allocateEan13(used: Set<string>, random: () => number): string {
  for (let i = 0; i < 1000; i++) {
    const code = internalEan13(random());
    if (!used.has(code)) { used.add(code); return code; }
  }
  throw new Error('Unable to allocate barcode');
}
