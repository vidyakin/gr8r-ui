/* Импорт сметы из PDF (фаза 1b): извлечение постраничных таблиц (pdf.ts), двухфазный поток
   (загрузка → ready → выбор страниц и подсказка → POST /:id/extract → задача ИИ → done), распознавание выделенных областей скана,
   права и лимиты. Фикстуры — apps/api/test/fixtures (generate-pdf.ts). */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { llmRuntime } from '../../worker/src/ai/llm';
import { admin, addMember, Client, drainJobs } from './helpers';
import { parsePdfMarkdownRows, readPdfPages } from '../src/pdf';

let owner: Client;
let guest: Client;
let other: Client;
let estimateId: string;

const spec = new Uint8Array(readFileSync(join(import.meta.dir, 'fixtures/estimate-spec.pdf')));
const scanned = new Uint8Array(readFileSync(join(import.meta.dir, 'fixtures/scanned.pdf')));
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

const realConfig = llmRuntime.config;
const realFetch = llmRuntime.fetch;
afterAll(() => {
  llmRuntime.config = realConfig;
  llmRuntime.fetch = realFetch;
});

/** Мок ИИ: запоминает последнее тело запроса и отвечает фиксированной разметкой */
let lastLlmBody: any = null;
function mockLlm(rows: unknown[]) {
  llmRuntime.config = () => ({ baseUrl: 'http://llm.test/v1', apiKey: 'k', model: 'm', timeoutMs: 5000 });
  llmRuntime.fetch = async (_input, init) => {
    lastLlmBody = JSON.parse(String(init?.body ?? '{}'));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ mapping: { name: 1, qty: 4, price: null, section: null, kind: null, unit: null, costPrice: null, laborHours: null }, rows }) } }] }), { status: 200 });
  };
}

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Estimate pdf WS' });
  guest = await addMember(owner, 'guest');
  other = new Client();
  await other.signup({ workspaceName: 'Other pdf WS' });
  const object = await owner.post('/objects', { number: 'OBJ-PDF', name: 'Апарт-отель — электромонтаж' });
  estimateId = (await owner.post(`/objects/${object.body.id}/estimates`, { name: 'Смета из PDF' })).body.id;
});

describe('pdf: извлечение таблиц', () => {
  test('экранированный разделитель внутри ячейки сохраняет число колонок', () => {
    expect(parsePdfMarkdownRows(`| Наименование | Количество |
| --- | --- |
| Кабель A\\|B | 2 |
| Кабель C | 3 |`)).toEqual([
      ['Наименование', 'Количество'], ['Кабель A|B', '2'], ['Кабель C', '3'],
    ]);
  });

  test('цифровой PDF: тип, страницы, теги страниц, числовые строки', async () => {
    const r = await readPdfPages(spec);
    expect(r.pdfType).toBe('TextBased');
    expect(r.pageCount).toBe(3);
    expect(r.pagesNeedingOcr).toEqual([]);
    expect(r.header).toEqual([]); // у PDF заголовок не выделяется: колонки — по ширине строк
    expect(r.rows.length).toBeGreaterThanOrEqual(10);
    expect(r.rowPages).toHaveLength(r.rows.length);
    // титул — одноячеечные строки текста, спецификация — многоячеечные
    expect(r.rows[0]).toEqual(['СПЕЦИФИКАЦИЯ ОБОРУДОВАНИЯ, ИЗДЕЛИЙ И МАТЕРИАЛОВ']);
    const spec2 = r.rows.find(row => row.includes('ЩГ'));
    expect(spec2).toBeDefined();
    expect(r.rowPages[r.rows.indexOf(spec2!)]).toBe(2);
    // числа с пробелами нормализованы
    const cable = r.rows.find(row => row.some(c => c.includes('ВВГнг')));
    expect(cable).toBeDefined();
    expect(cable).toContain('2050');
    expect(cable).toContain('120.50');
    // строка «Итого» тоже извлекается — ИИ помечает её skip
    expect(r.rows.some(row => row.some(c => /Итого/.test(c)))).toBe(true);
  });

  test('скан: Scanned, строк нет', async () => {
    const r = await readPdfPages(scanned);
    expect(r.pdfType).toMatch(/scanned|image/i);
    expect(r.rows).toEqual([]);
    expect(r.pagesNeedingOcr.length).toBeGreaterThan(0);
  });
});

