/* Модули задач: tasks.module и projects.module, системные проекты модулей, правило «задача модуля лежит в проекте того же модуля». */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client, admin } from './helpers';

let c: Client;
let ws: string;
let project: { id: string; key: string };
/** Системный проект модуля (создаётся при регистрации воркспейса) */
let prodProject: { id: string; key: string; module: string };
let servProject: { id: string; key: string; module: string };

const projects = async () => (await admin.unsafe(`select id, key, name, module, sort_order from projects where workspace_id = '${ws}' order by sort_order, key`)) as any[];

beforeAll(async () => {
  c = new Client();
  await c.signup({ workspaceName: 'Modules WS' });
  ws = c.workspaceId!;
  project = await c.project('MOD', 'Ordinary project');
  const list = await projects();
  prodProject = list.find(p => p.module === 'production')!;
  servProject = list.find(p => p.module === 'services')!;
});

describe('module projects', () => {
  test('new workspace gets a system project per module', async () => {
    const list = await projects();
    expect(list.filter(p => p.module === 'production')).toHaveLength(1);
    expect(list.filter(p => p.module === 'services')).toHaveLength(1);
    expect(prodProject).toMatchObject({ key: 'PROD', name: 'Production', module: 'production' });
    expect(servProject).toMatchObject({ key: 'SERV', name: 'Services', module: 'services' });
    // обычный проект — модуля general
    expect(list.find(p => p.id === project.id)!.module).toBe('general');
  });

  test('projects list exposes the module and filters by it', async () => {
    const res = await c.get('/projects');
    expect(res.status).toBe(200);
    const all = res.body.items as any[];
    expect(all.find(p => p.id === project.id)!.module).toBe('general');
    const prod = await c.get('/projects?module=production');
    expect(prod.status).toBe(200);
    expect(prod.body.items).toHaveLength(1);
    expect(prod.body.items[0]).toMatchObject({ key: 'PROD', module: 'production' });
  });
});

describe('task module', () => {
  test('a task inherits the module of its project', async () => {
    const t = await c.post('/tasks', { projectId: project.id, title: 'Ordinary task' });
    expect(t.status).toBe(201);
    expect(t.body.module).toBe('general');

    const p = await c.post('/tasks', { projectId: prodProject.id, title: 'Operation task' });
    expect(p.status).toBe(201);
    expect(p.body.module).toBe('production');
  });

  test('a task of another module than its project is rejected', async () => {
    const res = await c.post('/tasks', { projectId: project.id, title: 'Wrong module', module: 'production' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('module_mismatch');
    const res2 = await c.post('/tasks', { projectId: prodProject.id, title: 'Wrong module', module: 'general' });
    expect(res2.status).toBe(422);
    expect(res2.body.error.code).toBe('module_mismatch');
  });

  test('moving a task to a project of another module changes its module', async () => {
    const t = await c.task(project.id, 'Movable');
    expect(t.module).toBe('general');
    const moved = await c.patch(`/tasks/${t.id}`, { projectId: prodProject.id });
    expect(moved.status).toBe(200);
    expect(moved.body.module).toBe('production');
    expect(moved.body.key).toMatch(/^PROD-\d+$/);

    const back = await c.patch(`/tasks/${t.id}`, { projectId: project.id });
    expect(back.status).toBe(200);
    expect(back.body.module).toBe('general');
  });

  test('patching a task with a foreign module is rejected', async () => {
    const t = await c.task(project.id, 'Patch module');
    const res = await c.patch(`/tasks/${t.id}`, { module: 'services' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('module_mismatch');
  });

  test('task list filters by module', async () => {
    await c.task(project.id, 'General one');
    await c.task(servProject.id, 'Service one');
    const prod = await c.get('/tasks?module=production');
    expect(prod.status).toBe(200);
    expect(prod.body.items.length).toBeGreaterThan(0);
    expect(prod.body.items.every((t: any) => t.module === 'production')).toBe(true);
    const general = await c.get('/tasks?module=general');
    expect(general.body.items.every((t: any) => t.module === 'general')).toBe(true);
    const serv = await c.get('/tasks?module=services');
    const all = await c.get('/tasks');
    expect(all.body.items.length).toBe(prod.body.items.length + general.body.items.length + serv.body.items.length);
  });

  test('existing tasks of a workspace stay visible in ordinary lists', async () => {
    const res = await c.get('/tasks');
    expect(res.status).toBe(200);
    expect(res.body.items.some((t: any) => t.module === 'general')).toBe(true);
    expect(res.body.items.some((t: any) => t.projectId === project.id)).toBe(true);
  });

  test('a module project cannot be deleted or archived', async () => {
    const res = await c.del(`/projects/${prodProject.id}`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('module_project_protected');
    const arch = await c.del(`/projects/${prodProject.id}?hard=true`);
    expect(arch.status).toBe(422);
  });

  test('module is isolated between tenants', async () => {
    const other = new Client();
    await other.signup({ workspaceName: 'Other modules WS' });
    const res = await other.get(`/tasks?projectId=${project.id}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });
});
