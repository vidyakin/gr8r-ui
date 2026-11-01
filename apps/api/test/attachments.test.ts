/* Вложения (задача 1191): версии, лимит файла, квота, права «как у объекта», изоляция арендаторов, архив, сборка мусора. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { collectAttachmentGarbage, drizzleOf, MemoryFileStore, setFileStore, type Tx } from '@gr8r/db';
import { admin, Client } from './helpers';

const store = new MemoryFileStore();
let owner: Client;
let member: Client;
let guest: Client;
let other: Client;
let ws: string;
let companyId: string;

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

function form(fields: Record<string, string>, name = 'a.txt', content = 'hello', type = 'text/plain') {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  f.set('file', new File([content], name, { type }));
  return f;
}
const upload = (c: Client, entityType: string, entityId: string, name = 'a.txt', content = 'hello') => c.form('POST', '/attachments', form({ entityType, entityId }, name, content));

async function join(c: Client, role: 'member' | 'guest') {
  await c.signup();
  const inv = await owner.post(`/workspaces/${ws}/invites`, { email: c.user!.email, role });
  await c.post('/invites/accept', { token: inv.body.token });
  c.workspaceId = ws;
}

beforeAll(async () => {
  setFileStore(store);
  owner = new Client();
  await owner.signup({ workspaceName: 'Файлы WS' });
  ws = owner.workspaceId!;
  member = new Client();
  await join(member, 'member');
  guest = new Client();
  await join(guest, 'guest');
  other = new Client();
  await other.signup({ workspaceName: 'Чужие файлы WS' });
  companyId = (await owner.post('/companies', { name: 'ООО Ромашка' })).body.id;
});

afterAll(() => setFileStore(null));

describe('загрузка, версии, скачивание', () => {
  test('вложение к компании: версия 1, содержимое в сторе, скачивание с именем', async () => {
    const r = await upload(owner, 'company', companyId, 'договор.txt', 'v1 text');
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ entityType: 'company', entityId: companyId, name: 'договор.txt', currentVersion: 1, sizeBytes: 7, versionCount: 1 });
    const dl = await owner.get(`/attachments/${r.body.id}/content`);
    expect(dl.status).toBe(200);
    expect(text(dl.bytes)).toBe('v1 text');
    expect(dl.headers.get('content-disposition')).toContain(encodeURIComponent('договор.txt'));
    // ключ без имени файла: <workspace>/<attachment>/<version>
    expect([...store.objects.keys()]).toContain(`${ws}/${r.body.id}/1`);
  });

  test('новая версия: старая остаётся доступной, в списке текущая; история с автором', async () => {
    const r = await upload(owner, 'company', companyId, 'v.txt', 'one');
    const id = r.body.id;
    const v2 = await member.form('POST', `/attachments/${id}/versions`, form({ comment: 'правки' }, 'v.txt', 'two two'));
    expect(v2.status).toBe(201);
    expect(v2.body.version.version).toBe(2);
    expect(text((await owner.get(`/attachments/${id}/content`)).bytes)).toBe('two two');
    expect(text((await owner.get(`/attachments/${id}/content?version=1`)).bytes)).toBe('one');
    const card = await owner.get(`/attachments/${id}`);
    expect(card.body.versions.map((v: any) => v.version)).toEqual([2, 1]);
    expect(card.body.versions[0]).toMatchObject({ comment: 'правки', hasContent: true });
    const list = await owner.get(`/attachments?entityType=company&entityId=${companyId}`);
    const row = list.body.items.find((x: any) => x.id === id);
    expect(row).toMatchObject({ currentVersion: 2, sizeBytes: 7, versionCount: 2 });
    expect((await owner.get(`/attachments/${id}/content?version=9`)).status).toBe(404);
  });

  test('неизвестный тип и несуществующий объект; гость не загружает', async () => {
    expect((await upload(owner, 'unicorn', companyId)).status).toBe(400);
    expect((await upload(owner, 'company', '018f0000-0000-7000-8000-000000000000')).status).toBe(404);
    expect((await upload(guest, 'company', companyId)).status).toBe(403);
    expect((await guest.get(`/attachments?entityType=company&entityId=${companyId}`)).status).toBe(200);
  });

  test('без настроенного хранилища — 503 storage_unavailable', async () => {
    setFileStore(null);
    const r = await upload(owner, 'company', companyId);
    setFileStore(store);
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('storage_unavailable');
  });
});

describe('лимит файла и квота', () => {
  test('файл больше FILE_MAX_BYTES — 413', async () => {
    process.env.FILE_MAX_BYTES = '100';
    try {
      const r = await upload(owner, 'company', companyId, 'big.bin', 'x'.repeat(500));
      expect(r.status).toBe(413);
      expect(r.body.error.code).toBe('attachment_too_large');
    } finally {
      delete process.env.FILE_MAX_BYTES;
    }
  });

  test('квота воркспейса: 422 storage_quota_exceeded, меняет только owner, null снимает', async () => {
    const u = (await owner.get('/attachments/storage')).body;
    expect(u.maxFileBytes).toBe(50 * 1024 * 1024);
    expect((await member.patch('/attachments/storage', { storageQuotaBytes: 1 })).status).toBe(403);
    const set = await owner.patch('/attachments/storage', { storageQuotaBytes: u.usedBytes + 10 });
    expect(set.body).toMatchObject({ custom: true, quotaBytes: u.usedBytes + 10 });
    const over = await upload(owner, 'company', companyId, 'q.txt', 'x'.repeat(11));
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('storage_quota_exceeded');
    expect((await upload(owner, 'company', companyId, 'q.txt', 'x'.repeat(10))).status).toBe(201);
    expect((await owner.patch('/attachments/storage', { storageQuotaBytes: null })).body.custom).toBe(false);
    expect((await upload(owner, 'company', companyId, 'q2.txt', 'x'.repeat(11))).status).toBe(201);
  });

  test('занятый объём — сумма версий неархивных вложений; архив освобождает место', async () => {
    const before = (await owner.get('/attachments/storage')).body.usedBytes;
    const r = await upload(owner, 'company', companyId, 'u.txt', 'x'.repeat(1000));
    expect((await owner.get('/attachments/storage')).body.usedBytes).toBe(before + 1000);
    await owner.del(`/attachments/${r.body.id}`);
    expect((await owner.get('/attachments/storage')).body.usedBytes).toBe(before);
    expect((await owner.post(`/attachments/${r.body.id}/restore`)).status).toBe(200);
    expect((await owner.get('/attachments/storage')).body.usedBytes).toBe(before + 1000);
  });
});

describe('права как у объекта', () => {
  let projectId: string;
  let taskId: string;
  let fileId: string;

  test('закрытый проект: чужому участнику вложения не видны и недоступны (404)', async () => {
    projectId = (await owner.post('/projects', { key: 'CLS', name: 'Закрытый', access: 'private' })).body.id;
    taskId = (await owner.task(projectId, 'Секретная')).id;
    fileId = (await upload(owner, 'task', taskId, 'secret.txt', 'top secret')).body.id;
    expect((await upload(owner, 'project', projectId, 'p.txt', 'p')).status).toBe(201);
    const listed = await member.get('/attachments?entityTypes=task,project');
    expect(listed.body.items.some((x: any) => x.entityId === taskId || x.entityId === projectId)).toBe(false);
    expect((await member.get(`/attachments/${fileId}`)).status).toBe(404);
    expect((await member.get(`/attachments/${fileId}/content`)).status).toBe(404);
    expect((await upload(member, 'task', taskId)).status).toBe(404);
    expect((await member.form('POST', `/attachments/${fileId}/versions`, form({}))).status).toBe(404);
  });

  test('участник проекта: edit — видит и загружает, view — только читает', async () => {
    const me = (await member.get('/members')).body.items.find((m: any) => m.userId === member.user!.id);
    await owner.patch(`/projects/${projectId}`, { members: [{ memberId: me.id, permission: 'view' }] });
    expect(text((await member.get(`/attachments/${fileId}/content`)).bytes)).toBe('top secret');
    const rows = (await member.get(`/attachments?entityType=task&entityId=${taskId}`)).body.items;
    expect(rows[0].projectId).toBe(projectId);
    expect((await upload(member, 'task', taskId)).status).toBe(403);
    await owner.patch(`/projects/${projectId}`, { members: [{ memberId: me.id, permission: 'edit' }] });
    expect((await upload(member, 'task', taskId, 'm.txt', 'mine')).status).toBe(201);
  });

  test('чужой воркспейс: ни список, ни скачивание, ни загрузка', async () => {
    expect((await other.get(`/attachments/${fileId}`, other.workspaceId)).status).toBe(404);
    expect((await other.get(`/attachments/${fileId}/content`)).status).toBe(404);
    expect((await upload(other, 'company', companyId)).status).toBe(404);
    expect((await other.get(`/attachments?entityType=company&entityId=${companyId}`)).body.items).toEqual([]);
  });

  test('в архив — автор или admin+; удаление объекта архивирует вложения', async () => {
    const mine = (await upload(member, 'company', companyId, 'mine.txt', 'm')).body.id;
    const ownersFile = (await upload(owner, 'company', companyId, 'own.txt', 'o')).body.id;
    expect((await member.del(`/attachments/${ownersFile}`)).status).toBe(403);
    expect((await member.del(`/attachments/${mine}`)).status).toBe(200);
    expect((await owner.del(`/attachments/${ownersFile}`)).status).toBe(200);
    expect((await owner.get(`/attachments?entityType=company&entityId=${companyId}&archived=1`)).body.items.map((x: any) => x.id)).toEqual(expect.arrayContaining([mine, ownersFile]));
    // удаление компании уносит в архив оставшиеся вложения
    const co = (await owner.post('/companies', { name: 'Временная' })).body.id;
    const f = (await upload(owner, 'company', co)).body.id;
    expect((await owner.del(`/companies/${co}`)).status).toBe(200);
    expect((await owner.get(`/attachments?entityType=company&entityId=${co}`)).body.items).toEqual([]);
    expect((await owner.get(`/attachments?entityType=company&entityId=${co}&archived=1`)).body.items.map((x: any) => x.id)).toEqual([f]);
  });

  test('переименование вложения', async () => {
    const id = (await upload(owner, 'company', companyId, 'old.txt')).body.id;
    const r = await owner.patch(`/attachments/${id}`, { name: 'new.pdf' });
    expect(r.body).toMatchObject({ name: 'new.pdf' });
  });
});

/* ---------------- картинки товаров (задача 1192) ---------------- */

