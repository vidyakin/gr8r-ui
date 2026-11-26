/* Unit-тесты обработчика delivery.notify и схем доставки без БД (задача 1217). */
import { describe, expect, test } from 'bun:test';
import {
  DELIVERY_NOTIFY_JOB,
  deliveryNotifySend,
  deliverySave,
  deliveryTrackingUpdate,
  MODULE_OF_JOB,
} from '@erp/shared';
import { jobHandlers, makeJobContext } from '../src/handlers';

describe('delivery.notify worker handler & schemas', () => {
  test('job handler is registered and mapped to services module', async () => {
    expect(MODULE_OF_JOB.get(DELIVERY_NOTIFY_JOB)).toBe('services');
    const handler = jobHandlers[DELIVERY_NOTIFY_JOB];
    expect(typeof handler).toBe('function');

    const badJob = {
      id: '00000000-0000-7000-8000-000000000001',
      workspaceId: '00000000-0000-7000-8000-000000000002',
      queue: 'default',
      type: DELIVERY_NOTIFY_JOB,
      payload: { notificationId: 'not-a-uuid' },
      status: 'running' as const,
      runAt: new Date(),
      attempts: 1,
      maxAttempts: 5,
      lockedAt: new Date(),
      lockedBy: 'test',
      lastError: null,
      createdAt: new Date(),
      finishedAt: null,
    };
    await expect(handler!(badJob, makeJobContext(null as never, null))).rejects.toThrow(/must be a uuid/i);
  });

  test('zod schemas validate contactEmail, tracking update and notify send', () => {
    expect(deliverySave.safeParse({ contactEmail: 'client@example.com', trackingEnabled: true }).success).toBe(true);
    expect(deliverySave.safeParse({ contactEmail: '' }).success).toBe(true);
    expect(deliverySave.safeParse({ contactEmail: 'not-an-email' }).success).toBe(false);

    expect(deliveryTrackingUpdate.safeParse({ enabled: true }).success).toBe(true);
    expect(deliveryTrackingUpdate.safeParse({ rotate: true }).success).toBe(true);
    expect(deliveryTrackingUpdate.safeParse({}).success).toBe(false);

    expect(deliveryNotifySend.safeParse({}).success).toBe(true);
    expect(deliveryNotifySend.safeParse({ channel: 'sms', eventKind: 'status_in_transit' }).success).toBe(true);
    expect(deliveryNotifySend.safeParse({ channel: 'carrier_pigeon' }).success).toBe(false);
  });
});
