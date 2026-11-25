/** Split and round a decimal amount without converting it to a floating-point number. */
export function splitAmount(amount: string | number) {
  const s = String(amount).trim();
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === '' && !m[3])) throw new RangeError(`Not a decimal amount: "${s}"`);
  const frac = (m[3] ?? '').padEnd(3, '0');
  let minor = BigInt(frac.slice(0, 2));
  let major = BigInt(m[2] || '0');
  if (Number(frac[2]) >= 5) minor += 1n;
  if (minor >= 100n) {
    minor -= 100n;
    major += 1n;
  }
  const neg = m[1] === '-' && (major > 0n || minor > 0n);
  return { major, minor, negative: neg };
}
