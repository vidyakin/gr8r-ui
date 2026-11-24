/* Подпись считается по точным байтам тела. Исходящий запрос закрепляет проверенный DNS-адрес. */
import { createHmac } from 'node:crypto';
import { defaultHttpOptions, guardedFetch } from './flows/http';

export function webhookSignature(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
}

export async function sendWebhook(url: string, secret: string, body: string) {
  const options = { ...defaultHttpOptions(), allowPrivate: false, timeoutMs: 10_000, maxRedirects: 0, maxBytes: 4096 };
  return guardedFetch({ url, method: 'POST', body, headers: {
    'content-type': 'application/json',
    'x-futureerp-signature': webhookSignature(secret, body),
  } }, options);
}
