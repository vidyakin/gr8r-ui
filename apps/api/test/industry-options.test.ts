/* Отраслевые опции воркспейса (задача 1258, docs/architecture/industry-options.md): читают все участники,
   меняют owner и admin; значения — только из INDUSTRY_OPTIONS (@gr8r/shared). */
import { describe, expect, test } from 'bun:test';
import { addMember, admin, Client } from './helpers';

describe('отраслевые опции воркспейса', () => {
  test('новый воркспейс создаётся без опций (всё выключено)', async () => {
    const c = new Client();
    const created = await c.signup({ workspaceName: 'Пекарня' });
    expect(created.workspaces[0]).toMatchObject({ industryOptions: [] });
    expect((await c.get('/workspaces')).body.items[0].industryOptions).toEqual([]);
    expect((await c.get(`/workspaces/${c.workspaceId}`)).body.industryOptions).toEqual([]);
    // Создание второго воркспейса тоже без опций: default '{}' не переписывается
    const second = await c.post('/workspaces', { name: 'Ещё один' });
    expect(second.status).toBe(201);
    expect(second.body.industryOptions).toEqual([]);
  });

  test('owner включает опцию: PATCH 200, ответ и списки её отдают', async () => {
    const owner = new Client();
    await owner.signup();
    const ws = owner.workspaceId!;
    const res = await owner.patch(`/workspaces/${ws}`, { industryOptions: ['food'] });
    expect(res.status).toBe(200);
    expect(res.body.industryOptions).toEqual(['food']);
    expect((await owner.get(`/workspaces/${ws}`)).body.industryOptions).toEqual(['food']);
    expect((await owner.get('/workspaces')).body.items.find((w: any) => w.id === ws).industryOptions).toEqual(['food']);
    // Правка другого поля опции не сбрасывает
    expect((await owner.patch(`/workspaces/${ws}`, { name: 'Renamed' })).body.industryOptions).toEqual(['food']);
    // Выключить обратно можно пустым набором
    expect((await owner.patch(`/workspaces/${ws}`, { industryOptions: [] })).body.industryOptions).toEqual([]);
    const events = await admin.unsafe(`select type from events where workspace_id = '${ws}' and type = 'workspace.updated'`);
    expect(events.length).toBeGreaterThanOrEqual(3);
  });

  test('admin тоже может, участник — нет (403)', async () => {
    const owner = new Client();
    await owner.signup();
    const ws = owner.workspaceId!;
    const adminUser = await addMember(owner, 'admin');
    const member = await addMember(owner, 'member');
    expect((await adminUser.patch(`/workspaces/${ws}`, { industryOptions: ['food', 'construction'] })).status).toBe(200);
    expect((await owner.get(`/workspaces/${ws}`)).body.industryOptions).toEqual(['food', 'construction']);
    const denied = await member.patch(`/workspaces/${ws}`, { industryOptions: ['construction'] });
    expect(denied.status).toBe(403);
    expect((await owner.get(`/workspaces/${ws}`)).body.industryOptions).toEqual(['food', 'construction']);
    // участник при этом опции читает (от них зависит вид интерфейса)
    expect((await member.get('/workspaces')).body.items[0].industryOptions).toEqual(['food', 'construction']);
  });

  test('значение не из списка — 400', async () => {
    const owner = new Client();
    await owner.signup();
    const ws = owner.workspaceId!;
    expect((await owner.patch(`/workspaces/${ws}`, { industryOptions: ['space'] })).status).toBe(400);
    expect((await owner.patch(`/workspaces/${ws}`, { industryOptions: 'food' })).status).toBe(400);
    expect((await owner.get(`/workspaces/${ws}`)).body.industryOptions).toEqual([]);
  });
});
