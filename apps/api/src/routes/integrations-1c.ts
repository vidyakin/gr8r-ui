/* Соответствие объектов с 1С (задача 1226, docs/plans/2026-11-02-1c-exchange.md): список, автопоиск,
   ручное сопоставление, разрыв. Права — admin+ (интеграции настраивает администратор). */
import { zValidator } from '@hono/zod-validator';
import { Hono, type Context } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { apply1cImport, preview1cImport, reconcile1c, autoMatch, DomainError, exportEnterpriseData, integrations1cSchedules, saveIcExportSchedule, linkEntity, linksOf, unlinkEntity, type IcEntityType, type IcSource } from '@erp/db';
import { ENTERPRISE_DATA_MAX_BYTES, EnterpriseDataParseError, icImportApplyQuery, icReconcileQuery, icUploadSource, parseEnterpriseDataXml, IC_ENTITY_TYPES, IC_SOURCES, icAutoMatchQuery, icLinkCreate, icLinkDelete, icExportRequest, icExportSchedule } from '@erp/shared';
import { ctxOf, validationHook, type Ctx } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const admin = requireRole('admin');
const actorOf = (ctx: Ctx) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });

const sourceTypeQuery = z.object({
  source: z.enum(IC_SOURCES),
  entityType: z.enum(IC_ENTITY_TYPES),
});
const view = (l: { id: string; source: string; entityType: string; entityId: string; refUuid: string; refName: string; matchedBy: string; matchedRule: string | null; createdBy: string | null; createdAt: Date; updatedAt: Date }) => ({
  id: l.id,
  source: l.source,
  entityType: l.entityType,
  entityId: l.entityId,
  refUuid: l.refUuid,
  refName: l.refName,
  matchedBy: l.matchedBy,
  matchedRule: l.matchedRule,
  createdBy: l.createdBy,
  createdAt: l.createdAt.toISOString(),
  updatedAt: l.updatedAt.toISOString(),
});

