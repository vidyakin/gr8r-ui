/* Запуск flow: по событиям журнала (outbox) и по расписанию. Подбор идёт по опубликованным включённым flow арендатора события.
   Защита от зацикливания: события, которые порождают действия flow, несут метку `via.chain` (flow цепочки). Flow, уже стоящий в цепочке,
   событием не запускается («сам себя»), а глубина цепочки ограничена MAX_FLOW_CHAIN — запуск фиксируется как skipped с причиной. */
import { and, eq } from 'drizzle-orm';
import { allWorkspaceModules, createRun, events, workspaceModules, flowVersions, flows, withContext, workspaces, type Db, type Sql } from '@gr8r/db';
import {
  cronMatches,
  disabledModulesOfNodes,
  eventAction,
  eventChanges,
  eventEntity,
  eventVia,
  getNodeDef,
  MAX_FLOW_CHAIN,
  parseCron,
  SYSTEM_ENTITY_KEYS,
  triggerNodeOf,
  wallClock,
  type FlowEvent,
  type ModuleId,
  type TriggerContext,
} from '@gr8r/shared';
import { loadProjectOf, loadRecord } from './records';

type EventRow = typeof events.$inferSelect;

/** Вызывается для каждого события outbox (внутри транзакции воркера). Возвращает число созданных запусков */
export async function startRunsForEvent(db: Db, ev: EventRow): Promise<number> {
  // Служебные события (flow.*, notification.*, member.* …) триггерами не бывают
  if (ev.entity !== 'record' && !SYSTEM_ENTITY_KEYS.has(ev.entity)) return 0;
  const fev: FlowEvent = { id: ev.id, workspaceId: ev.workspaceId, type: ev.type, entity: ev.entity, recordId: ev.recordId, actorId: ev.actorId, payload: ev.payload };
  const entity = eventEntity(fev);
  const action = eventAction(fev);
  const changes = eventChanges(fev);
  const via = eventVia(fev);

  const candidates = await db
    .select({ id: flows.id, version: flowVersions.version, graph: flowVersions.graph })
    .from(flows)
    .innerJoin(flowVersions, and(eq(flowVersions.flowId, flows.id), eq(flowVersions.version, flows.publishedVersion)))
    .where(and(eq(flows.workspaceId, ev.workspaceId), eq(flows.enabled, true)));

  if (!candidates.length) return 0;
  // Лицензия: без модуля «Автоматизации» события запусков не порождают; flow с узлами выключенного модуля — пропуск с причиной
  const modules = await workspaceModules(db, ev.workspaceId);
  if (!modules.has('automations')) return 0;

  let record: Record<string, unknown> | null | undefined;
  let project: Record<string, unknown> | null = null;
  let created = 0;
  for (const c of candidates) {
    const trig = triggerNodeOf(c.graph);
    const def = trig && getNodeDef(trig.type);
    if (!trig || !def?.match) continue;
    const params = def.params.safeParse(trig.params);
    if (!params.success || !def.match(params.data, fev, { entity, action, changes })) continue;

    const chain = [...(via?.chain ?? []), c.id];
    let skipped: string | undefined;
    if (via?.chain.includes(c.id)) skipped = 'Skipped: the event was caused by this flow itself (loop protection)';
    else if (via && via.chain.length >= MAX_FLOW_CHAIN) skipped = `Skipped: the chain of flows triggering each other is longer than ${MAX_FLOW_CHAIN} (loop protection)`;
    else skipped = moduleSkip(c.graph.nodes.map(n => n.type), modules);

    if (!skipped && record === undefined) {
      record = ev.recordId ? await loadRecord(db, ev.workspaceId, entity, ev.recordId) : null;
      project = entity === 'task' ? await loadProjectOf(db, ev.workspaceId, record) : null;
    }
    const trigger: TriggerContext & { enriched: boolean } = {
      kind: 'event',
      event: { id: ev.id, type: ev.type },
      entity,
      ...(ev.recordId ? { recordId: ev.recordId } : {}),
      ...(record ? { record } : {}),
      changes,
      ...(project ? { project } : {}),
      actorId: ev.actorId,
      firedAt: new Date().toISOString(),
      enriched: true,
    };
    const id = await createRun(db, { workspaceId: ev.workspaceId, flowId: c.id, version: c.version, triggerKind: 'event', trigger: trigger as never, eventId: ev.id, chain, skipped });
    if (id) created++;
  }
  return created;
}

/** Причина пропуска, если у flow есть узлы модуля, выключенного у арендатора (docs/architecture/licensing.md) */
export function moduleSkip(nodeTypes: string[], modules: ReadonlySet<ModuleId>): string | undefined {
  const off = disabledModulesOfNodes(nodeTypes, modules);
  return off.length ? `Skipped: the flow uses nodes of modules that are not enabled (${off.join(', ')})` : undefined;
}

/** Срабатывания по расписанию за указанную минуту. «Сейчас» переводится в часовой пояс арендатора — расписание
    автоматизации живёт в часах арендатора. Повторный вызов для той же минуты ничего не создаёт */
export async function scheduleFlowsOnce(sql: Sql, at: Date = new Date()): Promise<number> {
  return withContext(
    sql,
    {},
    async db => {
      const rows = await db
        .select({ id: flows.id, workspaceId: flows.workspaceId, version: flowVersions.version, graph: flowVersions.graph })
        .from(flows)
        .innerJoin(flowVersions, and(eq(flowVersions.flowId, flows.id), eq(flowVersions.version, flows.publishedVersion)))
        .where(and(eq(flows.enabled, true), eq(flowVersions.triggerType, 'trigger.schedule')));
      const zones = await db.select({ id: workspaces.id, timezone: workspaces.timezone }).from(workspaces);
      const tzByWorkspace = new Map(zones.map(z => [z.id, z.timezone]));
      const modulesByWs = await allWorkspaceModules(db);
      let n = 0;
      for (const r of rows) {
        const modules = modulesByWs.get(r.workspaceId);
        if (!modules?.has('automations')) continue; // модуль «Автоматизации» выключен: расписание не срабатывает
        const trig = triggerNodeOf(r.graph);
        const cron = typeof trig?.params.cron === 'string' ? parseCron(trig.params.cron) : null;
        if (!cron) continue;
        // стенные часы арендатора: выражение расписания задано в его часовом поясе
        const minute = wallClock(at, tzByWorkspace.get(r.workspaceId) ?? 'UTC');
        if (!cronMatches(cron, minute)) continue;
        const key = `cron:${minute.toISOString()}`;
        const trigger: TriggerContext = { kind: 'schedule', scheduledFor: minute.toISOString(), firedAt: new Date().toISOString() };
        if (await createRun(db, { workspaceId: r.workspaceId, flowId: r.id, version: r.version, triggerKind: 'schedule', trigger: trigger as never, dedupeKey: key, chain: [r.id], skipped: moduleSkip(r.graph.nodes.map(x => x.type), modules) })) n++;
      }
      return n;
    },
    'app_worker',
  );
}
