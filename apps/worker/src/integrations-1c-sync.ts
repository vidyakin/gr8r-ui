/* Each stage commits independently so no tenant transaction is held during HTTP. */
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  DomainError, acceptIcConfirmation, applyIcPackage, dueIcChannels, enqueueIcSync, icChannelFilter, icChannelSecret,
  integrations1cChannels as channels, integrations1cRuns as runs, jobs, modulesByWorkspace,
  prepareIcPackage, requireIcChannel, recordEvent, storeIcConfirmation, withContext, type Db, type IcChannel, type Sql,
} from '@erp/db';
import { ENTERPRISE_DATA_MAX_BYTES, parseEnterpriseDataXml, type IcSyncIssue } from '@erp/shared';
import { defaultHttpOptions, guardedFetch } from './flows/http';

class ExchangeError extends Error {
  constructor(readonly code: IcSyncIssue['code'], readonly httpStatus?: number) { super(code); }
}

async function request(channel: IcChannel, secret: string, stage: 'pull' | 'push', xml?: string) {
  const url = new URL(channel.endpointUrl);
  // Recheck at request time for channels restored directly from a database backup.
  if (url.protocol !== 'https:' || url.search || url.hash) throw new ExchangeError('transport');
  url.searchParams.set('node', channel.nodeName);
  const authorization = channel.authType === 'basic'
    ? `Basic ${Buffer.from(`${channel.username}:${secret}`, 'utf8').toString('base64')}`
    : `Bearer ${secret}`;
  const options = defaultHttpOptions();
  const response = await guardedFetch({
    url: url.toString(), method: stage === 'pull' ? 'GET' : 'POST', body: xml,
    headers: { authorization, accept: 'application/xml, text/xml', ...(xml ? { 'content-type': 'application/xml; charset=utf-8' } : {}) },
  }, {
    ...options, allowPrivate: false, timeoutMs: 15_000, maxRedirects: 0, maxBytes: ENTERPRISE_DATA_MAX_BYTES, strictBody: true,
    resolve: host => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('DNS lookup timed out')), 5000);
      void options.resolve(host).then(resolve, reject).finally(() => clearTimeout(timer));
    }),
  }).catch(() => { throw new ExchangeError('transport'); });
  if (!response.ok) throw new ExchangeError('http_status', response.status);
  return response.body;
}

async function receive(db: Db, channel: IcChannel, xml: string) {
  if (!xml) return { issues: [] as IcSyncIssue[], objects: 0, messageNo: null };
  let parsed;
  let receipt;
  try {
    parsed = parseEnterpriseDataXml(xml, { sync: true });
    if (!parsed.confirmation) throw new Error('Missing confirmation');
    receipt = acceptIcConfirmation(channel, parsed.confirmation);
  } catch {
    throw new ExchangeError('invalid_packet');
  }
  const header = parsed.confirmation!;
  const objects = receipt.duplicate ? 0 : parsed.catalogs.length + parsed.documents.length + parsed.issues.length
    + (parsed.removals?.length ?? 0) + (parsed.unsupported?.length ?? 0) + parsed.balances.length;
  const hasObjects = !receipt.duplicate && (objects > 0 || parsed.balanceSnapshots.length > 0);
  const { issues, blockPending } = hasObjects
    ? await applyIcPackage(db, channel, parsed, receipt.ackedSentMessageNo)
    : { issues: [], blockPending: false };
  await storeIcConfirmation(db, channel, header, receipt, hasObjects, blockPending);
  return { issues, objects, messageNo: header.messageNo };
}

class StaleExchange extends Error {}

