/* Безопасный скрапер сайтов клиентов (SSRF-защита, извлечение текста и внутренних страниц). */
import { lookup } from 'node:dns/promises';

const MAX_BYTES = 500 * 1024;
const FETCH_TIMEOUT_MS = 6_000;
const MAX_REDIRECTS = 2;
const MIN_TEXT_LENGTH = 150;
const MAX_TEXT_LENGTH = 12_000;
const TARGET_PATH_RE = /^\/(?:about|about-us|company|o-kompanii|o-nas|services|uslugi|products|produkty|contacts|kontakty)(?:\/|$)/i;

export type ScraperFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function isPrivateIp(raw: string): boolean {
  const ip = raw.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (ip.startsWith('::ffff:')) return isPrivateIp(ip.slice(7));
  if (ip.includes(':')) {
    if (ip === '::1' || ip === '::' || ip === '0:0:0:0:0:0:0:1') return true;
    const head = parseInt(ip.split(':')[0] || '0', 16);
    if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7
    if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10
    return false;
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export async function assertSafeUrl(
  rawUrl: string,
  lookupFn: typeof lookup = lookup,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed');
  }
  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error('Blocked private or local host');
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) {
    if (isPrivateIp(host)) throw new Error('Blocked private IP address');
    return url;
  }
  const records = await lookupFn(host, { all: true });
  if (!records.length || records.some(r => isPrivateIp(r.address))) {
    throw new Error('Blocked private or unresolvable host');
  }
  return url;
}

const ENTITY_MAP: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", mdash: '—', ndash: '–',
};

export function extractTextFromHtml(html: string): string {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|iframe|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(?:p|div|br|li|tr|h[1-6]|section|article|header|footer|main)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, ent: string) => {
      if (ent.startsWith('#x') || ent.startsWith('#X')) return String.fromCharCode(parseInt(ent.slice(2), 16));
      if (ent.startsWith('#')) return String.fromCharCode(parseInt(ent.slice(1), 10));
      return ENTITY_MAP[ent.toLowerCase()] ?? ' ';
    });
  return cleaned
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export function extractInternalLinks(html: string, baseUrl: string): string[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const found = new Set<string>();
  const re = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const href = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    try {
      const u = new URL(href, base);
      if (u.origin !== base.origin || (u.protocol !== 'http:' && u.protocol !== 'https:')) continue;
      u.hash = '';
      if (u.pathname === base.pathname) continue;
      if (TARGET_PATH_RE.test(u.pathname)) found.add(u.toString());
    } catch {
      // ignore malformed href
    }
  }
  return [...found];
}

async function readBodyLimited(res: Response): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const slice = total + value.byteLength > MAX_BYTES ? value.subarray(0, MAX_BYTES - total) : value;
      chunks.push(slice);
      total += slice.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

async function fetchSafeHtml(
  rawUrl: string,
  fetchFn: ScraperFetch,
  lookupFn: typeof lookup,
): Promise<{ ok: true; html: string; finalUrl: string } | { ok: false; reason: string }> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const safeUrl = await assertSafeUrl(current, lookupFn);
    let res: Response;
    try {
      res = await fetchFn(safeUrl.toString(), {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': 'FutureERP-Bot/1.0 (+https://future-erp.ru)', Accept: 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : 'Network error' };
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc || hop === MAX_REDIRECTS) return { ok: false, reason: 'Too many redirects' };
      current = new URL(loc, safeUrl).toString();
      continue;
    }
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const html = await readBodyLimited(res);
    return { ok: true, html, finalUrl: safeUrl.toString() };
  }
  return { ok: false, reason: 'Too many redirects' };
}

export type ScrapeResult =
  | { ok: true; text: string; rawTextLength: number; pagesScraped: number }
  | { ok: false; reason: string; rawTextLength: number };

export async function scrapeWebsite(
  rawUrl: string,
  fetchFn: ScraperFetch = fetch,
  lookupFn: typeof lookup = lookup,
): Promise<ScrapeResult> {
  const normalized = /^[a-z][a-z0-9+.-]*:/i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
  const main = await fetchSafeHtml(normalized, fetchFn, lookupFn);
  if (!main.ok) return { ok: false, reason: main.reason, rawTextLength: 0 };

  const parts = [extractTextFromHtml(main.html)];
  const links = extractInternalLinks(main.html, main.finalUrl).slice(0, 2);
  let pagesScraped = 1;
  if (links.length) {
    const subResults = await Promise.all(links.map(l => fetchSafeHtml(l, fetchFn, lookupFn).catch(() => null)));
    for (const r of subResults) {
      if (r && r.ok) {
        const subText = extractTextFromHtml(r.html);
        if (subText) {
          parts.push(subText);
          pagesScraped++;
        }
      }
    }
  }
  const combined = parts.filter(Boolean).join('\n\n').slice(0, MAX_TEXT_LENGTH);
  if (combined.length < MIN_TEXT_LENGTH) {
    return { ok: false, reason: 'Not enough readable text on page (possible SPA or bot protection)', rawTextLength: combined.length };
  }
  return { ok: true, text: combined, rawTextLength: combined.length, pagesScraped };
}