describe('pdf: маршруты импорта сметы', () => {
  test('загрузка PDF → ready с pageCount, задача ИИ не ставится', async () => {
    const res = await owner.post('/estimates/import/document', { fileName: 'spec.pdf', data: b64(spec), estimateId });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'ready', pageCount: 3, pdfType: 'TextBased' });
    const id = res.body.id;
    const status = await owner.get(`/estimates/import/${id}`);
    expect(status.body.status).toBe('ready');
    expect(status.body.meta).toMatchObject({ pageCount: 3, pdfType: 'TextBased' });
    expect(status.body.table.rowPages.length).toBe(status.body.table.rows.length);
    const [job] = await admin`select id from jobs where payload->>'importId' = ${id}`;
    expect(job).toBeUndefined();
    // гость не загружает, чужой арендатор не видит
    expect((await guest.post('/estimates/import/document', { fileName: 'spec.pdf', data: b64(spec) })).status).toBe(403);
    expect((await other.get(`/estimates/import/${id}`)).status).toBe(404);
  });

  test('скан принимает только выделенные области и передаёт изображение модели', async () => {
    const res = await owner.post('/estimates/import/document', { fileName: 'scan.pdf', data: b64(scanned) });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'ready', hasText: false });
    const url = `/estimates/import/${res.body.id}/extract`;
    expect((await owner.post(url, {})).body.error.code).toBe('import_pdf_scanned');
    const image = '/9j/2Q==';
    expect((await owner.post(url, { regions: [{ page: res.body.pageCount + 1, image }] })).status).toBe(422);

    mockLlm([{ rowNo: 1, page: 99, section: null, kind: 'material', name: 'Кабель', unit: 'м', qty: 15, price: 0, costPrice: null, laborHours: null, skip: false, skipReason: null }]);
    const ext = await owner.post(url, { regions: [{ page: 1, image }] });
    expect(ext.status).toBe(202);
    await drainJobs();
    const message = lastLlmBody.messages.find((m: any) => m.role === 'user').content;
    expect(message[1]).toMatchObject({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}` } });
    const status = await owner.get(`/estimates/import/${res.body.id}`);
    expect(status.body.table.rows).toEqual([]);
    expect(status.body.aiResult.rows[0]).toMatchObject({ page: 1, name: 'Кабель', qty: '15' });
    expect(JSON.stringify(status.body)).not.toContain(image);
  });

  test('области разных страниц сохраняют исходные номера, payload очищается', async () => {
    const created = await owner.post('/estimates/import/document', { fileName: 'spec.pdf', data: b64(spec) });
    const id = created.body.id;
    const image = '/9j/2Q==';
    const region = { page: 2, image };
    const url = `/estimates/import/${id}/extract`;
    expect((await guest.post(url, { regions: [region] })).status).toBe(403);
    expect((await other.post(url, { regions: [region] })).status).toBe(404);
    expect((await owner.post(url, { regions: [region], pages: [2] })).status).toBe(400);
    expect((await owner.post(url, { regions: Array(9).fill(region) })).status).toBe(400);
    expect((await owner.post(url, { regions: [{ page: 2, image: 'invalid' }] })).status).toBe(400);
    mockLlm([1, 2].map(page => ({
      rowNo: page, page, section: null, kind: 'material', name: `Материал ${page}`,
      unit: 'шт', qty: page, price: 0, costPrice: null, laborHours: null, skip: false, skipReason: null,
    })));
    expect((await owner.post(url, { regions: [region, { page: 3, image }], hint: 'материалы' })).status).toBe(202);
    await drainJobs();
    const status = await owner.get(`/estimates/import/${id}`);
    expect(status.body.aiResult.rows.map((row: any) => row.page)).toEqual([2, 3]);
    expect(status.body.meta).toMatchObject({ visual: true, selectedPages: [2, 3] });
    const [job] = await admin`select payload from jobs where payload->>'importId' = ${id}`;
    expect(job.payload).toEqual({ importId: id });
    expect(JSON.stringify(lastLlmBody.messages)).toContain('материалы');
    expect(lastLlmBody.messages[1].content.filter((part: any) => part.type === 'image_url')).toHaveLength(2);
  });

  test('extract: фильтр страниц и подсказка уходят в задачу ИИ, разметка с номерами страниц', async () => {
    const res = await owner.post('/estimates/import/document', { fileName: 'spec.pdf', data: b64(spec), estimateId });
    const id = res.body.id;
    mockLlm([
      { rowNo: 2, page: 2, section: 'ЭЛЕКТРОЩИТОВОЕ ОБОРУДОВАНИЕ', kind: 'material', name: 'Щит металлический модульный IP31', unit: 'шт', qty: 207, price: 0, costPrice: null, laborHours: null, skip: false, skipReason: null },
      { rowNo: 3, page: 2, section: 'ЭЛЕКТРОЩИТОВОЕ ОБОРУДОВАНИЕ', kind: 'material', name: 'Щит учетно-распределительный этажный', unit: 'шт', qty: 1, price: 0, costPrice: null, laborHours: null, skip: false, skipReason: null },
    ]);
    const ext = await owner.post(`/estimates/import/${id}/extract`, { pages: [2], hint: 'только щитовое оборудование, итоги пропустить' });
    expect(ext.status).toBe(202);
    expect(ext.body).toMatchObject({ status: 'pending' });
    await drainJobs();
    const status = await owner.get(`/estimates/import/${id}`);
    expect(status.body.status).toBe('done');
    expect(status.body.hint).toBe('только щитовое оборудование, итоги пропустить');
    expect(status.body.meta.selectedPages).toEqual([2]);
    // в задаче остались только строки страницы 2 (титул и стр. 3 отфильтрованы)
    expect(status.body.table.rowPages.every((p: number) => p === 2)).toBe(true);
    // подсказка и номера страниц попали в промпт
    const userMsg = lastLlmBody.messages.find((m: any) => m.role === 'user').content;
    expect(userMsg).toContain('Особые указания пользователя: только щитовое оборудование');
    expect(userMsg).toContain('стр. 2');
    // разметка с page проходит схему и видна в ответе
    expect(status.body.aiResult.rows[0]).toMatchObject({ name: 'Щит металлический модульный IP31', page: 2, kind: 'material', qty: '207' });
    // повторный extract после разметки — 422
    const again = await owner.post(`/estimates/import/${id}/extract`, {});
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('import_not_ready');
    // применение — существующим импортом сметы
    const apply = await owner.post(`/estimates/${estimateId}/import`, { rows: status.body.aiResult.rows.filter((r: any) => !r.skip) });
    expect(apply.status).toBe(200);
    expect(apply.body.itemCount).toBe(2);
  });

  test('extract без страниц — весь документ; гость не запускает', async () => {
    const res = await owner.post('/estimates/import/document', { fileName: 'spec.pdf', data: b64(spec), estimateId });
    mockLlm([{ rowNo: 1, page: 2, section: null, kind: 'material', name: 'ВРУ-1', unit: 'шт', qty: 1, price: 0, costPrice: null, laborHours: null, skip: false, skipReason: null }]);
    expect((await guest.post(`/estimates/import/${res.body.id}/extract`, {})).status).toBe(403);
    const ext = await owner.post(`/estimates/import/${res.body.id}/extract`, {});
    expect(ext.status).toBe(202);
    await drainJobs();
    const status = await owner.get(`/estimates/import/${res.body.id}`);
    expect(status.body.status).toBe('done');
    expect(status.body.meta.selectedPages).toBeNull();
    // страницы из всех страниц: титул тоже в промпте
    expect(status.body.table.rowPages).toContain(1);
    expect(status.body.table.rowPages).toContain(3);
  });

  test('исходный markdown: /source отдаёт страницы, статус его не таскает', async () => {
    const res = await owner.post('/estimates/import/document', { fileName: 'spec.pdf', data: b64(spec), estimateId });
    const src = await owner.get(`/estimates/import/${res.body.id}/source`);
    expect(src.status).toBe(200);
    expect(src.body.pages.length).toBe(3);
    expect(src.body.pages[0]).toMatchObject({ page: 1 });
    expect(src.body.pages[1].markdown).toContain('ЭЛЕКТРОЩИТОВОЕ ОБОРУДОВАНИЕ');
    // статус не раздут источником
    const status = await owner.get(`/estimates/import/${res.body.id}`);
    expect(status.body.source).toBeUndefined();
    expect((await other.get(`/estimates/import/${res.body.id}/source`)).status).toBe(404);
  });

  test('стриминговый ответ ИИ: SSE-дельты склеиваются, разметка проходит', async () => {
    const res = await owner.post('/estimates/import/document', { fileName: 'spec.pdf', data: b64(spec), estimateId });
    await owner.post(`/estimates/import/${res.body.id}/extract`, { pages: [2] });
    llmRuntime.config = () => ({ baseUrl: 'http://llm.test/v1', apiKey: 'k', model: 'm', timeoutMs: 5000 });
    // провайдер отвечает SSE: ответ порезан на дельты — клиент обязан склеить и разобрать JSON
    const payload = JSON.stringify({
      mapping: { name: 1, qty: 4, price: null, section: null, kind: null, unit: null, costPrice: null, laborHours: null },
      rows: [{ rowNo: 2, page: 2, section: 'ЭЛЕКТРОЩИТОВОЕ ОБОРУДОВАНИЕ', kind: 'panel', name: 'ЩГ — щит модульный IP31', unit: 'шт', qty: 207, price: 0, costPrice: null, laborHours: null, skip: false, skipReason: null }],
    });
    const chunks: string[] = [];
    for (let i = 0; i < payload.length; i += 13) chunks.push(payload.slice(i, i + 13));
    const sse = chunks.map(c => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join('') + 'data: [DONE]\n\n';
    llmRuntime.fetch = async () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    await drainJobs();
    const status = await owner.get(`/estimates/import/${res.body.id}`);
    expect(status.body.status).toBe('done');
    expect(status.body.aiError).toBeNull();
    expect(status.body.aiResult.rows[0]).toMatchObject({ name: 'ЩГ — щит модульный IP31', kind: 'panel', qty: '207', page: 2 });
  });

  test('сброс соединения виден при повторе и после последней попытки, повторный запуск один', async () => {
    const created = await owner.post('/estimates/import/document', { fileName: 'spec.pdf', data: b64(spec) });
    const id = created.body.id;
    mockLlm([]);
    llmRuntime.fetch = async () => { throw new Error('ECONNRESET'); };
    await owner.post(`/estimates/import/${id}/extract`, { pages: [2], hint: 'Только материалы' });
    await drainJobs();
    const pending = await owner.get(`/estimates/import/${id}`);
    expect(pending.body.status).toBe('pending');
    expect(pending.body.job).toMatchObject({ status: 'queued', attempt: 1, maxAttempts: 5 });
    expect(pending.body.job.error).toContain('ECONNRESET');
    await admin`update jobs set attempts = 4, run_at = now() where payload->>'importId' = ${id}`;
    await drainJobs();
    const failed = await owner.get(`/estimates/import/${id}`);
    expect(failed.body.status).toBe('done');
    expect(failed.body.aiError).toContain('ECONNRESET');
    expect(failed.body.job).toMatchObject({ status: 'done', attempt: 5 });
    const retried = await Promise.all([owner.post(`/estimates/import/${id}/extract`, {}), owner.post(`/estimates/import/${id}/extract`, {})]);
    expect(retried.map(response => response.status).sort()).toEqual([202, 422]);
    const restarted = await owner.get(`/estimates/import/${id}`);
    expect(restarted.body.aiError).toBeNull();
    expect(restarted.body.status).toBe('pending');
    expect(restarted.body.job.attempt).toBe(0);
    expect(restarted.body.hint).toBe('Только материалы');
    expect(restarted.body.meta.selectedPages).toEqual([2]);
    const [count] = await admin`select count(*)::int as n from jobs where payload->>'importId' = ${id}`;
    expect(count.n).toBe(2);
  });

  test('старый pending с завершившейся задачей показывает ошибку и допускает повтор', async () => {
    const created = await owner.post('/estimates/import/document', { fileName: 'spec.pdf', data: b64(spec) });
    const id = created.body.id;
    await owner.post(`/estimates/import/${id}/extract`, {});
    await admin`update jobs set status = 'failed', attempts = 5, last_error = 'LLM responded 503' where payload->>'importId' = ${id}`;
    const status = await owner.get(`/estimates/import/${id}`);
    expect(status.body.status).toBe('failed');
    expect(status.body.job.error).toBe('LLM responded 503');
    expect((await owner.post(`/estimates/import/${id}/extract`, {})).status).toBe(202);
    expect((await owner.get(`/estimates/import/${id}`)).body.status).toBe('pending');
  });

  test('области можно отправить повторно после ошибки ИИ', async () => {
    const created = await owner.post('/estimates/import/document', { fileName: 'scan.pdf', data: b64(scanned) });
    const id = created.body.id;
    const regions = [{ page: 1, image: '/9j/2Q==' }];
    mockLlm([]);
    llmRuntime.fetch = async () => new Response('', { status: 503 });
    await owner.post(`/estimates/import/${id}/extract`, { regions });
    await admin`update jobs set attempts = 4 where payload->>'importId' = ${id}`;
    await drainJobs();
    const failed = await owner.get(`/estimates/import/${id}`);
    expect(failed.body.aiError).toContain('503');
    expect(failed.body.status).toBe('done');
    expect((await owner.post(`/estimates/import/${id}/extract`, { regions })).status).toBe(202);
    expect((await owner.get(`/estimates/import/${id}`)).body.status).toBe('pending');
  });

  test('файл больше 25 МБ — 422; не-pdf/docx имя — 422', async () => {
    // 25,5 МБ: base64 (~35,6 млн символов) проходит схему, но проверка маршрута MAX_FILE_DOC отклоняет
    const big = Buffer.alloc(Math.floor(25.5 * 1024 * 1024), 1).toString('base64');
    const res = await owner.post('/estimates/import/document', { fileName: 'big.pdf', data: big });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('import_file_invalid');
    const wrong = await owner.post('/estimates/import/document', { fileName: 'spec.txt', data: b64(spec) });
    expect(wrong.status).toBe(422);
  });
});
