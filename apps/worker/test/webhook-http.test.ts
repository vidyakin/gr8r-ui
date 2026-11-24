import { describe, expect, test } from 'bun:test';
import { webhookSignature, sendWebhook } from '../src/webhook-http';

describe('webhook HTTP', () => {
  test('signs the exact UTF-8 body with HMAC-SHA256', () => {
    expect(webhookSignature('key', 'The quick brown fox jumps over the lazy dog')).toBe('sha256=f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
    expect(webhookSignature('key', '{"text":"ёж"}')).not.toBe(webhookSignature('key', '{"text": "ёж"}'));
  });
  test('refuses private destinations even if automation private access is enabled', async () => {
    const previous = process.env.FLOW_HTTP_ALLOW_PRIVATE;
    process.env.FLOW_HTTP_ALLOW_PRIVATE = '1';
    try { await expect(sendWebhook('http://127.0.0.1/', 'key', '{}')).rejects.toThrow(); }
    finally { if (previous === undefined) delete process.env.FLOW_HTTP_ALLOW_PRIVATE; else process.env.FLOW_HTTP_ALLOW_PRIVATE = previous; }
  });
});
