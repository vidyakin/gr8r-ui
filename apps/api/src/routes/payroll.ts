/* Зарплата (задача 1184): справочники, кадровые данные, документы начисления и ведомости, выплата, отчёты, расчётный листок.
   Суммы зарплаты видят только admin и owner; сотрудник видит свой расчётный листок. Проведение и отмена — общие маршруты
   документов (`/documents/:id/post|unpost`). Правила — packages/db/src/payroll.ts и docs/architecture/payroll.md. */
import { zValidator } from '@hono/zod-validator';
import {
  addEmployeeAccrual,
  archivePayrollKind,
  archiveReflection,
  createPayrollKind,
  createPayroll,
  createReflection,
  createStatement,
  deleteEmployeeAccrual,
  fillPayroll,
  fillStatement,
  listEmployees,
  listPayrolls,
  listPayrollKinds,
  listReflections,
  listStatements,
  payrollDetail,
  payrollSettings,
  payrollSummary,
  payslip,
  payslipPrintData,
  payStatement,
  setInsuranceRate,
  settlementsReport,
  statementDetail,
  statementPrintData,
  statementRegistry,
  updateEmployeePayroll,
  updatePayroll,
  updatePayrollKind,
  updateReflection,
  updateStatement,
} from '@gr8r/db';
import {
  renderPayslip,
  renderPaymentStatement,
  employeeAccrualCreate,
  employeePayrollUpdate,
  idParam,
  payrollCreate,
  payrollFillBody,
  payrollKindCreate,
  payrollKindUpdate,
  payrollQuery,
  payrollReflectionCreate,
  payrollReflectionUpdate,
  payrollReportQuery,
  payrollSettingsUpdate,
  payrollUpdate,
  payslipQuery,
  statementCreate,
  statementPayBody,
  statementQuery,
  statementUpdate,
  uuid,
} from '@gr8r/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { ctxOf, validationHook, type Ctx } from '../crud';
import { AppError } from '../errors';
import { hasRole, requireRole } from '../middleware';
import type { AppEnv } from '../types';

const admin = requireRole('admin');
const docCtx = (ctx: Ctx) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });
const csv = (v: string | undefined) => (v ? v.split(',').filter(Boolean) : undefined);

