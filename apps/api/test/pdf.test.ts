/* PDF печатных форм: задача document.pdf в воркере (headless Chromium), результат в document_files, скачивание через API.
   Тест с настоящим Chromium выполняется, если браузер найден (CHROMIUM_PATH или /opt/pw-browsers). */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { pdfRuntime } from '../../worker/src/handlers';
import { closeBrowser, findChromium } from '../../worker/src/pdf/render';
import { Client, app, drainJobs } from './helpers';

const chromium = findChromium();
const haveChromium = !!chromium && existsSync(chromium);

let owner: Client;
let docId: string;

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'PDF WS' });
  const cp = (await owner.post('/companies', { name: 'ООО «Заказчик»', inn: '7707083893' })).body.id;
  const p = (await owner.post('/products', { name: 'Услуга печати', kind: 'service', unitCode: '876', price: 1000 })).body.id;
  docId = (await owner.post('/documents', { type: 'act', counterpartyId: cp, lines: [{ productId: p, qty: 3, price: 1000 }] })).body.id;
  await owner.post(`/documents/${docId}/post`);
});

afterAll(async () => {
  await closeBrowser();
});

describe('document.pdf job', () => {
  test.skipIf(!haveChromium)('renders a real PDF in headless Chromium and stores it', async () => {
    const r = await owner.post(`/documents/${docId}/pdf`, { form: 'act' });
    expect(r.status).toBe(202);
    await drainJobs();
    const st = await owner.get(`/documents/${docId}/pdf/${r.body.id}`);
    expect(st.body).toMatchObject({ status: 'ready', form: 'act' });
    expect(st.body.size).toBeGreaterThan(2000);
    const res = await app.request(`/documents/${docId}/pdf/${r.body.id}?download=1`, { headers: { cookie: owner.cookie, 'x-workspace-id': owner.workspaceId! } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('.pdf');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBe(st.body.size);
  }, 60_000);

  test('a failing render marks the file as failed with the reason and does not retry blindly', async () => {
    const original = pdfRuntime.render;
    pdfRuntime.render = async () => {
      throw new Error('chromium crashed');
    };
    try {
      const r = await owner.post(`/documents/${docId}/pdf`, { form: 'act' });
      await drainJobs();
      const st = await owner.get(`/documents/${docId}/pdf/${r.body.id}`);
      expect(st.body).toMatchObject({ status: 'failed', error: 'chromium crashed' });
      expect((await owner.get(`/documents/${docId}/pdf/${r.body.id}?download=1`)).body.error.message).toContain('chromium crashed');
    } finally {
      pdfRuntime.render = original;
    }
  });

  test('the S3 store is a stub that says so', async () => {
    const { s3PdfStore, pdfStoreFromEnv, dbPdfStore } = await import('../../worker/src/pdf/storage');
    expect(pdfStoreFromEnv({})).toBe(dbPdfStore);
    expect(pdfStoreFromEnv({ PDF_STORE: 's3' })).toBe(s3PdfStore);
    await expect(s3PdfStore.save(null as never, { id: 'x', workspaceId: 'y' }, new Uint8Array())).rejects.toThrow('not implemented');
  });
});
