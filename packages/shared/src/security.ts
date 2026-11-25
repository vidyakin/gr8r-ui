/* Browser-compatible TOTP, recovery codes and IP allowlists. */
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const RECOVERY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const STEP_MS = 30_000;

export function encodeBase32(bytes: Uint8Array): string {
  let result = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += BASE32[(buffer >>> bits) & 31];
    }
  }
  if (bits) result += BASE32[(buffer << (5 - bits)) & 31];
  return result;
}

export function decodeBase32(value: string): Uint8Array<ArrayBuffer> {
  if (!value.length) return new Uint8Array(0);
  const raw = value.toUpperCase();
  if (!/^[A-Z2-7]+={0,6}$/.test(raw)) throw new Error('Invalid Base32 secret');
  const encoded = raw.replace(/=+$/, '');
  const padding = raw.length - encoded.length;
  const requiredPadding = (8 - (encoded.length % 8)) % 8;
  if (![0, 1, 3, 4, 6].includes(requiredPadding) || (padding && padding !== requiredPadding))
    throw new Error('Invalid Base32 length');
  const bytes = new Uint8Array(Math.floor(encoded.length * 5 / 8));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const char of encoded) {
    buffer = (buffer << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (buffer >>> bits) & 255;
    }
  }
  if (buffer & ((1 << bits) - 1)) throw new Error('Invalid Base32 trailing bits');
  return bytes;
}

export const generateTotpSecret = () => encodeBase32(crypto.getRandomValues(new Uint8Array(20)));

export function totpUri(secret: string, account: string, issuer = 'gr8r'): string {
  const query = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?${query}`;
}

const totpKey = (secret: string) => crypto.subtle.importKey('raw', decodeBase32(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);

async function codeAt(key: CryptoKey, step: number): Promise<string> {
  const counter = new DataView(new ArrayBuffer(8));
  counter.setBigUint64(0, BigInt(step));
  const digest = new DataView(await crypto.subtle.sign('HMAC', key, counter));
  const offset = digest.getUint8(digest.byteLength - 1) & 15;
  const binary = digest.getUint32(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, '0');
}

export async function generateTotp(secret: string, time = Date.now()): Promise<string> {
  return codeAt(await totpKey(secret), Math.floor(time / STEP_MS));
}

/** Returns the matched counter so the server can reject reuse. */
export async function matchTotpStep(secret: string, code: string, time = Date.now()): Promise<number | null> {
  if (!TOTP_CODE_RE.test(code)) return null;
  const step = Math.floor(time / STEP_MS);
  const key = await totpKey(secret);
  const candidates = [step, step - 1, step + 1].filter(n => n >= 0);
  const expected = await Promise.all(candidates.map(n => codeAt(key, n)));
  const match = expected.findIndex(value => {
    let difference = 0;
    for (let i = 0; i < 6; i++) difference |= value.charCodeAt(i) ^ code.charCodeAt(i);
    return difference === 0;
  });
  return candidates[match] ?? null;
}

export async function verifyTotp(secret: string, code: string, time = Date.now()): Promise<boolean> {
  return (await matchTotpStep(secret, code, time)) !== null;
}

export const TOTP_CODE_RE = /^\d{6}$/;
export const RECOVERY_CODE_RE = /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/i;

export function generateRecoveryCodes(): string[] {
  const codes = new Set<string>();
  while (codes.size < 10) {
    const chars = Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => RECOVERY_ALPHABET[byte & 31]).join('');
    codes.add(`${chars.slice(0, 4)}-${chars.slice(4)}`);
  }
  return [...codes];
}

function ipv4(ip: string): bigint | null {
  const pieces = ip.split('.');
  if (pieces.length !== 4 || pieces.some(s => !/^(0|[1-9]\d{0,2})$/.test(s) || Number(s) > 255)) return null;
  return pieces.reduce((value, part) => (value << 8n) | BigInt(part), 0n);
}

function parseIp(text: string): { bits: 32 | 128; value: bigint } | null {
  if (/\s/.test(text)) return null;
  if (!text.includes(':')) {
    const value = ipv4(text);
    return value === null ? null : { bits: 32, value };
  }
  let address = text;
  if (address.includes('.')) {
    const colon = address.lastIndexOf(':');
    const tail = ipv4(address.slice(colon + 1));
    if (tail === null) return null;
    address = `${address.slice(0, colon + 1)}${(tail >> 16n).toString(16)}:${(tail & 0xffffn).toString(16)}`;
  }
  const halves = address.split('::');
  const fields = halves.flatMap(part => part ? part.split(':') : []);
  if (halves.length > 2 || fields.some(part => !/^[0-9a-f]{1,4}$/i.test(part))) return null;
  if (halves.length === 1 ? fields.length !== 8 : fields.length >= 8) return null;
  if (halves.length === 2) {
    const headLength = halves[0] ? halves[0].split(':').length : 0;
    fields.splice(headLength, 0, ...Array<string>(8 - fields.length).fill('0'));
  }
  const value = fields.reduce((result, part) => (result << 16n) | BigInt(`0x${part}`), 0n);
  return { bits: 128, value };
}

function parseNetwork(text: string) {
  const [address, mask, ...rest] = text.trim().split('/');
  const ip = parseIp(address!);
  if (!ip || rest.length || (mask !== undefined && !/^(0|[1-9]\d{0,2})$/.test(mask))) return null;
  const prefix = mask === undefined ? ip.bits : Number(mask);
  return prefix <= ip.bits ? { ...ip, prefix } : null;
}

export const isValidIpRange = (entry: string): boolean => parseNetwork(entry) !== null;

const isMappedIpv4 = (ip: { bits: number; value: bigint }) => ip.bits === 128 && ip.value >> 32n === 0xffffn;

export function isIpAllowed(address: string, allowlist: readonly string[]): boolean {
  if (!allowlist.length) return true;
  const parsed = parseIp(address.trim());
  if (!parsed) return false;
  // Dual-stack listeners may present the same IPv4 client as an IPv6 literal.
  const ip = isMappedIpv4(parsed) ? { bits: 32, value: parsed.value & 0xffffffffn } : parsed;
  return allowlist.some(entry => {
    const parsedNetwork = parseNetwork(entry);
    if (!parsedNetwork) return false;
    const network = parsedNetwork.prefix >= 96 && isMappedIpv4(parsedNetwork)
      ? { bits: 32, value: parsedNetwork.value & 0xffffffffn, prefix: parsedNetwork.prefix - 96 }
      : parsedNetwork;
    if (network.bits !== ip.bits) return false;
    const shift = BigInt(network.bits - network.prefix);
    return ip.value >> shift === network.value >> shift;
  });
}