describe('картинки товара', () => {
  // настоящий PNG 300x200 — есть что уменьшать до 128px
  const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAASwAAADICAIAAADdvUsCAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAFHElEQVR4nO3VQQ0AQQzDwEVSEMcfQGAdjDwykhE4tfryHRhgIL0QHvsMMJDqKxKhE2TgROgIGLjlb+wT9jdAtiWIsL8Bsi1BhP0NkG0JIuxvgGxLEGF/A2Rbggj7GyDbEkTY3wDZliDC/gbItgQR9jdAtiWIsL8Bsi1BhP0NkG0JIuxvgGxLEGF/A2Rbggj7GyDbEkTY3wDZliDC/gbItgQR9jdAtiWIsL8Bsi1BhP0NkG0JIuxvgGxLEGF/A2Rbggj7GyDbEkTY3wDZliDC/gbItgQR9jdAtiWIsL8Bsi1BhP0NkG0JIuxvgGxLEGF/A2Rbggj7GyDbEkTY3wDZliDC/gbItgQR9jdAtiWIsL8Bsi1BhP0NkG0JIuxvgGxLEGF/A2Rbggj7GyDbEkTY3wDZliDC/gbItgQR9jdAtiWIsL8Bsi1BhP0NkG0JIuxvgGxLEGF/A2Rbggj7GyDbEkTY3wDZliDC/gbItgQR9jdAtiWIsL8Bsi1BhP0NkG0JIuxvgGxLEGF/A2Rbggj7GyDbEkTY3wDZliDC/gbItgQR9jdAtiWIsL8Bsi1BhP0NkG0JIuxvgGxLEGF/A2Rbggj7GyDbEkTY3wDZliDC/gbItgQR9jdAtiWIsL8Bsi1BhP0NkG0JIuxvgGxLEGF/A4wbEGF/A2Rbggj7GyDbEkTY3wDZliDC/gbItgQR9jdAtiWIsL8Bsi1BhP0NkG0JIuxvgGxLEGF/A2Rbggj7GyDbEkTY3wDZliDC/gbItgQR9jdAtiWIsL8Bsi1BhP0NkG0JIuxvgGxLEGF/A2Rbggj7GyDbEkTY3wDZliDC/gbItgQR9jdAtiWIsL8Bsi1BhP0NkG0JIuxvgGxLEGF/A2Rbggj7GyDbEkTY3wDZliDC/gbItgQR9jdAtiWIsL8Bsi1BhP0NkG0JIuxvgGxLEGF/A2Rbggj7GyDbEkTY3wDZliDC/gbItgQR9jdAtiWIsL8Bsi1BhP0NkG0JIuxvgGxLEGF/A2Rbggj7GyDbEkTY3wDZliDC/gbItgQR9jdAtiWIsL8Bsi1BhP0NkG0JIuxvgGxLEGF/A2Rbggj7GyDbEkTY3wDZliDC/gbItgQR9jdAtiWIsL8Bsi1BhP0NkG0JIuxvgGxLEGF/A2Rbggj7GyDbEkTY3wDZliDC/gbItgQR9jdAtiWIsL8Bsi1BhP0NkG0JIuxvgGxLEGF/A2Rbggj7GyDbEkTY3wDZliDC/gbItgQR9jdAtiWIsL8Bsi1BhP0NkG0JIuxvgGxLEGF/A2Rbggj7GyDbEkTY3wDZliDC/gbItgQR9jdAtiWIsL8Bsi1BhP0NkG0JIuxvgGxLEGF/A2Rbggj7GyDbEkTY3wDZliDC/gbItgQR9jdAtiWIsL8Bsi1BhP0NkG0JIuxvgGxLEGF/A2Rbggj7GyDbEkTY3wDZliDC/gbItgQR9jdAtiWIsL8Bsi1BhP0NkG0JIuxvgGxLEGF/A2Rbggj7GyDbEkTY3wDZliDC/gbItgQR9jdAtiWIsL8Bsi1BhP0NkG0JIuxvgGxLEGF/A2Rbggj7GyDbEkTY3wDZliDC/gbItgQR9jfAuAER9jdAtiWIsL8Bsi1BhP0NkG0JIuxvgGxLEGF/A2Rbggj7GyDbEkTY3wDZliDC/gbItgQR9jdAtiWIsL8Bsi1BhP0NkG0JIuxvgGxLEGF/A2Rbggj7GyDbEkTY3wDZliDC/gbItgQR9jdAtiWIsL8Bsi3hB+4XaAEEqPZHAAAAAElFTkSuQmCC'), c => c.charCodeAt(0));
  let productId: string;
  let productId2: string;

  beforeAll(async () => {
    productId = (await owner.post('/products', { name: 'Телефон', sku: 'IMG-1', kind: 'goods', price: 1000, vatRate: 'none' })).body.id;
    productId2 = (await owner.post('/products', { name: 'Чехол', sku: 'IMG-2', kind: 'goods', price: 500, vatRate: 'none' })).body.id;
  });

  function imgForm(entityType: string, entityId: string) {
    const f = new FormData();
    f.set('entityType', entityType);
    f.set('entityId', entityId);
    f.set('file', new File([PNG], 'pic.png', { type: 'image/png' }));
    return f;
  }
  const uploadImg = (c: Client, entityType: string, entityId: string) => c.form('POST', '/attachments', imgForm(entityType, entityId));

  test('первая загруженная картинка становится основной, миниатюра меньше оригинала и кэшируется', async () => {
    const first = await uploadImg(owner, 'product', productId);
    expect(first.status).toBe(201);
    // основная картинка проставилась сама
    const product = (await owner.get(`/products/${productId}`)).body;
    expect(product.imageAttachmentId).toBe(first.body.id);
    // вторая картинка основной не становится
    const second = await uploadImg(owner, 'product', productId);
    expect(second.status).toBe(201);
    expect((await owner.get(`/products/${productId}`)).body.imageAttachmentId).toBe(first.body.id);
    // миниатюра: image/*, меньше оригинала, отдаётся с кэшем на час
    const thumb = await owner.get(`/attachments/${first.body.id}/content?thumb=128`);
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get('content-type')).toBe('image/png');
    expect(thumb.bytes.length).toBeGreaterThan(0);
    expect(thumb.bytes.length).toBeLessThan(PNG.length);
    expect(thumb.headers.get('cache-control')).toBe('private, max-age=3600');
    // ключ миниатюры — рядом с версией: <ws>/<att>/<version>/t128
    expect([...store.objects.keys()]).toContain(`${ws}/${first.body.id}/1/t128`);
    // не-картинке миниатюра не положена
    const txt = await upload(owner, 'product', productId, 'note.txt', 'hello');
    expect((await owner.get(`/attachments/${txt.body.id}/content?thumb=128`)).body.error.code).toBe('not_an_image');
  });

  test('«сделать основной»: PATCH products, чужая или не-картинка — 422', async () => {
    const first = (await owner.get(`/attachments?entityType=product&entityId=${productId}`)).body.items.find((x: any) => (x.mime ?? '').startsWith('image/'));
    const secondImg = (await uploadImg(owner, 'product', productId)).body.id;
    const r = await owner.patch(`/products/${productId}`, { imageAttachmentId: secondImg });
    expect(r.status).toBe(200);
    expect(r.body.imageAttachmentId).toBe(secondImg);
    // обратно
    expect((await owner.patch(`/products/${productId}`, { imageAttachmentId: first.id })).body.imageAttachmentId).toBe(first.id);
    // чужой товар
    const otherProductImg = (await uploadImg(owner, 'product', productId2)).body.id;
    expect((await owner.patch(`/products/${productId}`, { imageAttachmentId: otherProductImg })).status).toBe(422);
    // не-картинка (вложение этого же товара, но text/plain)
    const txt = (await upload(owner, 'product', productId, 'readme.txt', 'hi')).body.id;
    expect((await owner.patch(`/products/${productId}`, { imageAttachmentId: txt })).status).toBe(422);
    // архивная картинка не становится основной
    const archivable = (await uploadImg(owner, 'product', productId)).body.id;
    await owner.del(`/attachments/${archivable}`);
    expect((await owner.patch(`/products/${productId}`, { imageAttachmentId: archivable })).status).toBe(422);
    // сброс: null очищает
    expect((await owner.patch(`/products/${productId2}`, { imageAttachmentId: null })).body.imageAttachmentId).toBeNull();
  });

  test('предпросмотр КП по шаблону с картинками содержит инлайн data:img', async () => {
    // у товара уже есть основная картинка; шаблон с флажком «с картинками»
    const tpl = await owner.post('/doc-templates', { name: 'КП с картинками', body: '# КП {{Номер}}\n\n{{Товары}}', withImages: true });
    expect(tpl.status).toBe(201);
    expect(tpl.body.withImages).toBe(true);
    const companyId = (await owner.post('/companies', { name: 'ООО Картинки' })).body.id;
    const doc = await owner.post('/documents', { type: 'quote', counterpartyId: companyId, lines: [{ productId, qty: '1', price: '1000', vatRate: 'none' }] });
    const html = (await owner.get(`/documents/${doc.body.id}/print/quote?template=${tpl.body.id}`)).body as string;
    // флажок шаблона добавил колонку с картинкой, картинка инлайнится (PDF не ходит в сеть)
    expect(html).toContain('<img');
    expect(html).toContain('src="data:image/png;base64,');
    // без флажка — без картинок
    const tplPlain = await owner.post('/doc-templates', { name: 'КП без картинок', body: '# КП {{Номер}}\n\n{{Товары}}' });
    const html2 = (await owner.get(`/documents/${doc.body.id}/print/quote?template=${tplPlain.body.id}`)).body as string;
    expect(html2).not.toContain('<img');
  });
});

