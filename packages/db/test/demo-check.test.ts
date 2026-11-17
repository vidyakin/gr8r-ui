/* Полноценное демо: история прошлых месяцев проводится настоящими сервисами, после неё учёт сходится (demo-check.ts).
   Регрессия бизнес-логики проведения: ошибка в остатках, деньгах или расчётах роняет этот тест */
import { describe, expect, test } from 'bun:test';
import { adminDatabaseUrl, createSql, databaseUrl, withContext } from '../src';
import { checkWorkspace, formatReport } from '../src/demo-check';
import { HISTORY_MONTHS, historyMonthStart } from '../src/seed-history';
import { createTenant } from '../src/tenants';

describe('demo history', () => {
  test('fills past months and keeps stock, money and documents consistent', async () => {
    const sql = createSql(databaseUrl(), { max: 4 });
    const admin = createSql(adminDatabaseUrl(), { max: 1 });
    try {
      const t = await createTenant(sql, { name: 'Демо с историей', slug: 'demo-history', owner: { email: 'history@demo.test', name: 'Демо', password: 'history123' }, demo: true });
      const report = await withContext(admin, { workspaceId: t.workspaceId }, (_db, tx) => checkWorkspace(tx, t.workspaceId));
      const errors = report.issues.filter(i => i.level === 'error');
      if (errors.length) console.log(formatReport(report));
      expect(errors).toEqual([]);
      // остаток на дату не уходит в минус и деньги не проваливаются: история закупает раньше, чем продаёт
      expect(report.issues.map(i => i.code)).not.toContain('negative_stock_on_date');
      expect(report.issues.map(i => i.code)).not.toContain('negative_cash_on_date');
      expect(report.stats.documents).toBeGreaterThan(250);
      expect(report.stats.companies).toBeGreaterThan(30);

      // каждый месяц истории закрыт, текущий открыт
      const [ws] = await admin`select closed_through::text as c from workspaces where id = ${t.workspaceId}`;
      expect(ws!.c.slice(0, 7)).toBe(historyMonthStart(1).slice(0, 7));
      const closings = await admin`select period::text as p from production_cost_closings where workspace_id = ${t.workspaceId} and status = 'done' order by period`;
      expect(closings.map(c => (c.p as string).slice(0, 7))).toEqual(Array.from({ length: HISTORY_MONTHS }, (_, i) => historyMonthStart(HISTORY_MONTHS - i).slice(0, 7)));
      // в каждом прошлом месяце есть отгрузки
      const months = await admin`select distinct to_char(date, 'YYYY-MM') as m from documents where workspace_id = ${t.workspaceId} and type = 'realization' and status = 'posted'`;
      for (let i = 1; i <= HISTORY_MONTHS; i++) expect(months.map(r => r.m)).toContain(historyMonthStart(i).slice(0, 7));
    } finally {
      await sql.end();
      await admin.end();
    }
  }, 120_000);
});
