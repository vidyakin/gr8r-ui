import { describe, expect, test } from 'bun:test';
import { buildWebhookBody, deliverOnce, webhookBackoffSec } from '../src/webhooks';

const sampleRow = {
  url: 'https://example.com/hook',
  secret: 'whsec_test',
  workspaceId: '01900000-0000-7000-8000-000000000001',
  eventId: '01900000-0000-7000-8000-000000000002',
  eventType: 'document.posted',
  eventEntity: 'document',
  recordId: '01900000-0000-7000-8000-000000000003',
  actorId: '01900000-0000-7000-8000-000000000004',
  payload: { number: 'DOC-1' },
  eventCreatedAt: new Date('2026-01-02T03:04:05.000Z'),
};

describe('webhook delivery worker helpers', () => {
  test('exponential backoff grows and caps at 3600s', () => {
    expect(webhookBackoffSec(1)).toBe(10);
    expect(webhookBackoffSec(2)).toBe(20);
    expect(webhookBackoffSec(3)).toBe(40);
    expect(webhookBackoffSec(20)).toBe(3600);
  });

  test('buildWebhookBody produces deterministic JSON', () => {
    const raw = buildWebhookBody({
      id: sampleRow.eventId,
      workspaceId: sampleRow.workspaceId,
      type: sampleRow.eventType,
      entity: sampleRow.eventEntity,
      recordId: sampleRow.recordId,
      actorId: sampleRow.actorId,
      payload: sampleRow.payload,
      createdAt: sampleRow.eventCreatedAt,
    });
    const parsed = JSON.parse(raw);
    expect(parsed.id).toBe(sampleRow.eventId);
    expect(parsed.type).toBe('document.posted');
    expect(parsed.createdAt).toBe('2026-01-02T03:04:05.000Z');
    expect(parsed.data).toEqual({ number: 'DOC-1' });
  });

  test('deliverOnce handles 2xx, non-2xx, and thrown errors', async () => {
    const ok = await deliverOnce(sampleRow, async () => ({ status: 204, body: '', headers: {} }) as never);
    expect(ok).toEqual({ ok: true, status: 204, error: null });

    const fail = await deliverOnce(sampleRow, async () => ({ status: 502, body: 'bad gateway', headers: {} }) as never);
    expect(fail).toEqual({ ok: false, status: 502, error: 'HTTP 502' });

    const err = await deliverOnce(sampleRow, async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(err).toEqual({ ok: false, status: null, error: 'ECONNREFUSED' });
  });
});
