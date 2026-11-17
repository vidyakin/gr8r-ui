/* Подразделения (оргструктура, docs/architecture/departments.md). Справочник читают все, правят admin и owner.
   GET /departments/head-of/:memberId — руководитель подразделения сотрудника (основа будущего правила согласования). */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { createDepartment, deleteDepartment, departmentHeadOfMember, listDepartments, setMemberDepartment, updateDepartment } from '@erp/db';
import { departmentSave, departmentUpdate, idParam, memberDepartmentSet } from '@erp/shared';
import { ctxOf, validationHook } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const admin = requireRole('admin');
const docCtx = (c: ReturnType<typeof ctxOf>) => ({ workspaceId: c.workspaceId, memberId: c.memberId, role: c.role });
const memberParam = z.object({ memberId: z.uuid() });

export const departmentRoutes = new Hono<AppEnv>()
  .get('/', async c => c.json({ items: await listDepartments(ctxOf(c).db) }))
  .get('/head-of/:memberId', zValidator('param', memberParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await departmentHeadOfMember(ctx.db, c.req.valid('param').memberId));
  })
  .put('/by-member/:memberId', admin, zValidator('param', memberParam, validationHook), zValidator('json', memberDepartmentSet, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json({ departmentId: await setMemberDepartment(ctx.db, docCtx(ctx), c.req.valid('param').memberId, c.req.valid('json').departmentId) });
  })
  .post('/', admin, zValidator('json', departmentSave, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await createDepartment(ctx.db, docCtx(ctx), c.req.valid('json')), 201);
  })
  .patch('/:id', admin, zValidator('param', idParam, validationHook), zValidator('json', departmentUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await updateDepartment(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json')));
  })
  .delete('/:id', admin, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await deleteDepartment(ctx.db, docCtx(ctx), c.req.valid('param').id);
    return c.json({ ok: true });
  });