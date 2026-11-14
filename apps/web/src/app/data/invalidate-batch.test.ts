import { describe, expect, test } from 'bun:test';
import { createInvalidationBatcher } from './invalidate-batch';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function fakeQc() {
  const calls: unknown[] = [];
  return { calls, invalidateQueries: (f: { queryKey: readonly unknown[] }) => calls.push(f.queryKey) };
}

describe('пакетная инвалидация realtime', () => {
  test('тысяча событий об одном — один перезапрос на ключ после паузы', async () => {
    const qc = fakeQc();
    const b = createInvalidationBatcher(qc, { quietMs: 20, maxWaitMs: 1000 });
    for (let i = 0; i < 1000; i++) {
      b.add(['ws', 'w1', 'catalog']);
      b.add(['ws', 'w1', 'docs']);
    }
    expect(qc.calls).toHaveLength(0);
    await sleep(40);
    expect(qc.calls).toEqual([['ws', 'w1', 'catalog'], ['ws', 'w1', 'docs']]);
  });

  test('непрерывный поток всё равно сбрасывается не реже maxWait', async () => {
    const qc = fakeQc();
    const b = createInvalidationBatcher(qc, { quietMs: 30, maxWaitMs: 60 });
    const until = Date.now() + 100;
    while (Date.now() < until) {
      b.add(['ws', 'w1', 'catalog']);
      await sleep(10);
    }
    expect(qc.calls.length).toBeGreaterThanOrEqual(1);
    expect(qc.calls.length).toBeLessThanOrEqual(2);
    b.dispose();
  });

  test('dispose снимает таймеры без перезапросов', async () => {
    const qc = fakeQc();
    const b = createInvalidationBatcher(qc, { quietMs: 10, maxWaitMs: 20 });
    b.add(['ws', 'w1', 'catalog']);
    b.dispose();
    await sleep(30);
    expect(qc.calls).toHaveLength(0);
  });
});