export const payrollRoutes = new Hono<AppEnv>()
  // расчётный листок: сотрудник — свой, admin и owner — любого
  .get('/payslip', zValidator('query', payslipQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const own = ctx.memberId;
    const target = hasRole(c, 'admin') ? (q.memberId ?? own) : own;
    if (!target) throw new AppError(404, 'not_found', 'employee not found');
    if (q.memberId && q.memberId !== own && !hasRole(c, 'admin')) throw new AppError(403, 'forbidden', 'Only admin can see the payslip of another employee');
    return c.json(await payslip(ctx.db, ctx.workspaceId, target, q.period));
  })
  // печатная форма расчётного листка (HTML, A4)
  .get('/payslip/print', zValidator('query', payslipQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const own = ctx.memberId;
    if (q.memberId && q.memberId !== own && !hasRole(c, 'admin')) throw new AppError(403, 'forbidden', 'Only admin can see the payslip of another employee');
    const target = hasRole(c, 'admin') ? (q.memberId ?? own) : own;
    if (!target) throw new AppError(404, 'not_found', 'employee not found');
    c.header('Content-Security-Policy', "default-src 'none'; img-src * data:; style-src 'unsafe-inline'");
    c.header('X-Content-Type-Options', 'nosniff');
    return c.html(renderPayslip(await payslipPrintData(ctx.db, ctx.workspaceId, target, q.period)));
  })
  .use('*', admin)
  // платёжная ведомость Т-53 (HTML, A4 альбом)
  .get('/statements/:id/print', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    c.header('Content-Security-Policy', "default-src 'none'; img-src * data:; style-src 'unsafe-inline'");
    c.header('X-Content-Type-Options', 'nosniff');
    return c.html(renderPaymentStatement(await statementPrintData(ctx.db, c.req.valid('param').id)));
  })
  /* справочники и настройки */
  .get('/settings', async c => c.json(await payrollSettings(ctxOf(c).db, ctxOf(c).workspaceId)))
  .patch('/settings', zValidator('json', payrollSettingsUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    await setInsuranceRate(ctx.db, ctx.workspaceId, c.req.valid('json').insuranceRate);
    return c.json(await payrollSettings(ctx.db, ctx.workspaceId));
  })
  .get('/kinds', async c => c.json({ items: await listPayrollKinds(ctxOf(c).db, ctxOf(c).workspaceId) }))
  .post('/kinds', zValidator('json', payrollKindCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    await createPayrollKind(ctx.db, docCtx(ctx), c.req.valid('json'));
    return c.json({ items: await listPayrollKinds(ctx.db, ctx.workspaceId) }, 201);
  })
  .patch('/kinds/:id', zValidator('param', idParam, validationHook), zValidator('json', payrollKindUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    await updatePayrollKind(ctx.db, c.req.valid('param').id, c.req.valid('json'));
    return c.json({ items: await listPayrollKinds(ctx.db, ctx.workspaceId) });
  })
  .delete('/kinds/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await archivePayrollKind(ctx.db, c.req.valid('param').id);
    return c.json({ items: await listPayrollKinds(ctx.db, ctx.workspaceId) });
  })
  .get('/reflections', async c => c.json({ items: await listReflections(ctxOf(c).db, ctxOf(c).workspaceId) }))
  .post('/reflections', zValidator('json', payrollReflectionCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    await createReflection(ctx.db, docCtx(ctx), c.req.valid('json'));
    return c.json({ items: await listReflections(ctx.db, ctx.workspaceId) }, 201);
  })
  .patch('/reflections/:id', zValidator('param', idParam, validationHook), zValidator('json', payrollReflectionUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    await updateReflection(ctx.db, c.req.valid('param').id, c.req.valid('json'));
    return c.json({ items: await listReflections(ctx.db, ctx.workspaceId) });
  })
  .delete('/reflections/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await archiveReflection(ctx.db, c.req.valid('param').id);
    return c.json({ items: await listReflections(ctx.db, ctx.workspaceId) });
  })
  /* кадровые данные */
  .get('/employees', async c => c.json({ items: await listEmployees(ctxOf(c).db, ctxOf(c).workspaceId) }))
  .put('/employees/:memberId', zValidator('param', z.object({ memberId: uuid }), validationHook), zValidator('json', employeePayrollUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    await updateEmployeePayroll(ctx.db, docCtx(ctx), c.req.valid('param').memberId, c.req.valid('json'));
    return c.json({ items: await listEmployees(ctx.db, ctx.workspaceId) });
  })
  .post('/accruals', zValidator('json', employeeAccrualCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    await addEmployeeAccrual(ctx.db, docCtx(ctx), c.req.valid('json'));
    return c.json({ items: await listEmployees(ctx.db, ctx.workspaceId) }, 201);
  })
  .delete('/accruals/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await deleteEmployeeAccrual(ctx.db, c.req.valid('param').id);
    return c.json({ items: await listEmployees(ctx.db, ctx.workspaceId) });
  })
  /* начисление зарплаты */
  .get('/documents', zValidator('query', payrollQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    return c.json(await listPayrolls(ctx.db, ctx.workspaceId, { limit: q.limit, offset: q.offset, status: csv(q.status), period: q.period }));
  })
  .post('/documents', zValidator('json', payrollCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = await createPayroll(ctx.db, docCtx(ctx), c.req.valid('json'));
    return c.json(await payrollDetail(ctx.db, id), 201);
  })
  .get('/documents/:id', zValidator('param', idParam, validationHook), async c => c.json(await payrollDetail(ctxOf(c).db, c.req.valid('param').id)))
  .patch('/documents/:id', zValidator('param', idParam, validationHook), zValidator('json', payrollUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await updatePayroll(ctx.db, docCtx(ctx), id, c.req.valid('json'));
    return c.json(await payrollDetail(ctx.db, id));
  })
  .post('/documents/:id/fill', zValidator('param', idParam, validationHook), zValidator('json', payrollFillBody, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await fillPayroll(ctx.db, docCtx(ctx), id, c.req.valid('json').memberIds);
    return c.json(await payrollDetail(ctx.db, id));
  })
  /* ведомость на выплату */
  .get('/statements', zValidator('query', statementQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    return c.json(await listStatements(ctx.db, ctx.workspaceId, { limit: q.limit, offset: q.offset, status: csv(q.status), period: q.period }));
  })
  .post('/statements', zValidator('json', statementCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = await createStatement(ctx.db, docCtx(ctx), c.req.valid('json'));
    return c.json(await statementDetail(ctx.db, id), 201);
  })
  .get('/statements/:id', zValidator('param', idParam, validationHook), async c => c.json(await statementDetail(ctxOf(c).db, c.req.valid('param').id)))
  .patch('/statements/:id', zValidator('param', idParam, validationHook), zValidator('json', statementUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await updateStatement(ctx.db, docCtx(ctx), id, c.req.valid('json'));
    return c.json(await statementDetail(ctx.db, id));
  })
  .post('/statements/:id/fill', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await fillStatement(ctx.db, docCtx(ctx), id);
    return c.json(await statementDetail(ctx.db, id));
  })
  // черновик РКО или списания со счёта на основании ведомости; проведение — общее (`/documents/:id/post`)
  .post('/statements/:id/pay', zValidator('param', idParam, validationHook), zValidator('json', statementPayBody, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const paymentId = await payStatement(ctx.db, docCtx(ctx), id, c.req.valid('json'));
    return c.json({ paymentId, statement: await statementDetail(ctx.db, id) }, 201);
  })
  // зарплатный реестр для банка (CSV)
  .get('/statements/:id/registry', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const r = await statementRegistry(ctx.db, c.req.valid('param').id);
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', 'attachment; filename="salary-registry.csv"');
    c.header('X-Skipped-Count', String(r.skipped));
    return c.body(r.csv);
  })
  /* отчёты */
  .get('/reports/settlements', zValidator('query', payrollReportQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await settlementsReport(ctx.db, ctx.workspaceId, c.req.valid('query')));
  })
  .get('/reports/summary', zValidator('query', payrollReportQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await payrollSummary(ctx.db, ctx.workspaceId, c.req.valid('query')));
  });
