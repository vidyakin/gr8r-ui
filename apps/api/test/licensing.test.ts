/* Модули и тарифы (задача 1205, docs/architecture/licensing.md): каталог покрывает все пути API, задачи воркера и узлы
   автоматизаций; выключенный модуль даёт 403 module_disabled при прямом вызове API; запись только у оператора;
   арендатор читает только свой набор; смена набора пишет событие для realtime; воркер не исполняет задачи выключенного модуля. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { setOperator } from '@gr8r/db';
import { defaultOptions, processEventsOnce, processJobsOnce } from '../../worker/src/worker';
import { disabledModulesOfNodes, enabledModules, MODULE_IDS, MODULE_OF_JOB, MODULE_OF_NODE, MODULE_OF_PATH, NODE_LIST, resolveModules } from '@gr8r/shared';
import { jobHandlers } from '../../worker/src/handlers';
import { TENANT_PATHS } from '../src/app';
import { admin, Client, ddl, drainJobs, sql, uniq } from './helpers';

let op: Client; // оператор установки
let tenant: Client; // арендатор, которому меняем лицензию
let plain: Client; // обычный пользователь
let corePlan: string;
let fullPlan: string;

const license = (c: Client, planId: string, grants: { module: string; expiresAt?: string | null }[] = [], planExpiresAt: string | null = null) =>
  op.put(`/admin/tenants/${c.workspaceId}/license`, { planId, planExpiresAt, grants: grants.map(g => ({ module: g.module, expiresAt: g.expiresAt ?? null })) });

beforeAll(async () => {
  op = new Client();
  await op.signup();
  await setOperator(sql, op.user!.email, true);
  tenant = new Client();
  await tenant.signup();
  plain = new Client();
  await plain.signup();
  fullPlan = ((await admin`select id from license_plans where key = 'full'`)[0] as { id: string }).id;
  const created = await op.post('/admin/plans', { name: 'Только ядро', modules: [] });
  expect(created.status).toBe(201);
  corePlan = created.body.id;
});

describe('каталог модулей', () => {
  test('каждый корневой путь TENANT_PATHS принадлежит модулю', () => {
    for (const p of TENANT_PATHS) expect(MODULE_OF_PATH.get(p), `путь ${p}`).toBeTruthy();
  });
  test('каждый путь модуля есть в TENANT_PATHS (нет опечаток в каталоге)', () => {
    for (const p of MODULE_OF_PATH.keys()) expect(TENANT_PATHS, `путь ${p}`).toContain(p);
  });
  test('каждый тип задачи воркера отнесён к модулю', () => {
    for (const type of Object.keys(jobHandlers)) expect(MODULE_OF_JOB.get(type), `задача ${type}`).toBeTruthy();
    for (const type of MODULE_OF_JOB.keys()) expect(Object.keys(jobHandlers), `задача ${type}`).toContain(type);
  });
  test('каждый узел автоматизации отнесён к модулю', () => {
    for (const n of NODE_LIST) expect(MODULE_OF_NODE.get(n.type), `узел ${n.type}`).toBeTruthy();
    for (const type of MODULE_OF_NODE.keys()) expect(NODE_LIST.map(n => n.type), `узел ${type}`).toContain(type);
  });
  test('зависимости: production тянет trade, payroll — money и trade', () => {
    expect([...resolveModules(['production'])].sort()).toEqual(['core', 'production', 'trade']);
    expect(resolveModules(['payroll']).has('trade')).toBe(true);
    expect(resolveModules(['*']).size).toBe(MODULE_IDS.length);
  });
  test('срок: просроченный доп. модуль и тариф не действуют', () => {
    const l = { planId: null, planKey: null, planName: null, planModules: ['crm'], planAllModules: false, planExpiresAt: '2000-01-01T00:00:00Z', grants: [{ module: 'money', expiresAt: '2000-01-01T00:00:00Z' }, { module: 'services', expiresAt: null }], limits: {} };
    expect([...enabledModules(l)].sort()).toEqual(['core', 'services', 'trade']);
  });
  test('узлы выключенного модуля находятся по типам', () => {
    expect(disabledModulesOfNodes(['trigger.manual', 'action.create_lead', 'trigger.payment_posted'], resolveModules(['automations']))).toEqual(['crm', 'money']);
  });
});

describe('запрет по модулю', () => {
  test('по умолчанию («Полный») всё доступно', async () => {
    expect((await tenant.get('/deals')).status).toBe(200);
    expect((await tenant.get('/license')).body.modules).toEqual([...MODULE_IDS]);
  });

  test('тариф «только ядро»: прямой вызов API выключенного модуля — 403 module_disabled, ядро работает', async () => {
    expect((await license(tenant, corePlan)).status).toBe(200);
    for (const path of ['/deals', '/leads', '/documents', '/payments', '/production/needs', '/work-orders', '/flows', '/payroll', '/bank-connections']) {
      const r = await tenant.get(path);
      expect(r.status, path).toBe(403);
      expect(r.body.error.code, path).toBe('module_disabled');
    }
    // запись тоже закрыта, а подпуть берётся по корню
    expect((await tenant.post('/deals', { title: 'x' })).body.error.code).toBe('module_disabled');
    expect((await tenant.get('/deals/00000000-0000-0000-0000-000000000000')).body.error.code).toBe('module_disabled');
    expect((await tenant.get('/tasks')).status).toBe(200);
    expect((await tenant.get('/companies')).status).toBe(200);
    expect((await tenant.get('/license')).body.modules).toEqual(['core']);
  });

  test('доп. модуль включает путь и тянет зависимости; срок в прошлом снова закрывает', async () => {
    await license(tenant, corePlan, [{ module: 'crm' }, { module: 'payroll' }]);
    expect((await tenant.get('/deals')).status).toBe(200);
    expect((await tenant.get('/payroll/employees')).status).not.toBe(403); // payroll → money → trade
    expect((await tenant.get('/documents')).status).toBe(200);
    expect((await tenant.get('/flows')).body.error.code).toBe('module_disabled');
    await license(tenant, corePlan, [{ module: 'crm', expiresAt: '2000-01-01T00:00:00Z' }]);
    expect((await tenant.get('/deals')).body.error.code).toBe('module_disabled');
  });

  test('чужой арендатор не затронут', async () => {
    expect((await plain.get('/deals')).status).toBe(200);
  });

  test('смена лицензии пишет событие license.changed (realtime)', async () => {
    const before = (await admin`select count(*)::int as n from events where workspace_id = ${tenant.workspaceId} and type = 'license.changed'`)[0]!.n as number;
    await license(tenant, corePlan, [{ module: 'crm' }]);
    const after = (await admin`select count(*)::int as n from events where workspace_id = ${tenant.workspaceId} and type = 'license.changed' and entity = 'license'`)[0]!.n as number;
    expect(after).toBe(before + 1);
  });

  test('воркер не исполняет задачу выключенного модуля и не повторяет её', async () => {
    await license(tenant, corePlan, []);
    const [job] = await admin`insert into jobs (workspace_id, type, payload) values (${tenant.workspaceId}, 'billing.export_zip', ${JSON.stringify({ exportId: '00000000-0000-0000-0000-000000000000' })}::jsonb) returning id`;
    await drainJobs();
    const [row] = await admin`select status, last_error, attempts from jobs where id = ${job!.id}`;
    expect(row).toMatchObject({ status: 'failed' });
    expect(row!.last_error).toContain('module_disabled');
    // задача ядра идёт как обычно
    const [noop] = await admin`insert into jobs (workspace_id, type) values (${tenant.workspaceId}, 'noop') returning id`;
    await drainJobs();
    expect((await admin`select status from jobs where id = ${noop!.id}`)[0]!.status).toBe('done');
  });

  test('обратно на «Полный» — модули возвращаются', async () => {
    await license(tenant, fullPlan);
    expect((await tenant.get('/deals')).status).toBe(200);
  });
});

describe('автоматизации и модули', () => {
  test('flow с узлом выключенного модуля пропускается с понятной причиной, flow без таких узлов работает', async () => {
    const c = new Client();
    await c.signup();
    await license(c, corePlan, [{ module: 'automations' }]);
    const project = await c.project('LIC', 'Licensing');
    const mk = async (name: string, nodes: any[]) => {
      const g = { nodes: nodes.map(([id, type, params]: any, i: number) => ({ id, type, position: { x: i * 200, y: 0 }, params })), edges: nodes.slice(1).map((n: any, i: number) => ({ id: `e${i}`, source: nodes[i][0], target: n[0], sourceHandle: null })) };
      const f = await c.post('/flows', { name, graph: g });
      expect(f.status).toBe(201);
      expect((await c.post(`/flows/${f.body.id}/publish`, { enable: true })).status).toBe(200);
      return f.body.id as string;
    };
    const withCrm = await mk('crm node', [['t', 'trigger.record_created', { entity: 'task' }], ['l', 'action.create_lead', { name: 'From flow' }]]);
    const plainFlow = await mk('plain', [['t', 'trigger.record_created', { entity: 'task' }], ['n', 'action.add_comment', {}]]);
    await c.task(project.id, 'Trigger me');
    const o = defaultOptions({ log: () => {}, concurrency: 10, ddl });
    for (let i = 0; i < 20 && (await processEventsOnce(sql, o)) + (await processJobsOnce(sql, o)) > 0; i++);
    const runs = async (id: string) => (await c.get(`/flow-runs?flowId=${id}&limit=10`)).body.items as any[];
    const a = await runs(withCrm);
    expect(a).toHaveLength(1);
    expect(a[0].status).toBe('skipped');
    expect(a[0].error).toContain('crm');
    expect((await runs(plainFlow))[0]?.status).not.toBe('skipped');
    // модуль «Автоматизации» выключен совсем: запусков нет
    await license(c, corePlan, []);
    await admin`update flows set enabled = true where workspace_id = ${c.workspaceId}`;
    const before = (await admin`select count(*)::int as n from flow_runs where workspace_id = ${c.workspaceId}`)[0]!.n as number;
    await admin`insert into events (workspace_id, type, entity) values (${c.workspaceId}, 'task.created', 'task')`;
    for (let i = 0; i < 20 && (await processEventsOnce(sql, o)) + (await processJobsOnce(sql, o)) > 0; i++);
    expect((await admin`select count(*)::int as n from flow_runs where workspace_id = ${c.workspaceId}`)[0]!.n).toBe(before);
  });
});

describe('доступ к тарифам', () => {
  test('не оператор не читает и не меняет тарифы и лицензии', async () => {
    expect((await plain.get('/admin/plans')).status).toBe(403);
    expect((await plain.post('/admin/plans', { name: 'x' })).status).toBe(403);
    expect((await plain.put(`/admin/tenants/${plain.workspaceId}/license`, { planId: fullPlan })).status).toBe(403);
  });

  test('функции БД сами проверяют оператора (в обход проверки маршрута)', async () => {
    const asUser = (userId: string, fn: (tx: any) => Promise<unknown>) =>
      sql.begin(async tx => {
        await tx.unsafe('set local role app_user');
        await tx`select set_config('app.user_id', ${userId}, true)`;
        return fn(tx);
      });
    await expect(asUser(plain.user!.id, tx => tx`select app_operator_plans()`)).rejects.toThrow(/operator access required/);
    await expect(asUser(plain.user!.id, tx => tx`select app_operator_set_license(${plain.workspaceId}::uuid, ${fullPlan}::uuid, null, '{}'::jsonb, '[]'::jsonb)`)).rejects.toThrow(/operator access required/);
  });

  test('app_user не видит справочник тарифов и не пишет в таблицы лицензий; свою строку читает', async () => {
    const asTenant = (ws: string, fn: (tx: any) => Promise<any>) =>
      sql.begin(async tx => {
        await tx.unsafe('set local role app_user');
        await tx`select set_config('app.workspace_id', ${ws}, true)`;
        return fn(tx);
      });
    await expect(asTenant(plain.workspaceId!, tx => tx`select * from license_plans`)).rejects.toThrow(/permission denied/);
    await expect(asTenant(plain.workspaceId!, tx => tx`insert into license_plans (key, name) values ('hack', 'hack')`)).rejects.toThrow(/permission denied/);
    await expect(asTenant(plain.workspaceId!, tx => tx`update workspace_licenses set plan_id = ${corePlan}`)).rejects.toThrow(/permission denied/);
    await expect(asTenant(plain.workspaceId!, tx => tx`insert into workspace_module_grants (workspace_id, module) values (${plain.workspaceId}, 'crm')`)).rejects.toThrow(/permission denied/);
    await license(plain, fullPlan);
    const rows = await asTenant(plain.workspaceId!, tx => tx`select workspace_id from workspace_licenses`);
    expect(rows.map((r: any) => r.workspace_id)).toEqual([plain.workspaceId]);
  });

  test('тариф: CRUD, тариф по умолчанию один, используемый тариф не удалить', async () => {
    const list = await op.get('/admin/plans');
    expect(list.body.items.map((p: any) => p.key)).toContain('full');
    const p = await op.post('/admin/plans', { name: 'Торговля', modules: ['trade', 'crm'], limits: { members: 5 }, trialDays: 14 });
    expect(p.body).toMatchObject({ name: 'Торговля', modules: ['trade', 'crm'], limits: { members: 5 }, trial_days: 14 });
    const upd = await op.put(`/admin/plans/${p.body.id}`, { name: 'Торговля+', modules: ['trade'] });
    expect(upd.body.name).toBe('Торговля+');
    // назначили — удалить нельзя
    await license(plain, p.body.id);
    expect((await op.del(`/admin/plans/${p.body.id}`)).body.error.code).toBe('plan_in_use');
    await license(plain, fullPlan);
    expect((await op.del(`/admin/plans/${p.body.id}`)).status).toBe(200);
    // тариф по умолчанию: смена переносит флаг
    const other = await op.post('/admin/plans', { name: 'Новый по умолчанию', isDefault: true });
    expect(other.body.is_default).toBe(true);
    expect((await admin`select count(*)::int as n from license_plans where is_default`)[0]!.n).toBe(1);
    expect((await op.del(`/admin/plans/${other.body.id}`)).body.error.code).toBe('plan_in_use');
    await op.put(`/admin/plans/${fullPlan}`, { name: 'Полный', allModules: true, isDefault: true });
    expect((await op.del(`/admin/plans/${other.body.id}`)).status).toBe(200);
  });

  test('арендатор без назначения получает тариф по умолчанию', async () => {
    const c = new Client();
    await c.signup();
    await admin`delete from workspace_licenses where workspace_id = ${c.workspaceId}`;
    expect((await c.get('/license')).body.modules).toEqual([...MODULE_IDS]);
    expect(uniq()).toBeTruthy();
  });
});
