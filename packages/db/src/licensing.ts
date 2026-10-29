/* Тарифы и модули арендаторов (задача 1205, docs/architecture/licensing.md). Чтение лицензии: арендатор — функция
   app_workspace_license() (контекст app.workspace_id), воркер — app_license_of(ws) под app_worker. Запись — только функции
   оператора app_operator_* (SECURITY DEFINER, проверяют users.is_operator сами). Правила «какие модули включены» — в @gr8r/shared. */
import { sql as dsql } from 'drizzle-orm';
import { enabledModules, type LicenseLogEntry, type LicenseRaw, type LicenseView, licenseView, type ModuleId, type LicensePlanBody, type TenantLicenseBody } from '@gr8r/shared';
import type { Db, Sql, Tx } from './client';
import { withContext } from './context';
import { DomainError } from './errors';

/** Лицензия текущего арендатора (по app.workspace_id транзакции). null — нет ни назначения, ни тарифа по умолчанию */
export async function readMyLicense(db: Db): Promise<LicenseRaw | null> {
  const rows = (await db.execute(dsql`select app_workspace_license() as l`)) as unknown as { l: LicenseRaw | null }[];
  return rows[0]?.l ?? null;
}

/** Включённые модули текущего арендатора */
export async function readMyModules(db: Db, now: Date = new Date()): Promise<Set<ModuleId>> {
  return enabledModules(await readMyLicense(db), now);
}

/** Модули арендатора по его id под ролью app_worker (BYPASSRLS): для кода воркера, который уже держит транзакцию */
export async function workspaceModules(db: Db, workspaceId: string, now: Date = new Date()): Promise<Set<ModuleId>> {
  const rows = (await db.execute(dsql`select app_license_of(${workspaceId}::uuid) as l`)) as unknown as { l: LicenseRaw | null }[];
  return enabledModules(rows[0]?.l ?? null, now);
}

/** Включённые модули всех арендаторов одним запросом (для периодических проходов воркера), под app_worker */
export async function allWorkspaceModules(db: Db, now: Date = new Date()): Promise<Map<string, Set<ModuleId>>> {
  const rows = (await db.execute(dsql`select w.id as id, app_license_of(w.id) as l from workspaces w`)) as unknown as { id: string; l: LicenseRaw | null }[];
  return new Map(rows.map(r => [r.id, enabledModules(r.l, now)]));
}

/** То же с собственной короткой транзакцией: вебхуки и циклы воркера без открытого контекста */
export const modulesOfWorkspace = (sql: Sql, workspaceId: string, now?: Date) => withContext(sql, {}, db => workspaceModules(db, workspaceId, now), 'app_worker');
export const modulesByWorkspace = (sql: Sql, now?: Date) => withContext(sql, {}, db => allWorkspaceModules(db, now), 'app_worker');

/** Бросает 403 module_disabled, если модуль арендатора выключен */
export function assertModule(modules: ReadonlySet<ModuleId>, module: ModuleId): void {
  if (!modules.has(module)) throw new DomainError(403, 'module_disabled', `Module "${module}" is not enabled for this workspace`, { module });
}

export const licenseViewOf = (l: LicenseRaw | null, now?: Date): LicenseView => licenseView(l, now);

/* ---- Оператор ---- */

export interface OperatorPlan {
  id: string;
  key: string;
  name: string;
  description: string | null;
  modules: string[];
  all_modules: boolean;
  limits: Record<string, number>;
  trial_days: number | null;
  is_default: boolean;
  sort_order: number;
  tenants: number;
}

/** Ошибки PostgreSQL функций оператора → ошибки предметной области */
function mapOperatorError(e: unknown): never {
  const code = (e as { code?: string })?.code;
  const msg = e instanceof Error ? e.message : String(e);
  if (code === '42501') throw new DomainError(403, 'forbidden', 'Operator access required');
  if (code === 'P0002') throw new DomainError(404, 'not_found', msg);
  if (code === '23503') throw new DomainError(409, 'plan_in_use', msg);
  if (code === '23505') throw new DomainError(409, 'conflict', 'A plan with this key already exists');
  throw e;
}

const call = async <T>(sql: Sql, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> => {
  try {
    return await withContext(sql, { userId }, (_db, tx) => fn(tx));
  } catch (e) {
    return mapOperatorError(e);
  }
};

export const listPlans = (sql: Sql, userId: string): Promise<OperatorPlan[]> =>
  call(sql, userId, async tx => ((await tx`select app_operator_plans() as r`)[0]!.r as OperatorPlan[]));

export const savePlan = (sql: Sql, userId: string, id: string | null, body: LicensePlanBody): Promise<OperatorPlan> =>
  call(sql, userId, async tx => (await tx`select app_operator_save_plan(${id}::uuid, ${JSON.stringify(body)}::jsonb) as r`)[0]!.r as OperatorPlan);

export const deletePlan = (sql: Sql, userId: string, id: string): Promise<void> => call(sql, userId, async tx => void (await tx`select app_operator_delete_plan(${id}::uuid)`));

export const getTenantLicense = (sql: Sql, userId: string, workspaceId: string): Promise<(LicenseRaw & { assigned: boolean }) | null> =>
  call(sql, userId, async tx => (await tx`select app_operator_license(${workspaceId}::uuid) as r`)[0]!.r as (LicenseRaw & { assigned: boolean }) | null);

/** Журнал изменений лицензии арендатора для оператора, новые записи первыми (задача 1209) */
export const getLicenseLog = (sql: Sql, userId: string, workspaceId: string, limit = 200): Promise<LicenseLogEntry[]> =>
  call(sql, userId, async tx => (await tx`select app_operator_license_log(${workspaceId}::uuid, ${limit}::int) as r`)[0]!.r as LicenseLogEntry[]);

export const setTenantLicense =(sql: Sql, userId: string, workspaceId: string, body: TenantLicenseBody): Promise<LicenseRaw> =>
  call(
    sql,
    userId,
    async tx =>
      (await tx`select app_operator_set_license(${workspaceId}::uuid, ${body.planId}::uuid, ${body.planExpiresAt}::timestamptz, ${JSON.stringify(body.limits)}::jsonb, ${JSON.stringify(body.grants)}::jsonb) as r`)[0]!
        .r as LicenseRaw,
  );
