import { describe, expect, test } from 'bun:test';
import {
  decodeBase32, encodeBase32, generateRecoveryCodes, generateTotp, generateTotpSecret,
  isIpAllowed, isValidIpRange, RECOVERY_CODE_RE, totpUri, verifyTotp,
} from '../src/security';

const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('TOTP', () => {
  test('matches the last six digits of the RFC 6238 SHA-1 vectors', async () => {
    const vectors = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
      [20000000000, '353130'],
    ] as const;
    for (const [seconds, expected] of vectors)
      expect(await generateTotp(RFC_SECRET, seconds * 1000)).toBe(expected);
  });

  test('accepts precisely one step of clock skew', async () => {
    const now = 1234567890 * 1000;
    const code = await generateTotp(RFC_SECRET, now);
    for (const skew of [-30_000, 0, 30_000]) expect(await verifyTotp(RFC_SECRET, code, now + skew)).toBe(true);
    for (const skew of [-60_000, 60_000]) expect(await verifyTotp(RFC_SECRET, code, now + skew)).toBe(false);
    expect(await verifyTotp(RFC_SECRET, '000000', now)).toBe(false);
    expect(await verifyTotp(RFC_SECRET, '12345', now)).toBe(false);
  });

  test('encodes Base32 with or without padding and builds an authenticator URI', () => {
    expect(encodeBase32(new TextEncoder().encode('foobar'))).toBe('MZXW6YTBOI');
    expect(new TextDecoder().decode(decodeBase32('mzxw6ytboi======'))).toBe('foobar');
    expect(() => decodeBase32('A')).toThrow();
    expect(() => decodeBase32('MZ')).toThrow();
    expect(decodeBase32(generateTotpSecret()).byteLength).toBe(20);
    const uri = new URL(totpUri(RFC_SECRET, 'test+2fa@example.test', 'gr8r test'));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.hostname).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/gr8r test:test+2fa@example.test');
    expect(uri.searchParams.get('secret')).toBe(RFC_SECRET);
    expect(uri.searchParams.get('digits')).toBe('6');
    expect(uri.searchParams.get('period')).toBe('30');
  });
});

describe('IP allowlist', () => {
  test('matches IPv4 hosts and networks, including boundary addresses', () => {
    const list = ['192.168.1.0/24', '95.25.126.187'];
    for (const ip of ['192.168.1.0', '192.168.1.255', '95.25.126.187', '::ffff:192.168.1.20', '::ffff:c0a8:101'])
      expect(isIpAllowed(ip, list)).toBe(true);
    for (const ip of ['192.168.2.0', '95.25.126.188', '::1', 'unknown'])
      expect(isIpAllowed(ip, list)).toBe(false);
    expect(isIpAllowed('203.0.113.12', ['0.0.0.0/0'])).toBe(true);
    expect(isIpAllowed('unknown', [])).toBe(true);
  });

  test('matches IPv6 hosts, embedded IPv4 and non-byte-aligned prefixes', () => {
    expect(isIpAllowed('2001:0DB8:1234::abc', ['2001:db8::/32'])).toBe(true);
    expect(isIpAllowed('2001:db9::1', ['2001:db8::/32'])).toBe(false);
    expect(isIpAllowed('2001:db8:7fff::', ['2001:db8::/33'])).toBe(true);
    expect(isIpAllowed('2001:db8:8000::', ['2001:db8::/33'])).toBe(false);
    expect(isIpAllowed('::1', ['0:0:0:0:0:0:0:1'])).toBe(true);
    expect(isIpAllowed('192.0.2.25', ['::ffff:192.0.2.0/120'])).toBe(true);
    expect(isIpAllowed('192.0.2.25', ['::/0'])).toBe(false);
    expect(isIpAllowed('::ffff:192.0.2.25', ['::/0'])).toBe(false);
  });

  test('rejects malformed literals and prefixes', () => {
    for (const range of ['192.168.001.1', '256.0.0.0', '127.1', '1.2.3.4:80', '2001:::1', '::1::2', '::ffff:1.2.3.999',
      '1:2:3:4:5:6:7:8::', '1:2:3:4:5:6:7:8:9', 'fe80::1%en0', '[::1]', '::/129', '10.0.0.1/33', '::/01', '::/-1', '::/', '::/64/32']) {
      expect(isValidIpRange(range)).toBe(false);
      expect(isIpAllowed('::1', [range])).toBe(false);
    }
    for (const range of ['::/0', '::1/128', '2001:db8::/32', '10.0.0.1/32', '192.168.1.0/24'])
      expect(isValidIpRange(range)).toBe(true);
  });
});

test('generates ten unique readable recovery codes', () => {
  const codes = generateRecoveryCodes();
  expect(codes).toHaveLength(10);
  expect(new Set(codes).size).toBe(codes.length);
  for (const code of codes) expect(code).toMatch(RECOVERY_CODE_RE);
});
