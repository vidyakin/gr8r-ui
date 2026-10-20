/* Автоматизации: создание запуска (общий код API — ручной запуск, и воркера — события и расписание). */
import type { EventVia } from '@gr8r/shared';
import type { Db } from './client';
import { flowRuns, jobs } from './schema';

export const FLOW_QUEUE = 'flows';
export const FLOW_RUN_JOB = 'flow.run';

export interface NewRun {
  workspaceId: string;
  flowId: string;
  version: number;
  triggerKind: 'event' | 'schedule' | 'manual';
  trigger: Record<string, unknown>;
  eventId?: string | null;
  dedupeKey?: string | null;
  /** Цепочка flow: flow, породившие событие, и этот flow последним */
  chain: string[];
  startedBy?: string | null;
  /** skipped — запуск отклонён заранее (защита от зацикливания), движок его не выполняет */
  skipped?: string;
}

/** Ставит запуск в журнал и задачу на его выполнение. Повтор для той же пары (flow, событие / минута) ничего не создаёт — возвращает null */
export async function createRun(db: Db, r: NewRun): Promise<string | null> {
  const [row] = await db
    .insert(flowRuns)
    .values({
      workspaceId: r.workspaceId,
      flowId: r.flowId,
      version: r.version,
      status: r.skipped ? 'skipped' : 'queued',
      triggerKind: r.triggerKind,
      trigger: r.trigger,
      eventId: r.eventId ?? null,
      dedupeKey: r.dedupeKey ?? null,
      chain: r.chain,
      startedBy: r.startedBy ?? null,
      error: r.skipped ?? null,
      finishedAt: r.skipped ? new Date() : null,
    })
    .onConflictDoNothing()
    .returning({ id: flowRuns.id });
  if (!row) return null;
  if (!r.skipped) await enqueueRun(db, r.workspaceId, row.id);
  return row.id;
}

/** Задача на выполнение (или продолжение) запуска; runAt — когда (задержка, повтор) */
export async function enqueueRun(db: Db, workspaceId: string, runId: string, runAt: Date = new Date()) {
  await db.insert(jobs).values({ workspaceId, queue: FLOW_QUEUE, type: FLOW_RUN_JOB, payload: { runId }, runAt });
}

export type { EventVia };
