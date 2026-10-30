import { describe, expect, test } from 'bun:test';
import { Client, admin, uniq } from './helpers';

describe('workspaces', () => {
  test('create: creator becomes owner, gets a member profile and default statuses; listed in "mine"', async () => {
    const c = new Client();
    await c.signup({ workspaceName: 'First' });
    const created = await c.post('/workspaces', { name: 'Second one' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Second one', role: 'owner' });
    expect(created.body.slug).toStartWith('second-one-');
    const mine = (await c.get('/workspaces')).body.items;
    expect(mine.map((w: any) => w.name).sort()).toEqual(['First', 'Second one']);
    const statuses = await c.get('/statuses', created.body.id);
    expect(statuses.body.total).toBe(5);
    const members = await c.get('/members', created.body.id);
    expect(members.body.items).toHaveLength(1);
    expect(members.body.items[0]).toMatchObject({ role: 'owner', status: 'active', userId: c.user!.id });
    const ev = await admin.unsafe(`select type from events where workspace_id = '${created.body.id}'`);
    expect(ev.map(e => e.type)).toEqual(['workspace.created']);
  });

  test('slug must be unique and well-formed', async () => {
    const c = new Client();
    await c.signup();
    const slug = `slug-${uniq()}`;
    expect((await c.post('/workspaces', { name: 'A', slug })).status).toBe(201);
    expect((await c.post('/workspaces', { name: 'B', slug })).status).toBe(409);
    expect((await c.post('/workspaces', { name: 'C', slug: 'Bad Slug!' })).status).toBe(400);
  });

  test('invite -> accept flow; token is single-use and bound to the invited email', async () => {
    const owner = new Client();
    await owner.signup({ workspaceName: 'Team' });
    const ws = owner.workspaceId!;
    const friend = new Client();
    await friend.signup();
    const stranger = new Client();
    await stranger.signup();

    const inv = await owner.post(`/workspaces/${ws}/invites`, { email: friend.user!.email, role: 'member' });
    expect(inv.status).toBe(201);
    expect(inv.body.token).toStartWith(ws + '.');
    // в БД хранится только хеш токена
    const row = (await admin.unsafe(`select token_hash from invites where id = '${inv.body.invite.id}'`))[0]!;
    expect(row.token_hash).not.toContain(inv.body.token.split('.')[1]);
    // профиль «invited» виден в списке участников до принятия
    expect((await owner.get('/members')).body.items.some((m: any) => m.email === friend.user!.email && m.status === 'invited')).toBe(true);

    // чужой аккаунт не может принять приглашение
    expect((await stranger.post('/invites/accept', { token: inv.body.token })).status).toBe(403);
    expect((await friend.post('/invites/accept', { token: 'garbage-token-value' })).status).toBe(404);
    const accepted = await friend.post('/invites/accept', { token: inv.body.token });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ id: ws, role: 'member' });
    // повторно — нельзя
    expect((await friend.post('/invites/accept', { token: inv.body.token })).status).toBe(404);

    friend.workspaceId = ws;
    expect((await friend.get('/projects')).status).toBe(200);
    const members = (await owner.get('/members')).body.items;
    expect(members.filter((m: any) => m.email === friend.user!.email)).toHaveLength(1); // профиль привязан, а не продублирован
    expect(members.find((m: any) => m.email === friend.user!.email)).toMatchObject({ status: 'active', userId: friend.user!.id, role: 'member' });
    expect((await friend.get('/auth/me')).body.workspaces.map((w: any) => w.id)).toContain(ws);
  });

  test('only admins invite and change roles; members cannot', async () => {
    const owner = new Client();
    await owner.signup();
    const ws = owner.workspaceId!;
    const member = new Client();
    await member.signup();
    const inv = await owner.post(`/workspaces/${ws}/invites`, { email: member.user!.email, role: 'member' });
    await member.post('/invites/accept', { token: inv.body.token });
    member.workspaceId = ws;
    expect((await member.post(`/workspaces/${ws}/invites`, { email: 'x@test.dev', role: 'guest' })).status).toBe(403);
    expect((await member.get(`/workspaces/${ws}/invites`)).status).toBe(403);
    expect((await member.patch(`/workspaces/${ws}`, { name: 'Hacked' })).status).toBe(403);
    const mid = (await owner.get('/members')).body.items.find((m: any) => m.userId === member.user!.id).id;
    expect((await member.patch(`/workspaces/${ws}/members/${mid}`, { role: 'owner' })).status).toBe(403);
    // inviting an existing active member
    expect((await owner.post(`/workspaces/${ws}/invites`, { email: member.user!.email })).status).toBe(409);
  });

  test('role change updates member profile and membership; promotion to admin grants admin powers', async () => {
    const owner = new Client();
    await owner.signup();
    const ws = owner.workspaceId!;
    const bob = new Client();
    await bob.signup();
    const inv = await owner.post(`/workspaces/${ws}/invites`, { email: bob.user!.email, role: 'member' });
    await bob.post('/invites/accept', { token: inv.body.token });
    bob.workspaceId = ws;
    const bobId = (await owner.get('/members')).body.items.find((m: any) => m.userId === bob.user!.id).id;

    expect((await bob.post('/teams', { key: 'x', name: 'X' })).status).toBe(403);
    const res = await owner.patch(`/workspaces/${ws}/members/${bobId}`, { role: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('admin');
    expect((await admin.unsafe(`select role from memberships where workspace_id = '${ws}' and user_id = '${bob.user!.id}'`))[0]!.role).toBe('admin');
    expect((await bob.post('/teams', { key: 'x', name: 'X' })).status).toBe(201); // права применились сразу
    expect((await bob.get('/auth/me')).body.workspaces.find((w: any) => w.id === ws).role).toBe('admin');
    expect((await admin.unsafe(`select type from events where workspace_id = '${ws}' and type = 'member.role_changed'`)).length).toBe(1);
  });

  test('a workspace cannot be left without an owner; only an owner manages owners', async () => {
    const owner = new Client();
    await owner.signup();
    const ws = owner.workspaceId!;
    const adm = new Client();
    await adm.signup();
    const inv = await owner.post(`/workspaces/${ws}/invites`, { email: adm.user!.email, role: 'admin' });
    await adm.post('/invites/accept', { token: inv.body.token });
    adm.workspaceId = ws;
    const members = (await owner.get('/members')).body.items;
    const ownerId = members.find((m: any) => m.userId === owner.user!.id).id;
    const admId = members.find((m: any) => m.userId === adm.user!.id).id;

    // admin не может ни назначить owner, ни разжаловать owner
    expect((await adm.patch(`/workspaces/${ws}/members/${admId}`, { role: 'owner' })).status).toBe(403);
    expect((await adm.patch(`/workspaces/${ws}/members/${ownerId}`, { role: 'member' })).status).toBe(403);
    // единственного owner разжаловать нельзя
    const last = await owner.patch(`/workspaces/${ws}/members/${ownerId}`, { role: 'admin' });
    expect(last.status).toBe(422);
    expect(last.body.error.code).toBe('last_owner');
    // после назначения второго owner — можно
    expect((await owner.patch(`/workspaces/${ws}/members/${admId}`, { role: 'owner' })).status).toBe(200);
    expect((await owner.patch(`/workspaces/${ws}/members/${ownerId}`, { role: 'admin' })).status).toBe(200);
  });

  test('revoked invites cannot be accepted', async () => {
    const owner = new Client();
    await owner.signup();
    const ws = owner.workspaceId!;
    const friend = new Client();
    await friend.signup();
    const inv = await owner.post(`/workspaces/${ws}/invites`, { email: friend.user!.email });
    expect((await owner.del(`/workspaces/${ws}/invites/${inv.body.invite.id}`)).status).toBe(200);
    expect((await friend.post('/invites/accept', { token: inv.body.token })).status).toBe(404);
  });

  test('workspace details visible to members only', async () => {
    const a = new Client();
    await a.signup({ workspaceName: 'Alpha WS' });
    const b = new Client();
    await b.signup();
    expect((await a.get(`/workspaces/${a.workspaceId}`)).body.name).toBe('Alpha WS');
    expect((await b.get(`/workspaces/${a.workspaceId}`)).status).toBe(403);
    expect((await b.get('/workspaces')).body.items.every((w: any) => w.id !== a.workspaceId)).toBe(true);
  });

  test('удалить воркспейс может только владелец (прямой вызов API)', async () => {
    const owner = new Client();
    await owner.signup();
    const ws = owner.workspaceId!;
    const admin = new Client();
    await admin.signup();
    const inv = await owner.post(`/workspaces/${ws}/invites`, { email: admin.user!.email, role: 'admin' });
    await admin.post('/invites/accept', { token: inv.body.token });
    admin.workspaceId = ws;
    expect((await admin.del(`/workspaces/${ws}`)).status).toBe(403);
    expect((await owner.get(`/workspaces/${ws}`)).status).toBe(200);
    expect((await owner.del(`/workspaces/${ws}`)).status).toBe(200);
  });
});
