/* Модули и тарифы (задача 1205, docs/architecture/licensing.md): каталог покрывает все пути API, задачи воркера и узлы
   автоматизаций; выключенный модуль даёт 403 module_disabled при прямом вызове API; запись только у оператора;
   арендатор читает только свой набор; смена набора пишет событие для realtime; воркер не исполняет задачи выключенного модуля. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { setOperator } from '@gr8r/db';
import { defaultOptions, processEventsOnce, processJobsOnce } from '../../worker/src/worker';
import { disabledModulesOfNodes, enabledModules, licenseNotices, licenseView, moduleStates, readableModules, type LicenseRaw, MODULE_IDS, MODULE_OF_JOB, MODULE_OF_NODE, MODULE_OF_PATH, NODE_LIST, resolveModules } from '@gr8r/shared';
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

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString();
const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString();
const raw = (over: Partial<LicenseRaw>): LicenseRaw => ({ planId: null, planKey: null, planName: null, planModules: [], planAllModules: false, planExpiresAt: null, grants: [], limits: {}, ...over });

describe('сроки: только чтение и баннер (1206)', () => {
  test('moduleStates: действует → 14 дней только чтение → выключен; действующий источник перевешивает; зависимости', () => {
    const l = raw({ planModules: ['crm'], planExpiresAt: daysAgo(3), grants: [{ module: 'payroll', expiresAt: daysAgo(20) }, { module: 'trade', expiresAt: null }] });
    const s = moduleStates(l);
    expect(s.core.state).toBe('active');
    expect(s.crm.state).toBe('readonly');
    expect(new Date(s.crm.readonlyUntil!).getTime()).toBeGreaterThan(Date.now() + 10 * 864e5);
    expect(s.payroll.state).toBe('off'); // 20 дней назад — позже окна
    expect(s.trade.state).toBe('active'); // бессрочный доп. модуль, хотя payroll (тянул trade) истёк
    expect(s.money.state).toBe('off');
    expect([...enabledModules(l)].sort()).toEqual(['core', 'trade']);
    expect([...readableModules(l)].sort()).toEqual(['core', 'crm', 'trade']);
    // истёкший тариф покрыт действующим доп. модулем: действует
    expect(moduleStates(raw({ planModules: ['crm'], planExpiresAt: daysAgo(3), grants: [{ module: 'crm', expiresAt: inDays(5) }] })).crm.state).toBe('active');
  });

  test('баннер: за 7 дней до конца и в режиме только чтение', () => {
    expect(licenseNotices(licenseView(raw({ planModules: ['crm'], planExpiresAt: inDays(30) })))).toEqual([]);
    const soon = licenseNotices(licenseView(raw({ planModules: ['crm'], planExpiresAt: inDays(5), isTrial: true })));
    expect(soon).toHaveLength(1);
    expect(soon[0]).toMatchObject({ kind: 'expiring', trial: true });
    expect(soon[0]!.modules).toContain('crm');
    const ro = licenseNotices(licenseView(raw({ planModules: ['crm'], planExpiresAt: daysAgo(2) })));
    expect(ro[0]).toMatchObject({ kind: 'readonly' });
    expect(licenseNotices(licenseView(raw({ planModules: ['crm'], planExpiresAt: daysAgo(40) })))).toEqual([]);
  });

  test('API: после срока чтение работает, запись — 403 module_expired; через 14 дней — module_disabled', async () => {
    const c = new Client();
    await c.signup();
    await license(c, corePlan, [{ module: 'crm', expiresAt: daysAgo(3) }]);
    expect((await c.get('/deals')).status).toBe(200);
    for (const [m, path] of [['post', '/deals'], ['put', '/deals/00000000-0000-0000-0000-000000000000'], ['del', '/deals/00000000-0000-0000-0000-000000000000']] as const) {
      const r = m === 'del' ? await c.del(path) : await (c as any)[m](path, { title: 'x' });
      expect(r.status, `${m} ${path}`).toBe(403);
      expect(r.body.error.code).toBe('module_expired');
    }
    const v = (await c.get('/license')).body;
    expect(v.modules).toContain('crm');
    expect(v.states.crm).toMatchObject({ state: 'readonly' });
    expect((await c.get('/tasks')).status).toBe(200);
    expect((await c.post('/companies', { name: 'Core still writes' })).status).toBe(201);
    await license(c, corePlan, [{ module: 'crm', expiresAt: daysAgo(15) }]);
    expect((await c.get('/deals')).body.error.code).toBe('module_disabled');
    expect((await c.get('/license')).body.modules).toEqual(['core']);
  });

  test('воркер: в режиме только чтение задачи записи не идут, печать и выгрузки — идут', async () => {
    const c = new Client();
    await c.signup();
    await license(c, corePlan, [{ module: 'production', expiresAt: daysAgo(3) }, { module: 'services', expiresAt: daysAgo(3) }]);
    const [w] = await admin`insert into jobs (workspace_id, type, payload) values (${c.workspaceId}, 'production.close_period', '{}'::jsonb) returning id`;
    const [r] = await admin`insert into jobs (workspace_id, type, payload) values (${c.workspaceId}, 'billing.export_zip', ${JSON.stringify({ exportId: '00000000-0000-0000-0000-000000000000' })}::jsonb) returning id`;
    await drainJobs();
    expect((await admin`select last_error from jobs where id = ${w!.id}`)[0]!.last_error).toContain('module_disabled');
    expect(String((await admin`select last_error from jobs where id = ${r!.id}`)[0]!.last_error)).not.toContain('module_disabled');
  });

  test('пробный период: арендатор с тарифом, у которого trial_days — срок, признак и запись в журнале; без trial_days ничего не меняется', async () => {
    const trialPlan = (await op.post('/admin/plans', { name: 'Пробный', modules: ['crm', 'trade'], trialDays: 14 })).body.id as string;
    const noTrial = (await op.post('/admin/plans', { name: 'Без пробного', modules: ['crm'] })).body.id as string;
    const mk = async (planId?: string) => {
      const res = await op.post('/admin/tenants', { name: `Trial ${uniq()}`, ownerEmail: `owner-${uniq()}@test.dev`, planId });
      expect(res.status).toBe(201);
      return res.body.workspaceId as string;
    };
    const t1 = await mk(trialPlan);
    const l1 = (await op.get(`/admin/tenants/${t1}/license`)).body;
    expect(l1).toMatchObject({ assigned: true, isTrial: true, planName: 'Пробный' });
    const days = (new Date(l1.planExpiresAt).getTime() - Date.now()) / 864e5;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
    const log = (await op.get(`/admin/tenants/${t1}/license-log`)).body.items as any[];
    expect(log.some(i => i.kind === 'trial_started' && i.actorEmail === op.user!.email)).toBe(true);
    // тариф без пробного периода назначен, срока нет
    const l2 = (await op.get(`/admin/tenants/${await mk(noTrial)}/license`)).body;
    expect(l2).toMatchObject({ assigned: true, isTrial: false, planExpiresAt: null, planName: 'Без пробного' });
    // тариф по умолчанию без trial_days: строки нет
    const l3 = (await op.get(`/admin/tenants/${await mk()}/license`)).body;
    expect(l3).toMatchObject({ assigned: false, planName: 'Полный' });
    // оператор может снять признак пробного периода и продлить
    const res = await op.put(`/admin/tenants/${t1}/license`, { planId: trialPlan, planExpiresAt: inDays(365), isTrial: false });
    expect(res.status).toBe(200);
    expect((await op.get(`/admin/tenants/${t1}/license`)).body.isTrial).toBe(false);
  });
});

describe('лимиты (1207)', () => {
  const setLimits = (c: Client, limits: Record<string, number>, planId = fullPlan) => op.put(`/admin/tenants/${c.workspaceId}/license`, { planId, limits });
  const usage = async (c: Client) => (await op.get(`/admin/tenants/${c.workspaceId}/license`)).body.usage;

  test('пользователи: участники и неотвеченные приглашения; существующих не трогаем; 403 limit_exceeded с подробностями', async () => {
    const c = new Client();
    await c.signup();
    expect((await usage(c)).members).toBe(1);
    await setLimits(c, { members: 2 });
    const invite = (email: string) => c.post(`/workspaces/${c.workspaceId}/invites`, { email, role: 'member' });
    expect((await invite(`a-${uniq()}@test.dev`)).status).toBe(201);
    expect((await usage(c)).members).toBe(2);
    const r = await invite(`b-${uniq()}@test.dev`);
    expect(r.status).toBe(403);
    expect(r.body.error).toMatchObject({ code: 'limit_exceeded', details: { limit: 'members', max: 2, used: 2 } });
    // лимит ниже текущего использования: существующее остаётся, нового нет
    await setLimits(c, { members: 1 });
    expect((await c.get('/members')).status).toBe(200);
    expect((await invite(`c-${uniq()}@test.dev`)).body.error.code).toBe('limit_exceeded');
    // снятие лимита возвращает возможность
    await setLimits(c, {});
    expect((await invite(`d-${uniq()}@test.dev`)).status).toBe(201);
  });

  test('организации и склады: 0 — больше нельзя, существующие остаются', async () => {
    const c = new Client();
    await c.signup();
    const u = await usage(c);
    expect(u.organizations).toBeGreaterThan(0);
    await setLimits(c, { organizations: u.organizations, warehouses: u.warehouses });
    const org = await c.post('/organizations', { name: 'Ещё одна' });
    expect(org.status).toBe(403);
    expect(org.body.error).toMatchObject({ code: 'limit_exceeded', details: { limit: 'organizations' } });
    expect((await c.post('/warehouses', { name: 'Ещё склад', code: 'X1' })).body.error.code).toBe('limit_exceeded');
    expect((await c.get('/organizations')).body.items.length).toBe(u.organizations);
    await setLimits(c, { organizations: u.organizations + 1, warehouses: u.warehouses + 1 });
    expect((await c.post('/organizations', { name: 'Ещё одна' })).status).toBe(201);
    expect((await c.post('/warehouses', { name: 'Ещё склад', code: 'X1' })).status).toBe(201);
    expect((await c.post('/organizations', { name: 'И ещё' })).body.error.code).toBe('limit_exceeded');
  });

  test('объём файлов: считаем размеры файлов и PDF, лимит в МБ проверяется при создании файла', async () => {
    const c = new Client();
    await c.signup();
    await setLimits(c, { storageMb: 1 });
    expect((await c.post('/files', { name: 'a.bin', sizeBytes: 600 * 1024 })).status).toBe(201);
    expect((await usage(c)).storageBytes).toBe(600 * 1024);
    const big = await c.post('/files', { name: 'b.bin', sizeBytes: 600 * 1024 });
    expect(big.status).toBe(403);
    expect(big.body.error).toMatchObject({ code: 'limit_exceeded', details: { limit: 'storageMb', max: 1 } });
    expect((await c.post('/files', { name: 'c.bin', sizeBytes: 100 * 1024 })).status).toBe(201);
  });

  test('лимит тарифа действует, персональный поверх него; оператор видит оба и использование; неизвестный ключ — 400', async () => {
    const c = new Client();
    await c.signup();
    const plan = (await op.post('/admin/plans', { name: `С лимитом ${uniq()}`, modules: [], limits: { organizations: 0 } })).body.id as string;
    await setLimits(c, {}, plan);
    expect((await c.post('/organizations', { name: 'X' })).body.error.code).toBe('limit_exceeded');
    const lic = (await op.get(`/admin/tenants/${c.workspaceId}/license`)).body;
    expect(lic).toMatchObject({ planLimits: { organizations: 0 }, ownLimits: {}, limits: { organizations: 0 } });
    await setLimits(c, { organizations: 5 }, plan);
    expect((await c.post('/organizations', { name: 'X' })).status).toBe(201);
    expect((await setLimits(c, { bogus: 1 } as any)).status).toBe(400);
  });
});

describe('журнал изменений лицензии (1209)', () => {
  test('смена тарифа, срока, лимитов и доп. модулей пишется со старым и новым значением и автором', async () => {
    const c = new Client();
    await c.signup();
    const put = (body: any) => op.put(`/admin/tenants/${c.workspaceId}/license`, body);
    expect((await op.get(`/admin/tenants/${c.workspaceId}/license-log`)).body.items).toEqual([]);
    await put({ planId: corePlan, planExpiresAt: '2030-01-01T00:00:00Z', limits: { members: 3 }, grants: [{ module: 'crm', expiresAt: null }] });
    await put({ planId: corePlan, planExpiresAt: '2031-01-01T00:00:00Z', limits: { members: 5, warehouses: 2 }, grants: [{ module: 'crm', expiresAt: '2030-06-01T00:00:00Z' }, { module: 'money' }] });
    await put({ planId: fullPlan, planExpiresAt: null, limits: {}, grants: [] });
    const items = (await op.get(`/admin/tenants/${c.workspaceId}/license-log`)).body.items as any[];
    const has = (kind: string, subject: string | null, o: unknown, n: unknown) =>
      items.some(i => i.kind === kind && i.subject === subject && JSON.stringify(i.old) === JSON.stringify(o) && JSON.stringify(i.new) === JSON.stringify(n) && i.actorEmail === op.user!.email);
    expect(has('plan', null, 'Полный', 'Только ядро')).toBe(true);
    expect(has('plan', null, 'Только ядро', 'Полный')).toBe(true);
    expect(items.some(i => i.kind === 'plan_expires' && i.old === null && String(i.new).startsWith('2030-01-01'))).toBe(true);
    expect(items.some(i => i.kind === 'plan_expires' && String(i.old).startsWith('2031-01-01') && i.new === null)).toBe(true);
    expect(has('limit', 'members', null, 3)).toBe(true);
    expect(has('limit', 'members', 3, 5)).toBe(true);
    expect(has('limit', 'warehouses', 2, null)).toBe(true);
    expect(items.some(i => i.kind === 'grant_added' && i.subject === 'crm')).toBe(true);
    expect(items.some(i => i.kind === 'grant_added' && i.subject === 'money')).toBe(true);
    expect(items.some(i => i.kind === 'grant_expires' && i.subject === 'crm' && i.old === null && String(i.new).startsWith('2030-06-01'))).toBe(true);
    expect(items.some(i => i.kind === 'grant_removed' && i.subject === 'crm')).toBe(true);
    // без изменений — без записей
    const n = items.length;
    await put({ planId: fullPlan, planExpiresAt: null, limits: {}, grants: [] });
    expect(((await op.get(`/admin/tenants/${c.workspaceId}/license-log`)).body.items as any[]).length).toBe(n);
  });

  test('правка тарифа пишет в журнал арендаторов на этом тарифе', async () => {
    const c = new Client();
    await c.signup();
    const p = await op.post('/admin/plans', { name: 'Журнальный', modules: ['crm'] });
    await op.put(`/admin/tenants/${c.workspaceId}/license`, { planId: p.body.id });
    await op.put(`/admin/plans/${p.body.id}`, { name: 'Журнальный', modules: ['crm', 'trade'], limits: { members: 9 } });
    const items = (await op.get(`/admin/tenants/${c.workspaceId}/license-log`)).body.items as any[];
    expect(items.find(i => i.kind === 'plan_edit' && i.subject === 'modules')).toMatchObject({ old: ['crm'], new: ['crm', 'trade'], context: 'Журнальный' });
    expect(items.find(i => i.kind === 'plan_edit' && i.subject === 'limits')).toMatchObject({ new: { members: 9 } });
  });

  test('журнал виден только оператору и недоступен арендатору', async () => {
    expect((await plain.get(`/admin/tenants/${plain.workspaceId}/license-log`)).status).toBe(403);
    const run = (q: (tx: any) => Promise<any>) =>
      sql.begin(async tx => {
        await tx.unsafe('set local role app_user');
        await tx`select set_config('app.workspace_id', ${op.workspaceId!}, true)`;
        return q(tx);
      });
    expect(await run(tx => tx`select * from license_log`)).toHaveLength(0);
    await expect(run(tx => tx`insert into license_log (workspace_id, kind) values (${op.workspaceId!}, 'plan')`)).rejects.toThrow(/permission denied/);
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