export async function sync1cChannel(connection: Sql, job: typeof jobs.$inferSelect, channelId: string) {
  const { workspaceId } = job;
  const context = { workspaceId, system: true };
  const stageTransaction = <T>(fn: (db: Db, channel: IcChannel) => Promise<T>) => withContext(connection, context, async db => {
    const channel = await requireIcChannel(db, workspaceId, channelId, true);
    const filter = and(eq(jobs.workspaceId, workspaceId), eq(jobs.id, job.id),
      eq(jobs.attempts, job.attempts), eq(jobs.status, 'running'));
    const [active] = await db.select({ id: jobs.id }).from(jobs).where(filter).for('no key update');
    if (!active) throw new StaleExchange();
    const result = await fn(db, channel);
    await db.update(jobs).set({ lockedAt: new Date() }).where(filter);
    return result;
  });
  const startedAt = new Date();
  let progress = {
    direction: 'pull' as 'pull' | 'both',
    sentMessageNo: null as number | null, receivedMessageNo: null as number | null,
    objectsSent: 0, objectsReceived: 0, conflictsCount: 0, errorsJson: [] as IcSyncIssue[],
  };
  const start = await stageTransaction(async (db, channel) => {
    if (job.payload.scheduled === true && !channel.enabled) return null;
    const scope = and(eq(runs.workspaceId, workspaceId), eq(runs.channelId, channelId), isNull(runs.finishedAt));
    await db.update(runs).set({
      status: 'error', finishedAt: startedAt,
      errorsJson: sql`${runs.errorsJson} || jsonb_build_array(jsonb_build_object(
        'code', 'interrupted', 'stage', case when ${runs.direction} = 'both' then 'push' else 'pull' end
      ))`,
    }).where(scope);
    const [run] = await db.insert(runs).values({
      workspaceId, channelId, ...progress, startedAt, status: 'partial',
    }).returning({ id: runs.id });
    return { channel, runId: run!.id };
  });
  if (!start) return;
  const runFilter = and(eq(runs.workspaceId, workspaceId), eq(runs.channelId, channelId), eq(runs.id, start.runId));
  let stage: 'pull' | 'push' = 'pull';
  let pulled = false;
  let failed = false;
  const recordResponse = async (xml: string, objectsSent = progress.objectsSent) => {
    progress = await stageTransaction(async (db, channel) => {
      const outcome = await receive(db, channel, xml);
      const next = {
        ...progress, objectsSent, receivedMessageNo: outcome.messageNo ?? progress.receivedMessageNo,
        objectsReceived: progress.objectsReceived + outcome.objects,
        conflictsCount: progress.conflictsCount + outcome.issues.filter(issue => issue.code === 'conflict').length,
        errorsJson: [...progress.errorsJson, ...outcome.issues],
      };
      // The cursor and its per-object diagnostics must commit together.
      await db.update(runs).set({ ...next, status: 'partial' }).where(runFilter);
      return next;
    });
  };
  try {
    let secret: string;
    try {
      secret = icChannelSecret(start.channel);
    } catch {
      throw new ExchangeError('secret');
    }
    await recordResponse(await request(start.channel, secret, 'pull'));
    pulled = true;
    stage = 'push';
    const outgoing = await stageTransaction(async (db, channel) => {
      if (channel.pendingBlocked) throw new ExchangeError('ack_pending');
      const packet = await prepareIcPackage(db, channel);
      if (packet) {
        await db.update(runs).set({ direction: 'both', sentMessageNo: packet.messageNo }).where(runFilter);
      }
      return packet;
    });
    if (outgoing) {
      progress.direction = 'both';
      progress.sentMessageNo = outgoing.messageNo;
      const response = await request(start.channel, secret, 'push', outgoing.xml);
      progress.objectsSent = outgoing.objects;
      await recordResponse(response);
    }
  } catch (error) {
    if (error instanceof StaleExchange) return;
    failed = true;
    const issue: IcSyncIssue = error instanceof ExchangeError
      ? { stage, code: error.code, ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}) }
      : { stage, code: 'apply_failed', ...(error instanceof DomainError ? { reason: error.code } : {}) };
    progress.errorsJson.push(issue);
  }
  await stageTransaction(async (db, channel) => {
    if (channel.pendingXml && !failed) progress.errorsJson.push({ code: 'ack_pending', stage: 'push' });
    const finishedAt = new Date();
    const status = failed && !pulled ? 'error' : progress.errorsJson.length ? 'partial' : 'ok';
    await db.update(runs).set({ ...progress, status, finishedAt }).where(runFilter);
    await db.update(channels).set({
      lastSyncAt: finishedAt, lastError: progress.errorsJson.find(issue => issue.code !== 'conflict')?.code ?? null,
    }).where(icChannelFilter(workspaceId, channelId));
    await recordEvent(db, { workspaceId, type: 'ic_sync.finished', entity: 'ic_sync', recordId: channelId, payload: { status } });
  });
}

export async function scheduleIcSyncs(connection: Sql, now = new Date()) {
  const due = await withContext(connection, {}, db => dueIcChannels(db, now), 'app_worker');
  if (!due.length) return 0;
  const modules = await modulesByWorkspace(connection, now);
  let queued = 0;
  for (const { workspaceId, id } of due) {
    if (!modules.get(workspaceId)?.has('integrations')) continue;
    if (await withContext(connection, { workspaceId, system: true }, db => enqueueIcSync(db, workspaceId, id, now))) queued++;
  }
  return queued;
}
