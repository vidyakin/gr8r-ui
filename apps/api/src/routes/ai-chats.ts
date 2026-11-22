/* Диалоги ИИ-консультанта для CRM (мультиарендная таблица ai_chat_sessions с RLS). */
import { zValidator } from '@hono/zod-validator';
import { and, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { aiChatSessions, insertLead, isUuid, pickRoundRobin, workspaces } from '@erp/db';
import { idParam } from '@erp/shared';
import { escapeLike, validationHook } from '../crud';
import { notFound } from '../errors';
import { aiChatSettingsPatch, extractAiChatSettings, mergeAiChatSettings } from '../landing-ai/settings';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

export const aiChatRoutes = new Hono<AppEnv>()
  .get('/', async c => {
    const q = c.req.query('q')?.trim();
    const locale = c.req.query('locale')?.trim();
    const leadId = c.req.query('leadId')?.trim();
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50));
    const offset = Math.max(0, Number(c.req.query('offset')) || 0);
    const pattern = q ? `%${escapeLike(q)}%` : null;
    const conds: (SQL | undefined)[] = [
      locale ? eq(aiChatSessions.locale, locale) : undefined,
      leadId && isUuid(leadId) ? eq(aiChatSessions.leadId, leadId) : undefined,
      pattern ? or(ilike(aiChatSessions.visitorName, pattern), ilike(aiChatSessions.ip, pattern), ilike(aiChatSessions.pageUrl, pattern), sql`${aiChatSessions.messages}::text ilike ${pattern}`) : undefined,
    ];
    const where = and(...conds);
    const items = await c.var.db.select().from(aiChatSessions).where(where).orderBy(desc(aiChatSessions.updatedAt)).limit(limit).offset(offset);
    const [{ n }] = await c.var.db.select({ n: count() }).from(aiChatSessions).where(where);
    return c.json({ items, total: n });
  })
  .get('/settings', async c => {
    const [ws] = await c.var.db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, c.var.workspaceId)).limit(1);
    return c.json(extractAiChatSettings(ws?.settings));
  })
  .patch('/settings', requireRole('admin'), zValidator('json', aiChatSettingsPatch, validationHook), async c => {
    const patch = c.req.valid('json');
    const [ws] = await c.var.db
      .select({ settings: workspaces.settings })
      .from(workspaces)
      .where(eq(workspaces.id, c.var.workspaceId))
      .limit(1)
      .for('update');
    const updated = mergeAiChatSettings(extractAiChatSettings(ws?.settings), patch);
    await c.var.db
      .update(workspaces)
      .set({
        settings: sql`coalesce(${workspaces.settings}, '{}'::jsonb) || ${JSON.stringify({ aiChat: updated })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(workspaces.id, c.var.workspaceId));
    return c.json(updated);
  })
  .get('/:id', zValidator('param', idParam, validationHook), async c => {
    const { id } = c.req.valid('param');
    const [row] = await c.var.db.select().from(aiChatSessions).where(eq(aiChatSessions.id, id)).limit(1);
    if (!row) throw notFound('Chat session');
    return c.json(row);
  })
  .delete('/:id', requireRole('member'), zValidator('param', idParam, validationHook), async c => {
    const { id } = c.req.valid('param');
    const [deleted] = await c.var.db.delete(aiChatSessions).where(eq(aiChatSessions.id, id)).returning({ id: aiChatSessions.id });
    if (!deleted) throw notFound('Chat session');
    return c.json({ ok: true as const });
  })
  .post('/:id/lead', requireRole('member'), zValidator('param', idParam, validationHook), async c => {
    const { id } = c.req.valid('param');
    const [session] = await c.var.db.select().from(aiChatSessions).where(eq(aiChatSessions.id, id)).limit(1).for('update');
    if (!session) throw notFound('Chat session');
    if (session.leadId) return c.json({ leadId: session.leadId });

    const firstUserMsg = session.messages.find(m => m.role === 'user')?.content?.trim();
    const name =
      session.visitorName && firstUserMsg
        ? `${session.visitorName} — ${firstUserMsg}`.slice(0, 120)
        : firstUserMsg?.slice(0, 120) || session.visitorName || 'Чат на сайте';
    const ownerId = (await pickRoundRobin(c.var.db, c.var.workspaceId)) ?? c.var.memberId;
    const lead = await insertLead(
      c.var.db,
      { workspaceId: c.var.workspaceId, memberId: c.var.memberId },
      { name, source: 'ИИ-чат', ownerId },
    );
    await c.var.db.update(aiChatSessions).set({ leadId: lead.id, updatedAt: new Date() }).where(eq(aiChatSessions.id, session.id));
    return c.json({ leadId: lead.id }, 201);
  });
