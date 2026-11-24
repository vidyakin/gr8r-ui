/* HTTP exchange with 1C (task 1229). See docs/user/automations/integrations.md. */
import { and, asc, desc, eq, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import {
  ENTERPRISE_DATA_MAX_BYTES, IC_DOCUMENT_TYPES, IC_SYNC_ENTITY_TYPES, icChannelCreate, nextIcMessage, receiveIcMessage,
  type IcChannelCreate, type IcChannelPatch, type IcMessageHeader,
} from '@erp/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { exportEnterpriseData } from './integrations-1c-export';
import { documents, events, integrations1cChannels as channels, integrations1cChangeQueue as queue, integrations1cRuns as runs, jobs } from './schema';
import { decryptSecret, encryptSecret } from './secrets';
import { uuidv7 } from './uuid';

export const IC_SYNC_JOB = '1c.sync';
export type IcChannel = typeof channels.$inferSelect;

export const icChannelFilter = (workspaceId: string, channelId: string) =>
  and(eq(channels.workspaceId, workspaceId), eq(channels.id, channelId));

function icChannelView(channel: IcChannel) {
  return {
    id: channel.id, source: channel.source, endpointUrl: channel.endpointUrl, nodeName: channel.nodeName,
    localNodeName: channel.localNodeName, authType: channel.authType, username: channel.username,
    hasSecret: !!channel.secretCiphertext, conflictPolicy: channel.conflictPolicy, version: channel.version,
    intervalMinutes: channel.intervalMinutes, enabled: channel.enabled, lastSentMessageNo: channel.lastSentMessageNo,
    lastReceivedMessageNo: channel.lastReceivedMessageNo, ackedSentMessageNo: channel.ackedSentMessageNo,
    lastSyncAt: channel.lastSyncAt?.toISOString() ?? null, lastError: channel.lastError, pendingBlocked: channel.pendingBlocked,
  };
}

export async function listIcChannels(db: Db, workspaceId: string) {
  const rows = await db.select({
    id: channels.id, source: channels.source, endpointUrl: channels.endpointUrl, nodeName: channels.nodeName,
    localNodeName: channels.localNodeName, authType: channels.authType, username: channels.username,
    hasSecret: sql<boolean>`${channels.secretCiphertext} <> ''`, conflictPolicy: channels.conflictPolicy, version: channels.version,
    intervalMinutes: channels.intervalMinutes, enabled: channels.enabled, lastSentMessageNo: channels.lastSentMessageNo,
    lastReceivedMessageNo: channels.lastReceivedMessageNo, ackedSentMessageNo: channels.ackedSentMessageNo,
    lastSyncAt: channels.lastSyncAt, lastError: channels.lastError, pendingBlocked: channels.pendingBlocked,
  }).from(channels).where(eq(channels.workspaceId, workspaceId)).orderBy(asc(channels.source));
  return rows.map(row => ({ ...row, lastSyncAt: row.lastSyncAt?.toISOString() ?? null }));
}

export async function requireIcChannel(db: Db, workspaceId: string, channelId: string, lock = false) {
  const query = db.select().from(channels).where(icChannelFilter(workspaceId, channelId));
  const [row] = await (lock ? query.for('no key update') : query);
  if (!row) throw new DomainError(404, 'not_found', '1C exchange channel not found');
  return row;
}

const credentialsKey = (id: string) => `ic_sync.${id}`;
export const icChannelSecret = (channel: IcChannel) => decryptSecret(channel.workspaceId, credentialsKey(channel.id), channel.secretCiphertext);

export async function createIcChannel(db: Db, workspaceId: string, memberId: string, input: IcChannelCreate) {
  const id = uuidv7();
  const { secret, ...fields } = input;
  const [row] = await db.insert(channels).values({
    ...fields, id, workspaceId, username: fields.authType === 'basic' ? fields.username : null,
    secretCiphertext: encryptSecret(workspaceId, credentialsKey(id), secret),
  }).returning();
  await recordEvent(db, { workspaceId, actorId: memberId, type: 'ic_sync.created', entity: 'ic_sync', recordId: id });
  return icChannelView(row!);
}

const activeJob = (workspaceId: SQL | string, channelId: SQL | string) => sql`exists (
  select 1 from ${jobs} where ${jobs.workspaceId} = ${workspaceId} and ${jobs.type} = ${IC_SYNC_JOB}
    and ${jobs.status} in ('queued', 'running') and ${jobs.payload}->>'channelId' = ${channelId}::text
)`;

async function assertIdle(db: Db, workspaceId: string, id: string) {
  const [row] = await db.select({ busy: sql<boolean>`${activeJob(workspaceId, id)}` }).from(channels)
    .where(icChannelFilter(workspaceId, id));
  if (row?.busy) throw new DomainError(409, 'conflict', 'Wait for the current 1C exchange to finish');
}

export async function updateIcChannel(db: Db, workspaceId: string, memberId: string, id: string, patch: IcChannelPatch) {
  const current = await requireIcChannel(db, workspaceId, id, true);
  await assertIdle(db, workspaceId, id);
  const { secret, ...fields } = patch;
  const next = { ...icChannelView(current), ...fields };
  const authChanged = next.authType !== current.authType;
  if (authChanged && !secret) throw new DomainError(400, 'validation_error', 'Supply a new secret when changing the authentication type');
  const { source, endpointUrl, nodeName, localNodeName, authType, conflictPolicy, intervalMinutes, enabled, version } = next;
  const username = authType === 'basic' ? next.username : null;
  const validation = icChannelCreate.safeParse({
    source, endpointUrl, nodeName, localNodeName, authType, username, conflictPolicy, intervalMinutes, enabled, version,
    secret: secret ?? 'existing',
  });
  if (!validation.success) throw new DomainError(400, 'validation_error', validation.error.issues[0]!.message);
  if ((current.lastSentMessageNo || current.lastReceivedMessageNo) && (nodeName !== current.nodeName || localNodeName !== current.localNodeName)) {
    throw new DomainError(409, 'conflict', 'Node codes cannot change after the first package');
  }
  if (current.pendingXml && endpointUrl !== current.endpointUrl) {
    throw new DomainError(409, 'conflict', 'A pending package must be acknowledged before changing its endpoint');
  }
  if (current.enabled && !enabled) await captureIcBacklog(db, current);
  const [row] = await db.update(channels).set({
    ...fields, ...(!current.enabled && enabled ? { registerFrom: sql`now()` } : {}), username, updatedAt: new Date(),
    ...(fields.conflictPolicy === 'erp_wins' ? { pendingBlocked: false } : {}),
    ...(secret === undefined ? {} : { secretCiphertext: encryptSecret(workspaceId, credentialsKey(id), secret) }),
  }).where(icChannelFilter(workspaceId, id)).returning();
  await recordEvent(db, { workspaceId, actorId: memberId, type: 'ic_sync.updated', entity: 'ic_sync', recordId: id });
  return icChannelView(row!);
}

export async function deleteIcChannel(db: Db, workspaceId: string, memberId: string, id: string) {
  await requireIcChannel(db, workspaceId, id, true);
  await assertIdle(db, workspaceId, id);
  await db.delete(channels).where(icChannelFilter(workspaceId, id));
  await recordEvent(db, { workspaceId, actorId: memberId, type: 'ic_sync.deleted', entity: 'ic_sync', recordId: id });
}

const isDue = (now: Date) => sql`${channels.enabled} and
  (${channels.lastSyncAt} is null or ${channels.lastSyncAt} + ${channels.intervalMinutes} * interval '1 minute' <= ${now.toISOString()}::timestamptz)`;

export async function enqueueIcSync(db: Db, workspaceId: string, channelId: string, now?: Date) {
  const filter = icChannelFilter(workspaceId, channelId);
  const [channel] = await db.select({ id: channels.id }).from(channels)
    .where(and(filter, now ? isDue(now) : undefined)).for('no key update');
  if (!channel) {
    if (now) return false;
    throw new DomainError(404, 'not_found', '1C exchange channel not found');
  }
  const [job] = await db.select({ busy: sql<boolean>`${activeJob(workspaceId, channelId)}` }).from(channels).where(filter);
  if (job?.busy) return false;
  await db.insert(jobs).values({ workspaceId, type: IC_SYNC_JOB, payload: { channelId, scheduled: !!now }, maxAttempts: 3 });
  return true;
}

export function dueIcChannels(db: Db, now: Date) {
  return db.select({ workspaceId: channels.workspaceId, id: channels.id }).from(channels)
    .where(and(isDue(now), sql`not ${activeJob(sql`${channels.workspaceId}`, sql`${channels.id}`)}`))
    .orderBy(sql`${channels.lastSyncAt} asc nulls first`, asc(channels.id));
}

export async function listIcRuns(db: Db, workspaceId: string, channelId: string) {
  await requireIcChannel(db, workspaceId, channelId);
  return db.select().from(runs).where(and(eq(runs.workspaceId, workspaceId), eq(runs.channelId, channelId)))
    .orderBy(desc(runs.startedAt), desc(runs.id)).limit(50);
}

const queueScope = (channel: IcChannel) => and(eq(queue.workspaceId, channel.workspaceId), eq(queue.channelId, channel.id));
const liveQueue = (channel: IcChannel) => and(queueScope(channel), isNull(queue.ackedAt), isNull(queue.discardedAt));

const catalogEvents = IC_SYNC_ENTITY_TYPES.filter(type => type !== 'document').flatMap(type =>
  ['created', 'updated', 'archived', 'restored', 'deleted', 'unarchived'].map(action => `${type}.${action}`));
const removeEvents = [...catalogEvents.filter(type => /\.(archived|deleted)$/.test(type)), 'document.unposted', 'document.cancelled', 'document.deleted'];
const eventList = (values: readonly string[]) => sql.join(values.map(value => sql`${value}`), sql`, `);

/** The outbox and the inbound conflict check share the same registration rule and deduplication key. */
async function captureIcEvents(db: Db, workspaceId: string, scope: SQL, channelId?: string) {
  await db.execute(sql`
    insert into ${queue} (workspace_id, channel_id, event_id, entity_type, entity_id, action, document_type, updated_at)
    select e.workspace_id, c.id, e.id, e.entity, e.record_id,
      case when e.type in (${eventList(removeEvents)}) then 'remove' else 'upsert' end,
      coalesce(e.payload->>'documentType', d.type), e.created_at
    from ${events} e
    join ${channels} c on c.workspace_id = e.workspace_id and c.enabled and e.created_at >= c.register_from
    left join ${documents} d on d.workspace_id = e.workspace_id and d.id = e.record_id and e.entity = 'document'
    where e.workspace_id = ${workspaceId} and e.record_id is not null
      and e.payload->>'via' is distinct from 'ic_sync'
      and (${scope}) ${channelId ? sql`and c.id = ${channelId}` : sql``}
      and (e.type in (${eventList(catalogEvents)})
        or (e.entity = 'document'
          and coalesce(e.payload->>'documentType', d.type) in (${eventList(IC_DOCUMENT_TYPES)})
          and (e.type in ('document.posted', 'document.unposted', 'document.cancelled', 'document.deleted')
            or (e.type = 'document.updated' and d.status = 'posted'))))
    order by e.id, c.id
    on conflict (workspace_id, channel_id, event_id) do nothing
  `);
}

export async function registerIcChange(db: Db, event: typeof events.$inferSelect) {
  if (!event.recordId || event.payload.via === 'ic_sync' ||
    (!catalogEvents.includes(event.type) && event.entity !== 'document')) return;
  await captureIcEvents(db, event.workspaceId, sql`e.id = ${event.id}`);
}

// A business change can commit before the outbox worker picks it up.
export async function captureIcBacklog(db: Db, channel: IcChannel, entity?: { type: string; id: string }) {
  await captureIcEvents(db, channel.workspaceId, and(sql`e.processed_at is null`,
    entity ? sql`e.entity = ${entity.type} and e.record_id = ${entity.id}` : undefined)!, channel.id);
}

export async function pendingIcChanges(db: Db, channel: IcChannel, entityType: string, entityId: string) {
  return db.select({ id: queue.id, sentMessageNo: queue.sentMessageNo }).from(queue)
    .where(and(liveQueue(channel), sql`${queue.entityType} = ${entityType}`, eq(queue.entityId, entityId)));
}

export async function discardIcChanges(db: Db, channel: IcChannel, ids: string[]) {
  if (!ids.length) return;
  await db.update(queue).set({ discardedAt: new Date() })
    .where(and(liveQueue(channel), isNull(queue.sentMessageNo), inArray(queue.id, ids)));
}

export function acceptIcConfirmation(channel: IcChannel, header: IcMessageHeader) {
  if (header.from !== channel.nodeName || header.to !== channel.localNodeName) throw new Error('Unexpected EnterpriseData nodes');
  const receipt = receiveIcMessage(header, channel.lastReceivedMessageNo, channel.lastSentMessageNo, channel.ackedSentMessageNo);
  return receipt;
}

export async function storeIcConfirmation(db: Db, channel: IcChannel, header: IcMessageHeader, receipt: ReturnType<typeof receiveIcMessage>, hasObjects: boolean, blockPending: boolean) {
  if (receipt.ackedSentMessageNo > channel.ackedSentMessageNo) {
    await db.update(queue).set({ ackedAt: new Date() })
      .where(and(liveQueue(channel), lte(queue.sentMessageNo, receipt.ackedSentMessageNo)));
  }
  const clearPending = receipt.ackedSentMessageNo >= channel.lastSentMessageNo;
  await db.update(channels).set({
    ackedSentMessageNo: receipt.ackedSentMessageNo,
    lastReceivedMessageNo: receipt.duplicate ? channel.lastReceivedMessageNo : header.messageNo,
    lastDataReceivedNo: !receipt.duplicate && hasObjects ? header.messageNo : channel.lastDataReceivedNo,
    ...(clearPending ? { pendingXml: null, pendingObjectCount: 0, pendingBlocked: false }
      : blockPending ? { pendingBlocked: true } : {}),
  }).where(icChannelFilter(channel.workspaceId, channel.id));
}

export async function prepareIcPackage(db: Db, channel: IcChannel) {
  if (channel.pendingBlocked) return null;
  if (channel.pendingXml) {
    return { xml: channel.pendingXml, messageNo: channel.lastSentMessageNo, objects: channel.pendingObjectCount };
  }
  await captureIcBacklog(db, channel);
  let changes = await db.select().from(queue).where(and(liveQueue(channel), isNull(queue.sentMessageNo)))
    .orderBy(asc(queue.updatedAt), asc(queue.eventId)).limit(100);
  const needsReceipt = channel.sentReceivedNo < channel.lastDataReceivedNo;
  if (!changes.length && !needsReceipt) return null;
  const header = nextIcMessage(channel.lastSentMessageNo, channel.lastReceivedMessageNo, channel.nodeName, channel.localNodeName);
  let prepared: Awaited<ReturnType<typeof exportEnterpriseData>>;
  for (;;) {
    await db.execute(sql`savepoint ic_sync_size`);
    const uniqueChanges = new Map(changes.map(row => [`${row.entityType}:${row.entityId}`, row]));
    prepared = await exportEnterpriseData(db, { workspaceId: channel.workspaceId, memberId: null }, {
      dateFrom: '0001-01-01', dateTo: '9999-12-31', version: channel.version, saveLinks: true,
    }, { source: channel.source, header, changes: [...uniqueChanges.values()] });
    if (Buffer.byteLength(prepared.xml, 'utf8') <= ENTERPRISE_DATA_MAX_BYTES) {
      await db.execute(sql`release savepoint ic_sync_size`);
      break;
    }
    // Roll back any GUIDs assigned by a discarded candidate package, then rebuild a smaller one.
    await db.execute(sql`rollback to savepoint ic_sync_size`);
    await db.execute(sql`release savepoint ic_sync_size`);
    if (changes.length <= 1) throw new DomainError(413, 'payload_too_large', '1C package exceeds 10 MiB');
    changes = changes.slice(0, Math.floor(changes.length / 2));
  }
  const { xml, summary } = prepared;
  if (!summary.totalObjects && !needsReceipt) {
    await discardIcChanges(db, channel, changes.map(row => row.id));
    return null;
  }
  if (changes.length) {
    await db.update(queue).set({ sentMessageNo: header.messageNo })
      .where(and(queueScope(channel), inArray(queue.id, changes.map(row => row.id))));
  }
  await db.update(channels).set({
    lastSentMessageNo: header.messageNo, sentReceivedNo: header.receivedNo,
    pendingXml: xml, pendingObjectCount: summary.totalObjects,
  }).where(icChannelFilter(channel.workspaceId, channel.id));
  return { xml, messageNo: header.messageNo, objects: summary.totalObjects };
}