function xmlFile(c: Context<AppEnv>, xml: string, date: string) {
  return c.body(xml, 200, {
    'Content-Type': 'application/xml; charset=utf-8',
    'Content-Disposition': `attachment; filename="1c-buh3-${date}.xml"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
}

async function uploadedEnterpriseData(c: Context<AppEnv>) {
  const body = c.req.raw.body?.getReader();
  if (!body) throw new DomainError(400, 'invalid_enterprise_data', 'Upload an EnterpriseData XML file');
  if (Number(c.req.header('content-length')) > ENTERPRISE_DATA_MAX_BYTES) {
    await body.cancel();
    throw new DomainError(413, 'payload_too_large', 'EnterpriseData file exceeds 10 MiB');
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await body.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > ENTERPRISE_DATA_MAX_BYTES) {
        await body.cancel();
        throw new DomainError(413, 'payload_too_large', 'EnterpriseData file exceeds 10 MiB');
      }
      chunks.push(chunk.value);
    }
  } finally {
    body.releaseLock();
  }
  const xml = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    xml.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return parseEnterpriseDataXml(xml);
  } catch (error) {
    if (error instanceof EnterpriseDataParseError) throw new DomainError(400, error.code, error.message);
    throw error;
  }
}

export const integrationsRoutes = new Hono<AppEnv>()
  .use('/1c/*', admin)
  .post('/1c/import/preview', zValidator('query', icUploadSource, validationHook), async c => {
    const { db, workspaceId } = ctxOf(c);
    const { source } = c.req.valid('query');
    const result = await preview1cImport(db, workspaceId, source, await uploadedEnterpriseData(c));
    c.header('Cache-Control', 'no-store');
    return c.json(result);
  })
  .post('/1c/import/apply', zValidator('query', icImportApplyQuery, validationHook), async c => {
    const { db, workspaceId, memberId } = ctxOf(c);
    const { source, ...options } = c.req.valid('query');
    const result = await apply1cImport(db, workspaceId, memberId, source, await uploadedEnterpriseData(c), options);
    c.header('Cache-Control', 'no-store');
    return c.json(result);
  })
  .post('/1c/reconcile', zValidator('query', icReconcileQuery, validationHook), async c => {
    const { db, workspaceId } = ctxOf(c);
    const { source, ...options } = c.req.valid('query');
    const result = await reconcile1c(db, workspaceId, source, await uploadedEnterpriseData(c), options);
    c.header('Cache-Control', 'no-store');
    return c.json(result);
  })
  .post('/1c/export/preview', zValidator('json', icExportRequest, validationHook), async c => {
    const ctx = ctxOf(c);
    const { summary } = await exportEnterpriseData(ctx.db, actorOf(ctx), { ...c.req.valid('json'), saveLinks: false });
    c.header('Cache-Control', 'no-store');
    return c.json(summary);
  })
  .post('/1c/export', zValidator('json', icExportRequest, validationHook), async c => {
    const ctx = ctxOf(c);
    const options = c.req.valid('json');
    const { xml } = await exportEnterpriseData(ctx.db, actorOf(ctx), options);
    return xmlFile(c, xml, options.dateTo);
  })
  .get('/1c/export/schedule', async c => {
    const { db, workspaceId } = ctxOf(c);
    const [row] = await db.select({
      options: integrations1cSchedules.options,
      exportedDate: integrations1cSchedules.exportedDate,
      failedAt: integrations1cSchedules.failedAt,
    }).from(integrations1cSchedules).where(eq(integrations1cSchedules.workspaceId, workspaceId));
    c.header('Cache-Control', 'no-store');
    return c.json(row ?? null);
  })
  .put('/1c/export/schedule', zValidator('json', icExportSchedule, validationHook), async c => {
    const ctx = ctxOf(c);
    await saveIcExportSchedule(ctx.db, actorOf(ctx), c.req.valid('json'));
    return c.json({ ok: true });
  })
  .get('/1c/export/latest', async c => {
    const { db, workspaceId } = ctxOf(c);
    const [row] = await db.select({ xml: integrations1cSchedules.xml, date: integrations1cSchedules.exportedDate })
      .from(integrations1cSchedules).where(eq(integrations1cSchedules.workspaceId, workspaceId));
    if (!row?.xml || !row.date) throw new DomainError(404, 'not_found', 'No scheduled 1C export is available');
    return xmlFile(c, row.xml, row.date);
  })
  // список связей конфигурации по типу объекта
  .get('/1c/links', zValidator('query', sourceTypeQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const rows = await linksOf(ctx.db, ctx.workspaceId, q.source as IcSource, q.entityType as IcEntityType);
    return c.json(rows.map(view));
  })
  // автопоиск: dry-run предпросмотр или применить (apply: true)
  .post('/1c/links/auto-match', zValidator('json', icAutoMatchQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('json');
    const results = await autoMatch(ctx.db, ctx.workspaceId, q.source as IcSource, q.entityType as IcEntityType, q.candidates);
    if (!q.apply) {
      return c.json(
        results.map(r => ({
          refUuid: r.candidate.refUuid,
          refName: r.candidate.refName ?? '',
          status: r.result.status,
          entityId: r.result.status === 'matched' ? r.result.entity.entityId : null,
          name: r.result.status === 'matched' ? r.result.entity.name : null,
          rule: r.result.status === 'none' ? null : r.result.rule,
          candidates: r.result.status === 'candidates' ? r.result.candidates : undefined,
        })),
      );
    }
    // применяем однозначные совпадения; кандидаты и «не найдено» — на ручное
    const applied: string[] = [];
    for (const r of results) {
      if (r.result.status !== 'matched' || r.result.rule === 'existing') continue;
      await linkEntity(ctx.db, actorOf(ctx), q.source as IcSource, q.entityType as IcEntityType, r.result.entity.entityId, { refUuid: r.candidate.refUuid, refName: r.candidate.refName ?? r.result.entity.name }, { by: 'auto', rule: r.result.rule });
      applied.push(r.candidate.refUuid);
    }
    return c.json({
      applied,
      skipped: results.filter(r => r.result.status !== 'matched' || r.result.rule === 'existing').map(r => ({ refUuid: r.candidate.refUuid, status: r.result.status === 'matched' ? 'existing' : r.result.status })),
    });
  })
  // ручное сопоставление
  .post('/1c/links', zValidator('json', icLinkCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('json');
    const link = await linkEntity(ctx.db, actorOf(ctx), q.source as IcSource, q.entityType as IcEntityType, q.entityId, { refUuid: q.refUuid, refName: q.refName });
    return c.json(view(link), 201);
  })
  // разрыв связи
  .delete('/1c/links', zValidator('json', icLinkDelete, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('json');
    await unlinkEntity(ctx.db, actorOf(ctx), q.source as IcSource, q.entityType as IcEntityType, q.entityId);
    return c.json({ entityId: q.entityId, unlinked: true as const });
  });
