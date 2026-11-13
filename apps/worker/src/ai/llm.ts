/* Минимальный клиент OpenAI-совместимого API (задача estimate.ai_extract, извлечение сметы из документов):
   POST /chat/completions со structured output (json_schema) и температурой 0. Внешняя сеть — только из воркера;
   конфигурация из окружения, runtime-объект подменяется в тестах (как requestHookRuntime). Ошибки сети, 429 и 5xx —
   TransientError: задача повторится по расписанию воркера, остальные ошибки не повторяются вслепую. */
import { TransientError } from '@gr8r/shared';

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

/** Конфигурация ИИ из окружения: AI_API_BASE (по умолчанию OpenAI), AI_API_KEY, AI_MODEL, AI_TIMEOUT_MS.
    Нет ключа — null: задача сразу отвечает без разметки, фронт уходит на сопоставление колонок.
    Таймаут по умолчанию 5 минут: разметка большой сметы генерируется минуту-две (стримингом). */
export const llmRuntime: { fetch: (input: string, init?: RequestInit) => Promise<Response>; config: () => LlmConfig | null } = {
  fetch: (input, init) => fetch(input, init),
  config: () => {
    const apiKey = process.env.AI_API_KEY?.trim();
    if (!apiKey) return null;
    return {
      baseUrl: process.env.AI_API_BASE?.trim() || 'https://api.openai.com/v1',
      apiKey,
      model: process.env.AI_MODEL?.trim() || 'gpt-4o-mini',
      timeoutMs: Math.min(600_000, Math.max(5_000, Number(process.env.AI_TIMEOUT_MS) || 300_000)),
    };
  },
};

/** JSON-схема строгого вывода (OpenAI strict mode: всё required, доп. свойства запрещены) */
export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
}

type LlmContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail: 'high' } };

export interface LlmMessage {
  role: 'system' | 'user';
  content: string | LlmContentPart[];
}

/** Один запрос к модели: сообщения + схема вывода → разобранный JSON. Ответ обязан соответствовать схеме
    (провайдеры её принуждают), повторная валидация делается вызывающим кодом своей zod-схемой.
    Запрос идёт стримингом: долгая генерация (разметка сметы идёт минуту-две) не укладывается в лимит
    прокси-провайдеров на non-streaming ответы (~20 с без байтов — соединение сбрасывается), а чуки
    приходят с первых токенов и держат соединение живым. Провайдер без стриминга (вернул обычный JSON)
    тоже поддерживается — смотрим на content-type ответа. */
export async function chatJson(schema: JsonSchema, messages: LlmMessage[]): Promise<unknown> {
  const cfg = llmRuntime.config();
  if (!cfg) throw new Error('LLM is not configured: AI_API_KEY is not set');
  let res: Response;
  try {
    res = await llmRuntime.fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        stream: true,
        messages,
        response_format: { type: 'json_schema', json_schema: { name: 'result', strict: true, schema } },
      }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
  } catch (e) {
    throw new TransientError(`LLM request failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status === 429 || res.status >= 500) throw new TransientError(`LLM responded ${res.status}`);
  if (!res.ok) throw new Error(`LLM responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
  // чтение потока — отдельно от разбора JSON: обрыв сети/таймаут посреди генерации повторяемы
  // (медленный провайдер — обычное дело), а вот кривой JSON модели повторять бессмысленно
  let raw: string | unknown;
  try {
    raw = (res.headers.get('content-type') ?? '').includes('text/event-stream') ? await readSseContent(res) : await readJsonContent(res);
  } catch (e) {
    throw new TransientError(`LLM stream failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  let content: unknown = raw;
  if (typeof raw === 'string') {
    try {
      content = JSON.parse(raw);
    } catch (e) {
      throw new Error(`LLM returned malformed JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (content === null || typeof content !== 'object') throw new Error('LLM returned no JSON object');
  return content;
}

/** Обычный (нестриминговый) ответ: сырое content из choices[0].message (строка или уже объект) */
async function readJsonContent(res: Response): Promise<string | unknown> {
  const body = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
  return body.choices?.[0]?.message?.content ?? null;
}

/** SSE-поток OpenAI-совместимого API: накопление choices[0].delta.content до [DONE] */
async function readSseContent(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let content = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue; // keep-alive и комментарии пропускаем
      const data = line.slice(6);
      if (data === '[DONE]') return content;
      try {
        const delta = (JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content;
        if (delta) content += delta;
      } catch {
        // обрыв посреди JSON-чанка не должен ронять весь ответ: следующий кусок допарсится
      }
    }
  }
  return content;
}
