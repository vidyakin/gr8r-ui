/* Telegram Bot API (уведомления): один вызов метода бота. Токен берётся из хранилища секретов воркспейса
   (`telegram.bot_token`, docs/architecture/secrets.md) и в сообщения об ошибках не попадает. Сеть приходит снаружи (`fetch`),
   поэтому код проверяется в тестах без реальных запросов. */
import { TransientError } from './automations/types';

export const TELEGRAM_TOKEN_SECRET = 'telegram.bot_token';
const TELEGRAM_BASE = 'https://api.telegram.org';

export interface TelegramOpts {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Убирает токен из текста (в адресе запроса он есть, а некоторые среды кладут адрес в сообщение об ошибке сети) */
const mask = (s: string, token: string) => (token ? s.split(token).join('***') : s);

/** Вызов метода Bot API. Временный сбой (сеть, таймаут, 429, 5xx) — TransientError; отказ Telegram (ok:false) — обычная Error с описанием */
export async function telegramCall(token: string, method: string, body: Record<string, unknown>, o: TelegramOpts = {}): Promise<Record<string, unknown>> {
  const f = o.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(`${TELEGRAM_BASE}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(o.timeoutMs ?? 10_000),
    });
  } catch (e) {
    const name = (e as { name?: string }).name;
    throw new TransientError(name === 'TimeoutError' || name === 'AbortError' ? 'Telegram request timed out' : `Telegram is unreachable: ${mask(String((e as Error)?.message ?? e), token).slice(0, 200)}`);
  }
  type Reply = { ok?: boolean; result?: unknown; description?: string; error_code?: number };
  const json = (await res.json().catch(() => null)) as Reply | null;
  if (json?.ok === true) return (json.result && typeof json.result === 'object' ? json.result : {}) as Record<string, unknown>;
  const desc = mask(String(json?.description ?? '').slice(0, 300), token);
  const status = json?.error_code ?? res.status;
  const msg = `Telegram error ${status}${desc ? `: ${desc}` : ''}`;
  if (res.status === 429 || res.status >= 500) throw new TransientError(msg);
  throw new Error(msg);
}

/** getMe: имя бота для проверки токена */
export async function telegramGetMe(token: string, o?: TelegramOpts): Promise<{ id: number | null; username: string; name: string }> {
  const r = await telegramCall(token, 'getMe', {}, o);
  return { id: typeof r.id === 'number' ? r.id : null, username: String(r.username ?? ''), name: String(r.first_name ?? '') };
}

/** sendMessage: возвращает id отправленного сообщения */
export async function telegramSendMessage(token: string, a: { chatId: string; text: string; parseMode?: string }, o?: TelegramOpts): Promise<{ messageId: number | null }> {
  const body: Record<string, unknown> = { chat_id: a.chatId, text: a.text };
  if (a.parseMode) body.parse_mode = a.parseMode;
  const r = await telegramCall(token, 'sendMessage', body, o);
  return { messageId: typeof r.message_id === 'number' ? r.message_id : null };
}
