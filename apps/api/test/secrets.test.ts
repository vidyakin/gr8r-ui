/* Задача 1174а: хранилище секретов — шифрование (AES-256-GCM, AAD), ответы API без значений, права admin+, RLS, readSecret,
   понятная ошибка без SECRETS_KEY. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { decryptSecret, encryptSecret, readSecret, withContext } from '@gr8r/db';
import { Client, admin, sql } from './helpers';

const KEY = 'a'.repeat(64);
let owner: Client;
let member: Client;
let other: Client;
let ws: string;

beforeAll(async () => {
  process.env.SECRETS_KEY = KEY;
  owner = new Client();
  await owner.signup({ workspaceName: 'Секреты WS' });
  ws = owner.workspaceId!;
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${ws}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = ws;
  other = new Client();
  await other.signup({ workspaceName: 'Чужие секреты WS' });
});
afterAll(() => {
  delete process.env.SECRETS_KEY;
});

describe('шифрование', () => {
  test('круг туда-обратно, шифртекст не содержит значения, AAD привязывает к воркспейсу и имени', () => {
    const ct = encryptSecret('ws1', 'k.one', 'top-secret');
    expect(ct.startsWith('v1:')).toBe(true);
    expect(ct).not.toContain('top-secret');
    expect(decryptSecret('ws1', 'k.one', ct)).toBe('top-secret');
    expect(() => decryptSecret('ws2', 'k.one', ct)).toThrow();
    expect(() => decryptSecret('ws1', 'k.two', ct)).toThrow();
    expect(() => decryptSecret('ws1', 'k.one', ct, { SECRETS_KEY: 'b'.repeat(64) })).toThrow();
  });
  test('нет ключа или он неверной длины — 422 secrets_unavailable', () => {
    for (const env of [{}, { SECRETS_KEY: 'abc' }]) {
      try {
        encryptSecret('w', 'k', 'v', env);
        throw new Error('должно упасть');
      } catch (e: any) {
        expect(e.code).toBe('secrets_unavailable');
        expect(e.status).toBe(422);
      }
    }
  });
  test('ключ в base64 тоже принимается', () => {
    const env = { SECRETS_KEY: Buffer.alloc(32, 7).toString('base64') };
    expect(decryptSecret('w', 'k', encryptSecret('w', 'k', 'v', env), env)).toBe('v');
  });
});

describe('API', () => {
  test('записать, заменить, список без значений', async () => {
    expect((await owner.put('/secrets/yookassa.api_key', { value: 'sk_live_123' })).status).toBe(200);
    expect((await owner.put('/secrets/yookassa.api_key', { value: 'sk_live_456' })).status).toBe(200);
    const r = await owner.get('/secrets');
    expect(r.status).toBe(200);
    expect(r.body.available).toBe(true);
    expect(r.body.items.map((s: any) => s.key)).toEqual(['yookassa.api_key']);
    const text = JSON.stringify(r.body);
    expect(text).not.toContain('sk_live');
    expect(text).not.toContain('ciphertext');
    // событие не содержит значения
    const ev = await admin`select payload from events where workspace_id = ${ws} and entity = 'secret'`;
    expect(ev.length).toBe(2);
    expect(JSON.stringify(ev)).not.toContain('sk_live');
  });
  test('в базе лежит шифртекст, readSecret возвращает значение', async () => {
    const [row] = await admin`select ciphertext from workspace_secrets where workspace_id = ${ws}`;
    expect(row!.ciphertext).not.toContain('sk_live');
    const read = (key: string) => withContext(sql, { userId: owner.user!.id, workspaceId: ws }, db => readSecret(db, ws, key), 'app_worker');
    expect(await read('yookassa.api_key')).toBe('sk_live_456');
    expect(await read('nope')).toBeNull();
  });
  test('member не читает и не меняет', async () => {
    expect((await member.get('/secrets')).status).toBe(403);
    expect((await member.put('/secrets/x', { value: 'v' })).status).toBe(403);
    expect((await member.del('/secrets/yookassa.api_key')).status).toBe(403);
  });
  test('плохое имя и пустое значение — 400', async () => {
    expect((await owner.put('/secrets/Bad Key', { value: 'v' })).status).toBe(400);
    expect((await owner.put('/secrets/ok', { value: '' })).status).toBe(400);
  });
  test('изоляция арендаторов: чужой не видит, readSecret чужого имени не находит, под RLS строк нет', async () => {
    expect((await other.get('/secrets')).body.items).toEqual([]);
    expect((await other.del('/secrets/yookassa.api_key')).status).toBe(404);
    const n = await withContext(sql, { userId: other.user!.id, workspaceId: other.workspaceId! }, async (_db, tx) => (await tx`select 1 from workspace_secrets`).length);
    expect(n).toBe(0);
  });
  test('удаление', async () => {
    expect((await owner.del('/secrets/yookassa.api_key')).status).toBe(200);
    expect((await owner.get('/secrets')).body.items).toEqual([]);
    expect((await owner.del('/secrets/yookassa.api_key')).status).toBe(404);
  });
  test('без SECRETS_KEY: available=false, запись 422', async () => {
    delete process.env.SECRETS_KEY;
    expect((await owner.get('/secrets')).body.available).toBe(false);
    const r = await owner.put('/secrets/k', { value: 'v' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('secrets_unavailable');
    process.env.SECRETS_KEY = KEY;
  });
});
