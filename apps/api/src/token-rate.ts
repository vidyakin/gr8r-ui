/* Лимит частоты запросов на токен агента (docs/architecture/mcp.md, «Лимит частоты»): окно в минуту в памяти процесса.
   Внутренние вызовы инструментов MCP (заголовок INTERNAL_HEADER с секретом процесса) не считаются — считается сам /mcp. */
import { AppError } from './errors';

/** Заголовок внутреннего вызова API из инструментов MCP; секрет живёт только в памяти процесса */
export const INTERNAL_HEADER = 'x-gr8r-internal';
export const INTERNAL_SECRET = Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');

const WINDOW_MS = 60_000;
const windows = new Map<string, { start: number; n: number }>();

/** Запросов в минуту на токен: API_TOKEN_RATE_LIMIT, по умолчанию 120 */
export const tokenRateLimit = () => Number(process.env.API_TOKEN_RATE_LIMIT) || 120;

/** Учесть запрос токена; сверх лимита — 429 token_rate_limited с Retry-After в details */
export function hitTokenRate(tokenId: string, now = Date.now(), limit = tokenRateLimit()): void {
  let w = windows.get(tokenId);
  if (!w || now - w.start >= WINDOW_MS) {
    w = { start: now, n: 0 };
    windows.set(tokenId, w);
    if (windows.size > 10_000) for (const [k, v] of windows) if (now - v.start >= WINDOW_MS) windows.delete(k);
  }
  w.n++;
  if (w.n > limit) {
    const retryAfter = Math.max(1, Math.ceil((w.start + WINDOW_MS - now) / 1000));
    throw new AppError(429, 'token_rate_limited', `Too many requests for this access token, retry in ${retryAfter}s`, { retryAfter });
  }
}

/** Только для тестов */
export const resetTokenRate = () => windows.clear();
