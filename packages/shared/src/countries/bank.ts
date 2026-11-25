/** Call after validating the country-specific IBAN format. */
export function ibanChecksumOk(iban: string): boolean {
  let remainder = 0;
  for (const char of iban.slice(4) + iban.slice(0, 4)) {
    const code = char.charCodeAt(0);
    remainder = code >= 65
      ? (remainder * 100 + code - 55) % 97
      : (remainder * 10 + code - 48) % 97;
  }
  return remainder === 1;
}

export const isValidSwiftBic = (value: string) => /^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(value);
