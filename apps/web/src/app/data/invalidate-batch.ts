/* Пакетная инвалидация кэша для событий realtime. Массовая операция (например, «Создать товары» по прайсу) шлёт тысячи событий
   подряд; без пакета каждое событие перезапрашивает все открытые списки у каждого клиента. Здесь ключи копятся и сбрасываются
   одним заходом: после паузы в потоке событий (quietMs), но не реже maxWaitMs, пока поток идёт. */
import type { QueryKey } from '@tanstack/react-query';

export interface Invalidator {
  invalidateQueries: (filters: { queryKey: QueryKey }) => unknown;
}

export function createInvalidationBatcher(qc: Invalidator, { quietMs = 150, maxWaitMs = 1000 } = {}) {
  const pending = new Map<string, QueryKey>();
  let quietTimer: ReturnType<typeof setTimeout> | undefined;
  let maxTimer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    clearTimeout(quietTimer);
    clearTimeout(maxTimer);
    quietTimer = maxTimer = undefined;
    const keys = [...pending.values()];
    pending.clear();
    for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
  };

  return {
    /** Отметить ключ к перечитке; повтор того же ключа в пакете не добавляет запросов */
    add(queryKey: QueryKey) {
      pending.set(JSON.stringify(queryKey), queryKey);
      clearTimeout(quietTimer);
      quietTimer = setTimeout(flush, quietMs);
      maxTimer ??= setTimeout(flush, maxWaitMs);
    },
    flush,
    /** Снять таймеры без сброса (размонтирование) */
    dispose() {
      clearTimeout(quietTimer);
      clearTimeout(maxTimer);
      pending.clear();
    },
  };
}
