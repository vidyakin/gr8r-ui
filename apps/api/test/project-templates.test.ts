/* Шаблоны проектов: сохранить проект как шаблон (сроки «день N от старта», исполнители по должностям, подзадачи),
   создать проект из шаблона с датой старта, список, переименование, флаг «отключён», права и изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let ws: string;
let ownerId: string;
let memberId: string;
let positionId: string;
let projectId: string;
let templateId: string;

const ok = <T,>(r: { status: number; body: T }, status = 200): T => {
  if (r.status !== status) throw new Error(`expected ${status}, got ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Шаблоны проектов WS' });
  ws = owner.workspaceId!;
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${ws}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = ws;
  other = new Client();
  await other.signup({ workspaceName: 'Чужие шаблоны WS' });
  const people = (await owner.get('/members')).body.items as any[];
  ownerId = people.find(m => m.email === owner.user!.email).id;
  memberId = people.find(m => m.email === member.user!.email).id;

  // должность «Дизайнер» у участника member; владелец без должности
  positionId = ok(await owner.post('/positions', { name: 'Дизайнер' }), 201).id;
  ok(await owner.put(`/positions/by-member/${memberId}`, { positionIds: [positionId] }));

  // исходный проект: старт 2026-11-02, срок через 20 дней, веха, три задачи
  projectId = ok(await owner.post('/projects', { key: 'SRC', name: 'Исходный', startDate: '2026-11-02', dueDate: '2026-11-21', milestones: [{ name: 'Бета', date: '2026-11-12' }] }), 201).id;
  ok(
    await owner.post('/tasks', {
      projectId,
      title: 'Макеты',
      status: 'todo',
      assigneeId: memberId,
      priority: 7,
      startDate: '2026-11-02',
      dueDate: '2026-11-06',
      planHours: 8,
      subtasks: [{ id: 's1', title: 'Чек-лист', done: true, assignee: memberId, due: '2026-11-04', subtasks: [{ id: 's2', title: 'Пункт', done: true, subtasks: [] }] }],
    }),
    201,
  );
  ok(await owner.post('/tasks', { projectId, title: 'Запуск', status: 'done', assigneeId: ownerId, dueDate: '2026-11-21' }), 201);
  ok(await owner.post('/tasks', { projectId, title: 'Без сроков' }), 201);
});

describe('шаблоны проектов', () => {
  test('сохранение: задачи, подзадачи, дни от старта, должности; выполненные начинаются заново', async () => {
    const t = ok(await member.post('/project-templates/from-project', { projectId, name: 'Запуск сайта' }), 201);
    templateId = t.id;
    expect(t.taskCount).toBe(3);
    expect(t.subtaskCount).toBe(2);
    expect(t.durationDays).toBe(20);
    expect(t.milestones).toEqual([{ name: 'Бета', day: 11 }]);

    const full = ok(await member.get(`/project-templates/${templateId}`));
    const mockups = full.tasks.find((x: any) => x.title === 'Макеты');
    expect(mockups).toMatchObject({ startDay: 1, dueDay: 5, positionId, priority: 7 });
    expect(mockups.subtasks[0]).toMatchObject({ title: 'Чек-лист', dueDay: 3, positionId });
    expect(mockups.subtasks[0].subtasks[0].title).toBe('Пункт');
    const launch = full.tasks.find((x: any) => x.title === 'Запуск');
    expect(launch.status).toBe('todo'); // done → todo
    expect(launch.positionId).toBeNull(); // у владельца нет должности
    expect(full.tasks.find((x: any) => x.title === 'Без сроков')).toMatchObject({ startDay: null, dueDay: null });
  });

  test('название шаблона уникально; несуществующий проект — 404', async () => {
    expect((await owner.post('/project-templates/from-project', { projectId, name: 'запуск сайта' })).status).toBe(409);
    expect((await owner.post('/project-templates/from-project', { projectId: '00000000-0000-4000-8000-000000000000', name: 'Нет' })).status).toBe(404);
  });

  test('создание проекта: сроки от даты старта, исполнитель по должности, подзадачи не выполнены, новые ключи', async () => {
    const r = ok(await member.post(`/project-templates/${templateId}/create-project`, { name: 'Сайт клиента', startDate: '2027-01-11' }), 201);
    expect(r.taskCount).toBe(3);
    expect(r.project).toMatchObject({ name: 'Сайт клиента', startDate: '2027-01-11', dueDate: '2027-01-30', status: 'planning' });
    expect(r.project.key).toMatch(/^[A-Z][A-Z0-9]{1,9}$/);
    expect(r.project.milestones).toEqual([{ name: 'Бета', date: '2027-01-21' }]);

    const list = ok(await member.get(`/tasks?projectId=${r.project.id}&limit=50`)).items as any[];
    expect(list).toHaveLength(3);
    const mockups = list.find(x => x.title === 'Макеты');
    expect(mockups).toMatchObject({ assigneeId: memberId, startDate: '2027-01-11', dueDate: '2027-01-15', status: 'todo', priority: 7 });
    expect(mockups.key.startsWith(`${r.project.key}-`)).toBe(true);
    expect(mockups.subtasks[0]).toMatchObject({ done: false, assignee: memberId, due: '2027-01-13' });
    expect(mockups.subtasks[0].id).not.toBe('s1');
    expect(mockups.subtasks[0].subtasks[0].done).toBe(false);
    expect(list.find(x => x.title === 'Запуск')).toMatchObject({ assigneeId: null, dueDate: '2027-01-30', status: 'todo' });
  });

  test('должность без активных участников — задача без исполнителя', async () => {
    ok(await owner.patch(`/members/${memberId}`, { status: 'deactivated' }));
    const r = ok(await owner.post(`/project-templates/${templateId}/create-project`, { name: 'Ещё сайт', startDate: '2027-02-01' }), 201);
    const list = ok(await owner.get(`/tasks?projectId=${r.project.id}&limit=50`)).items as any[];
    expect(list.find(x => x.title === 'Макеты').assigneeId).toBeNull();
    ok(await owner.patch(`/members/${memberId}`, { status: 'active' }));
  });

  test('список: переименование и флаг «отключён» только admin; отключённый скрыт из выбора и не создаёт проект', async () => {
    expect((await member.patch(`/project-templates/${templateId}`, { name: 'Взлом' })).status).toBe(403);
    expect((await member.patch(`/project-templates/${templateId}`, { disabled: true })).status).toBe(403);

    const renamed = ok(await owner.patch(`/project-templates/${templateId}`, { name: 'Сайт под ключ', disabled: true }));
    expect(renamed).toMatchObject({ name: 'Сайт под ключ', disabled: true });

    const all = ok(await member.get('/project-templates')).items as any[];
    expect(all.map(x => x.name)).toContain('Сайт под ключ');
    expect(all[0]).toMatchObject({ taskCount: 3, subtaskCount: 2 });
    expect(ok(await member.get('/project-templates?enabled=true')).items).toHaveLength(0);

    const blocked = await member.post(`/project-templates/${templateId}/create-project`, { name: 'Не выйдет', startDate: '2027-03-01' });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('template_disabled');

    ok(await owner.patch(`/project-templates/${templateId}`, { disabled: false }));
    expect(ok(await member.get('/project-templates?enabled=true')).items).toHaveLength(1);
  });

  test('проверка тела: дата старта обязательна, ключ по шаблону', async () => {
    expect((await owner.post(`/project-templates/${templateId}/create-project`, { name: 'Без даты' })).status).toBe(400);
    expect((await owner.post(`/project-templates/${templateId}/create-project`, { name: 'Ключ', startDate: '2027-03-01', key: '1x' })).status).toBe(400);
    const r = ok(await owner.post(`/project-templates/${templateId}/create-project`, { name: 'Свой ключ', startDate: '2027-03-01', key: 'own1' }), 201);
    expect(r.project.key).toBe('OWN1');
  });

  test('изоляция арендаторов и удаление', async () => {
    expect((await other.get('/project-templates')).body.items).toHaveLength(0);
    expect((await other.get(`/project-templates/${templateId}`)).status).toBe(404);
    expect((await other.post(`/project-templates/${templateId}/create-project`, { name: 'Чужой', startDate: '2027-03-01' })).status).toBe(404);

    expect((await member.del(`/project-templates/${templateId}`)).status).toBe(403);
    ok(await owner.del(`/project-templates/${templateId}`));
    expect((await owner.get(`/project-templates/${templateId}`)).status).toBe(404);
    // созданные проекты остаются
    const projects = ok(await owner.get('/projects?limit=50')).items as any[];
    expect(projects.some(p => p.name === 'Сайт клиента')).toBe(true);
  });
});
