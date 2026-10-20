/* Защита от SSRF для узла «HTTP-запрос»: запрещены адреса частных, loopback, link-local и служебных диапазонов.
   Чистые функции (без DNS): разрешение имён и проверку каждого адреса делает воркер. */

function ipv4Parts(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.every(n => n <= 255) ? p : null;
}

function privateV4([a, b, c]: number[]): boolean {
  return (
    a === 0 || // «эта сеть»
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, метаданные облака
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a! >= 224 // multicast, зарезервированные, broadcast
  );
}

/** Разворачивает IPv6 в восемь 16-битных групп; null — не IPv6 */
function ipv6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const p = ipv4Parts(v4[1]!);
    if (!p) return null;
    s = s.slice(0, -v4[1]!.length) + ((p[0]! << 8) | p[1]!).toString(16) + ':' + ((p[2]! << 8) | p[3]!).toString(16);
  }
  if (!/^[0-9a-f:]+$/.test(s) || s.split('::').length > 2) return null;
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const fill = s.includes('::') ? 8 - h.length - t.length : 0;
  if (fill < 0 || (!s.includes('::') && h.length !== 8)) return null;
  const groups = [...h, ...Array(fill).fill('0'), ...t].map(g => parseInt(g || '0', 16));
  return groups.length === 8 && groups.every(g => g >= 0 && g <= 0xffff) ? groups : null;
}

/** true — адрес нельзя использовать в исходящем запросе (частный, служебный или не разбирается как IP) */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ipv4Parts(ip);
  if (v4) return privateV4(v4);
  const g = ipv6Groups(ip);
  if (!g) return true;
  const [a, b, c, d, e, f, g6, g7] = g as [number, number, number, number, number, number, number, number];
  if (g.every(x => x === 0)) return true; // ::
  if (g.slice(0, 7).every(x => x === 0) && g7 === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible и NAT64 (64:ff9b::/96): проверяем вложенный IPv4
  if ((a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && (f === 0xffff || f === 0)) || (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0)) {
    return privateV4([g6 >> 8, g6 & 255, g7 >> 8, g7 & 255]);
  }
  if ((a & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((a & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((a & 0xffc0) === 0xfec0) return true; // site-local (устарело)
  if ((a & 0xff00) === 0xff00) return true; // multicast
  if (a === 0x2001 && b === 0x0db8) return true; // документация
  return false;
}

/** Имена, которые заведомо ведут внутрь сети (до DNS-разрешения) */
export function isForbiddenHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan');
}

export const isIpLiteral = (host: string) => ipv4Parts(host) !== null || host.includes(':');
