import { z } from 'zod';
import { defineNode } from '../types';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** «Имя: значение» по строке → объект заголовков (пустые и некорректные строки пропускаются) */
export function parseHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const name = line.slice(0, i).trim();
    if (/^[A-Za-z0-9-]+$/.test(name)) out[name] = line.slice(i + 1).trim();
  }
  return out;
}

const params = z.object({
  method: z.enum(HTTP_METHODS).default('POST').meta({ title: 'Method' }),
  url: z.string().min(1).max(2000).meta({ title: 'URL', ui: 'url', placeholder: 'https://example.com/webhook', description: 'http(s) only. Private and local addresses are blocked.' }),
  headers: z.string().max(4000).default('Content-Type: application/json').meta({ title: 'Headers (Name: value per line)', ui: 'textarea' }),
  body: z.string().max(50_000).default('{"title": "{{trigger.record.title}}"}').meta({ title: 'Body', ui: 'textarea' }),
});

export default defineNode({
  type: 'action.http_request',
  category: 'action',
  label: 'HTTP request',
  description: 'Calls a webhook. Timeouts and 5xx responses are retried; private addresses are blocked.',
  icon: 'globe',
  params,
  execute: async (p, rt) => {
    const res = await rt.http({ method: p.method, url: p.url.trim(), headers: parseHeaders(p.headers), body: p.method === 'GET' ? undefined : p.body });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(p.url.trim()).host}`);
    return { output: { status: res.status, body: res.body.slice(0, 2000), ...(res.json !== undefined ? { json: res.json } : {}) } };
  },
});
