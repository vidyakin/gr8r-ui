/* Исходящие HTTP-запросы узла «HTTP-запрос» с защитой от SSRF: только http(s), без учётных данных в адресе, имя хоста
   и все его адреса из DNS не должны быть частными/служебными, редиректы идут вручную с той же проверкой на каждом шаге.
   Таймаут и лимит размера ответа обязательны. Временные сбои (сеть, таймаут, 408/429/5xx) — TransientError: шаг повторится.
   DNS rebinding: подключение идёт к уже проверенному адресу (IP подставляется в URL, Host и имя TLS — исходные, сертификат
   проверяется по имени хоста), поэтому второй DNS-запрос в момент подключения ничего не меняет. */
import { lookup } from 'node:dns/promises';
import { isForbiddenHostname, isIpLiteral, isPrivateAddress, TransientError, type HttpRequest, type HttpResult } from '@gr8r/shared';

export interface HttpOptions {
  /** Разрешить частные адреса (только для тестов и закрытых установок: FLOW_HTTP_ALLOW_PRIVATE=1) */
  allowPrivate: boolean;
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  resolve: (host: string) => Promise<string[]>;
}

export const defaultHttpOptions = (): HttpOptions => ({
  allowPrivate: process.env.FLOW_HTTP_ALLOW_PRIVATE === '1',
  timeoutMs: Number(process.env.FLOW_HTTP_TIMEOUT_MS ?? 10_000),
  maxBytes: 1_000_000,
  maxRedirects: 3,
  resolve: async host => (await lookup(host, { all: true })).map(a => a.address),
});

const DROP_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'proxy-authorization']);

/** Бросает обычную Error, если адрес запрещён. Возвращает разобранный URL */
export async function assertPublicUrl(raw: string, o: Pick<HttpOptions, 'allowPrivate' | 'resolve'>): Promise<URL> {
  return (await resolvePublic(raw, o)).url;
}

/** Проверенный адрес назначения: URL и IP, к которому подключаться (null — хост уже IP или проверка отключена) */
export async function resolvePublic(raw: string, o: Pick<HttpOptions, 'allowPrivate' | 'resolve'>): Promise<{ url: URL; address: string | null }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: "${raw.slice(0, 100)}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http and https URLs are allowed');
  if (url.username || url.password) throw new Error('Credentials in the URL are not allowed');
  if (o.allowPrivate) return { url, address: null };
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIpLiteral(host)) {
    if (isPrivateAddress(host)) throw new Error('Requests to private or local addresses are blocked');
    return { url, address: null };
  }
  if (isForbiddenHostname(host)) throw new Error('Requests to private or local addresses are blocked');
  let addrs: string[];
  try {
    addrs = await o.resolve(host);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'ENOTFOUND' || code === 'ENODATA') throw new Error(`Host not found: ${host}`);
    throw new TransientError(`DNS lookup failed for ${host}`);
  }
  if (!addrs.length) throw new Error(`Host not found: ${host}`);
  if (addrs.some(isPrivateAddress)) throw new Error('Requests to private or local addresses are blocked');
  return { url, address: addrs[0]! };
}

/** Запрос к закреплённому адресу: IP в URL, исходный Host и имя TLS (SNI и проверка сертификата по имени хоста) */
export function pinnedRequest(url: URL, address: string | null): { target: URL; host: string | null; serverName: string | null } {
  if (!address) return { target: url, host: null, serverName: null };
  const target = new URL(url.toString());
  target.hostname = address.includes(':') ? `[${address}]` : address;
  return { target, host: url.host, serverName: url.protocol === 'https:' ? url.hostname : null };
}

async function readLimited(res: Response, max: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    chunks.push(value);
    if (size >= max) {
      await reader.cancel();
      break;
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, max));
}

export async function guardedFetch(req: HttpRequest, o: HttpOptions = defaultHttpOptions()): Promise<HttpResult> {
  let method = req.method.toUpperCase();
  let body = req.body;
  let { url, address } = await resolvePublic(req.url, o);
  const headers: Record<string, string> = { 'user-agent': 'gr8r-automation/1.0' };
  for (const [k, v] of Object.entries(req.headers)) if (!DROP_HEADERS.has(k.toLowerCase())) headers[k.toLowerCase()] = v;

  for (let hop = 0; ; hop++) {
    let res: Response;
    try {
      const pin = pinnedRequest(url, address);
      res = await fetch(pin.target, {
        method,
        headers: pin.host ? { ...headers, host: pin.host } : headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
        redirect: 'manual',
        signal: AbortSignal.timeout(o.timeoutMs),
        ...(pin.serverName ? { tls: { serverName: pin.serverName } } : {}),
      } as RequestInit);
    } catch (e) {
      const name = (e as Error).name;
      throw new TransientError(name === 'TimeoutError' || name === 'AbortError' ? `Request timed out after ${o.timeoutMs} ms` : `Network error: ${(e as Error).message}`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      await res.body?.cancel();
      if (hop >= o.maxRedirects) throw new Error('Too many redirects');
      ({ url, address } = await resolvePublic(new URL(res.headers.get('location')!, url).toString(), o));
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
        method = 'GET';
        body = undefined;
      }
      continue;
    }
    let text: string;
    try {
      text = await readLimited(res, o.maxBytes);
    } catch (e) {
      throw new TransientError(`Failed to read the response: ${(e as Error).message}`);
    }
    if (res.status >= 500 || res.status === 429 || res.status === 408) throw new TransientError(`HTTP ${res.status} from ${url.host}`);
    const out: HttpResult = { status: res.status, ok: res.ok, headers: Object.fromEntries(res.headers.entries()), body: text };
    if ((res.headers.get('content-type') ?? '').includes('json')) {
      try {
        out.json = JSON.parse(text);
      } catch {
        /* не JSON, несмотря на заголовок */
      }
    }
    return out;
  }
}
