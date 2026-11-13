/* Импорт сметы из docx: извлечение таблиц из word/document.xml (объединённые ячейки, повторы шапок, нормализация
   чисел), маршруты /estimates/import/document и /estimates/import/:id и задача воркера estimate.ai_extract —
   без ключа ИИ сразу done без разметки, с моком fetch — разметка строк, 5xx — повтор задачи (fallback фронтенда). */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { llmRuntime } from '../../worker/src/ai/llm';
import { addMember, admin, Client, drainJobs } from './helpers';
import { readDocxTables } from '../src/docx';
import { zipStore } from '../src/xlsx';

let owner: Client;
let guest: Client;
let other: Client;
let estimateId: string;

/* ---------- фикстура docx: минимальный word/document.xml, zip собирается нашим же zipStore ---------- */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const run = (text: string) => `<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const cell = (text: string, props = '') => `<w:tc><w:tcPr>${props}</w:tcPr><w:p>${run(text)}</w:p></w:tc>`;
const row = (...cells: string[]) => `<w:tr>${cells.join('')}</w:tr>`;
const table = (...rows: string[]) => `<w:tbl>${rows.join('')}</w:tbl>`;
const document = (body: string) => `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
const docx = (xml: string) => zipStore([{ name: 'word/document.xml', data: new TextEncoder().encode(xml) }]);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

const HEADER = row(cell('№'), cell('Наименование работ'), cell('Ед.'), cell('Кол-во'), cell('Цена'), cell('Сумма'));
/** Смета: текст вне таблиц, две таблицы с повтором шапки, раздел с gridSpan, числа с пробелами и запятой, подпись */
const SMETA = document(
  `<w:p>${run('УТВЕРЖДАЮ: смета на электромонтаж')}</w:p>` +
    table(
      HEADER,
      // строка-заголовок раздела на всю ширину таблицы
      row(cell('Раздел 1. Электромонтажные работы', '<w:gridSpan w:val="6"/>')),
      row(cell('1'), cell('Монтаж кабеля ВВГнг 3×2,5'), cell('м'), cell('120'), cell('250'), cell('30 000,00')),
      row(cell('2'), cell('Розетка Schneider'), cell('шт'), cell('1 234,50'), cell('12,5'), cell('15431,25')),
    ) +
    // таблица со следующей страницы: шапка повторяется — при склейке выбрасывается
    table(HEADER, row(cell('3'), cell('Щит ЩР-1'), cell('шт'), cell('2'), cell('15 000'), cell('30000'))) +
    // подписи — таблица-визитка из одной строки, отбрасывается
    table(row(cell('Исполнитель'), cell('Заказчик'))),
);

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Estimate docx WS' });
  guest = await addMember(owner, 'guest');
  other = new Client();
  await other.signup({ workspaceName: 'Other docx WS' });
  const object = await owner.post('/objects', { number: 'OBJ-DOCX', name: 'Офис — освещение' });
  estimateId = (await owner.post(`/objects/${object.body.id}/estimates`, { name: 'Смета из Word' })).body.id;
});

afterAll(() => {
  llmRuntime.config = () => null;
  llmRuntime.fetch = (input, init) => fetch(input, init);
});