describe('сборка мусора', () => {
  test('удаляет объекты давно архивных вложений и осиротевшие ключи', async () => {
    const r = await upload(owner, 'company', companyId, 'gc.txt', 'gc');
    const id = r.body.id;
    const key = `${ws}/${id}/1`;
    await owner.del(`/attachments/${id}`);
    const runGc = (days: number) => admin.begin(async tx => collectAttachmentGarbage(drizzleOf(tx as unknown as Tx), store, days));
    // свежий архив ещё хранится
    expect((await runGc(30)).archivedObjects).toBe(0);
    expect(store.objects.has(key)).toBe(true);
    await admin`update attachments set archived_at = now() - interval '40 days' where id = ${id}`;
    expect((await runGc(30)).archivedObjects).toBeGreaterThanOrEqual(1);
    expect(store.objects.has(key)).toBe(false);
    expect((await owner.get(`/attachments/${id}/content`)).body.error.code).toBe('file_content_missing');
    // сирота: ключ без строки версии, старше суток
    const orphan = `${ws}/${crypto.randomUUID()}/1`;
    const fresh = `${ws}/${crypto.randomUUID()}/1`;
    const foreign = `${ws}/products/${crypto.randomUUID()}`; // чужой формат ключа (например, картинки товаров) не трогаем
    store.objects.set(orphan, { data: bytes('x'), at: new Date(Date.now() - 2 * 86_400_000) });
    store.objects.set(fresh, { data: bytes('x'), at: new Date() });
    store.objects.set(foreign, { data: bytes('x'), at: new Date(Date.now() - 9 * 86_400_000) });
    expect((await runGc(30)).orphanObjects).toBe(1);
    expect(store.objects.has(orphan)).toBe(false);
    expect(store.objects.has(fresh)).toBe(true);
    expect(store.objects.has(foreign)).toBe(true);
  });
});
