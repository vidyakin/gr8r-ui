/* Узел «Отправить в Telegram» и клиент Bot API: fetch подменён, сети нет. */
import { describe, expect, test } from 'bun:test';
import { NODE_DEFS, TransientError, telegramGetMe, telegramSendMessage } from '../src';

const TOKEN = '123456:SECRET-token';
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const fake = (res: () => Response | Promise<Response>, calls: { url: string; init: RequestInit }[] = []) =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return res();
  }) as unknown as typeof fetch;

describe('telegram client', () => {
  test('sendMessage: адрес, тело и id сообщения', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const r = await telegramSendMessage(TOKEN, { chatId: '-100', text: 'Привет', parseMode: 'HTML' }, { fetch: fake(() => reply(200, { ok: true, result: { message_id: 7 } }), calls) });
    expect(r).toEqual({ messageId: 7 });
    expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ chat_id: '-100', text: 'Привет', parse_mode: 'HTML' });
  });
  test('ok:false — обычная ошибка с описанием, без токена', async () => {
    const f = fake(() => reply(400, { ok: false, error_code: 400, description: `Bad Request: chat not found ${TOKEN}` }));
    const e = await telegramSendMessage(TOKEN, { chatId: '1', text: 'x' }, { fetch: f }).catch(x => x as Error);
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(TransientError);
    expect((e as Error).message).toContain('chat not found');
    expect((e as Error).message).not.toContain(TOKEN);
  });
  test('429, 5xx и сетевой сбой — временные; токен из текста сбоя убран', async () => {
    for (const st of [429, 502]) {
      const e = await telegramSendMessage(TOKEN, { chatId: '1', text: 'x' }, { fetch: fake(() => reply(st, { ok: false, description: 'later' })) }).catch(x => x);
      expect(e).toBeInstanceOf(TransientError);
    }
    const net = fake(() => { throw new Error(`connect ECONNREFUSED https://api.telegram.org/bot${TOKEN}/sendMessage`); });
    const e = await telegramSendMessage(TOKEN, { chatId: '1', text: 'x' }, { fetch: net }).catch(x => x as Error);
    expect(e).toBeInstanceOf(TransientError);
    expect((e as Error).message).not.toContain(TOKEN);
  });
  test('таймаут — временная ошибка', async () => {
    const slow = ((_u: unknown, init?: RequestInit) => new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(init.signal!.reason)))) as unknown as typeof fetch;
    const e = await telegramGetMe(TOKEN, { fetch: slow, timeoutMs: 20 }).catch(x => x);
    expect(e).toBeInstanceOf(TransientError);
    expect(e.message).toContain('timed out');
  });
  test('getMe: имя бота', async () => {
    const r = await telegramGetMe(TOKEN, { fetch: fake(() => reply(200, { ok: true, result: { id: 1, username: 'erp_bot', first_name: 'ERP' } })) });
    expect(r).toEqual({ id: 1, username: 'erp_bot', name: 'ERP' });
  });
});

describe('action.telegram_send', () => {
  const d = NODE_DEFS['action.telegram_send']!;
  test('вызывает порт; HTML передаётся, none — нет', async () => {
    const calls: unknown[] = [];
    const rt = { telegramSend: async (a: unknown) => (calls.push(a), { messageId: 5 }) } as never;
    const r = await d.execute(d.params.parse({ chatId: ' -100 ', text: 'Hi <b>x</b>', parseMode: 'HTML' }), rt);
    await d.execute(d.params.parse({ chatId: '@chan', text: 'plain' }), rt);
    expect(calls).toEqual([{ chatId: '-100', text: 'Hi <b>x</b>', parseMode: 'HTML' }, { chatId: '@chan', text: 'plain', parseMode: undefined }]);
    expect(r.output).toEqual({ chatId: '-100', messageId: 5 });
  });
  test('пустой чат или текст — ошибка; ошибка порта пробрасывается', async () => {
    const rt = { telegramSend: async () => { throw new Error('Telegram bot token is not set'); } } as never;
    await expect(d.execute(d.params.parse({ chatId: '  ', text: 'x' }), rt)).rejects.toThrow('Chat ID');
    await expect(d.execute(d.params.parse({ chatId: '1', text: '  ' }), rt)).rejects.toThrow('Message');
    await expect(d.execute(d.params.parse({ chatId: '1', text: 'x' }), rt)).rejects.toThrow('token is not set');
  });
});