describe('docx: извлечение таблиц', () => {
  test('таблицы склеиваются, шапки и визитки отбрасываются, числа нормализуются', () => {
    const out = readDocxTables(docx(SMETA));
    expect(out[0]).toEqual(['№', 'Наименование работ', 'Ед.', 'Кол-во', 'Цена', 'Сумма']);
    expect(out).toHaveLength(5); // шапка + раздел + 3 позиции (повтор шапки и подпись выброшены)
    expect(out[1]).toEqual(['Раздел 1. Электромонтажные работы', '', '', '', '', '']);
    expect(out[2]).toEqual(['1', 'Монтаж кабеля ВВГнг 3×2,5', 'м', '120', '250', '30000.00']);
    expect(out[3]).toEqual(['2', 'Розетка Schneider', 'шт', '1234.50', '12.5', '15431.25']);
    expect(out[4]).toEqual(['3', 'Щит ЩР-1', 'шт', '2', '15000', '30000']);
  });

  test('vMerge протягивает значение вниз (колонка раздела)', () => {
    const vm = (val: string) => (val ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>');
    const xml = document(
      table(
        row(cell('Раздел'), cell('Наименование'), cell('Кол-во')),
        row(cell('Раздел 1', vm('x')), cell('Монтаж'), cell('10')),
        row(cell('', vm('')), cell('Прокладка'), cell('20')),
        row(cell('Раздел 2', vm('x')), cell('Проверка'), cell('5')),
      ),
    );
    const out = readDocxTables(docx(xml));
    expect(out).toEqual([
      ['Раздел', 'Наименование', 'Кол-во'],
      ['Раздел 1', 'Монтаж', '10'],
      ['Раздел 1', 'Прокладка', '20'],
      ['Раздел 2', 'Проверка', '5'],
    ]);
  });

  test('битый файл и docx без таблиц дают понятные ошибки/пустой результат', () => {
    expect(() => readDocxTables(new TextEncoder().encode('not a zip'))).toThrow();
    // zip есть, но это не docx — word/document.xml нет
    const notDocx = zipStore([{ name: 'xl/workbook.xml', data: new TextEncoder().encode('<wb/>') }]);
    expect(() => readDocxTables(notDocx)).toThrow('word/document.xml');
    expect(readDocxTables(docx(document(`<w:p>${run('Только текст')}</w:p>`)))).toEqual([]);
  });
});

describe('docx: маршруты импорта сметы', () => {
  test('документ принимается, таблица сохраняется, задача ставится в очередь; правка — member и выше', async () => {
    const res = await owner.post('/estimates/import/document', { fileName: 'смета.docx', data: b64(docx(SMETA)), estimateId });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'pending' });
    const id = res.body.id;
    // чужой арендатор не видит импорт
    expect((await other.get(`/estimates/import/${id}`)).status).toBe(404);
    // гость не загружает и не читает
    expect((await guest.post('/estimates/import/document', { fileName: 'x.docx', data: b64(docx(SMETA)) })).status).toBe(403);
    expect((await guest.get(`/estimates/import/${id}`)).status).toBe(403);
    const status = await owner.get(`/estimates/import/${id}`);
    expect(status.status).toBe(200);
    expect(status.body.status).toBe('pending');
    expect(status.body.table.header[1]).toBe('Наименование работ');
    expect(status.body.table.rows).toHaveLength(4); // без шапки: раздел + 3 позиции
  });

  test('без ключа ИИ задача сразу отвечает done без разметки (fallback на сопоставление колонок)', async () => {
    // форсируем «нет ключа»: в окружении разработчика AI_API_KEY может быть прописан
    const realConfig = llmRuntime.config;
    llmRuntime.config = () => null;
    try {
      const res = await owner.post('/estimates/import/document', { fileName: 'смета.docx', data: b64(docx(SMETA)), estimateId });
      await drainJobs();
      const status = await owner.get(`/estimates/import/${res.body.id}`);
      expect(status.body.status).toBe('done');
      expect(status.body.aiResult).toBeNull();
      expect(status.body.aiError).toContain('AI_API_KEY');
      // повторный прогон задачи ничего не меняет (строка уже не pending)
      await drainJobs();
      expect((await owner.get(`/estimates/import/${res.body.id}`)).body.status).toBe('done');
    } finally {
      llmRuntime.config = realConfig;
    }
  });

  test('с настроенным ИИ задача размечает строки; применение — обычным импортом сметы', async () => {
    const realConfig = llmRuntime.config;
    const realFetch = llmRuntime.fetch;
    llmRuntime.config = () => ({ baseUrl: 'http://llm.test/v1', apiKey: 'k', model: 'm', timeoutMs: 5000 });
    llmRuntime.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  mapping: { name: 1, unit: 2, qty: 3, price: 4, section: null, kind: null, costPrice: null, laborHours: null },
                  rows: [
                    { rowNo: 2, section: 'Раздел 1. Электромонтажные работы', kind: 'work', name: 'Монтаж кабеля ВВГнг 3×2,5', unit: 'м', qty: 120, price: 250, costPrice: null, laborHours: null, skip: false, skipReason: null },
                    { rowNo: 3, section: 'Раздел 1. Электромонтажные работы', kind: 'material', name: 'Розетка Schneider', unit: 'шт', qty: 1234.5, price: 12.5, costPrice: 9.25, laborHours: null, skip: false, skipReason: null },
                    { rowNo: 4, section: null, kind: null, name: 'Щит ЩР-1', unit: null, qty: 2, price: 15000, costPrice: null, laborHours: null, skip: false, skipReason: null },
                    { rowNo: 6, section: null, kind: null, name: 'Итого', unit: null, qty: 0, price: 0, costPrice: null, laborHours: null, skip: true, skipReason: 'служебная строка' },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    try {
      const res = await owner.post('/estimates/import/document', { fileName: 'смета.docx', data: b64(docx(SMETA)), estimateId });
      await drainJobs();
      const status = await owner.get(`/estimates/import/${res.body.id}`);
      expect(status.body.status).toBe('done');
      expect(status.body.aiError).toBeNull();
      const rows = status.body.aiResult.rows;
      expect(rows).toHaveLength(4);
      // числа конвертированы в строки (конвенция API), раздел протянут, служебная строка помечена
      expect(rows[0]).toMatchObject({ name: 'Монтаж кабеля ВВГнг 3×2,5', kind: 'work', qty: '120', price: '250', section: 'Раздел 1. Электромонтажные работы' });
      expect(rows[1]).toMatchObject({ qty: '1234.5', price: '12.5', costPrice: '9.25' });
      expect(rows[3]).toMatchObject({ skip: true, skipReason: 'служебная строка' });
      // применение разметки — существующим импортом сметы
      const apply = await owner.post(`/estimates/${estimateId}/import`, { rows: rows.filter((r: any) => !r.skip) });
      expect(apply.status).toBe(200);
      expect(apply.body.itemCount).toBe(3);
    } finally {
      llmRuntime.config = realConfig;
      llmRuntime.fetch = realFetch;
    }
  });

  test('5xx модели — повтор задачи, импорт остаётся pending', async () => {
    const realConfig = llmRuntime.config;
    const realFetch = llmRuntime.fetch;
    llmRuntime.config = () => ({ baseUrl: 'http://llm.test/v1', apiKey: 'k', model: 'm', timeoutMs: 5000 });
    let calls = 0;
    llmRuntime.fetch = async () => {
      calls++;
      return new Response('boom', { status: 500 });
    };
    let importId = '';
    try {
      const res = await owner.post('/estimates/import/document', { fileName: 'смета.docx', data: b64(docx(SMETA)), estimateId });
      importId = res.body.id;
      await drainJobs();
      const status = await owner.get(`/estimates/import/${importId}`);
      expect(status.body.status).toBe('pending');
      const [job] = await admin`select status, last_error from jobs where payload->>'importId' = ${importId}`;
      expect(job.status).toBe('queued');
      expect(job.last_error).toContain('LLM responded 500');
      expect(calls).toBeGreaterThanOrEqual(1);
    } finally {
      llmRuntime.config = realConfig;
      llmRuntime.fetch = realFetch;
      // подчистка: задача остаётся в очереди с отложенным run_at и иначе «дозревает» к моменту
      // worker-теста при полном прогоне — тот подбирает её через SKIP LOCKED и ломает свой счётчик
      if (importId) await admin`update jobs set status = 'failed', finished_at = now() where payload->>'importId' = ${importId}`;
    }
  });

  test('не-docx имя и битое содержимое — 422 import_file_invalid', async () => {
    expect((await owner.post('/estimates/import/document', { fileName: 'смета.xlsx', data: b64(docx(SMETA)) })).status).toBe(422);
    const broken = await owner.post('/estimates/import/document', { fileName: 'x.docx', data: Buffer.from('garbage').toString('base64') });
    expect(broken.status).toBe(422);
    expect(broken.body.error.code).toBe('import_file_invalid');
    // docx без таблиц — тоже 422 (нет строк данных)
    const empty = await owner.post('/estimates/import/document', { fileName: 'x.docx', data: b64(docx(document(`<w:p>${run('Только текст')}</w:p>`))) });
    expect(empty.status).toBe(422);
  });
});
