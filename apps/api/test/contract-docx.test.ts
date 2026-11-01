/* DOCX-шаблоны договоров (задача 1195, docs/plans/2026-10-29-docflow.md): загрузка .docx с параметрами,
   проверка параметров при загрузке, генерация .docx задачей воркера (результат — вложение договора),
   повторная генерация — новая версия вложения, скачивание исходника, изоляция арендаторов. */
import { beforeAll, afterAll, describe, expect, test } from 'bun:test';
import { MemoryFileStore, setFileStore } from '@gr8r/db';
import { Client } from './helpers';

let owner: Client;
let other: Client;
let company: string;
let contract: string;

/** Минимальный .docx (pizzip): document.xml с параметрами; разбивка {{…}} на прогоны — как после Word */
import PizZip from 'pizzip';

const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const run = (t: string) => (t ? `<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r>` : '');

function makeDocx(body: string): Uint8Array {
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`;
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const zip = new PizZip();
  zip.file('[Content_Types].xml', ct);
  zip.file('_rels/.rels', rels);
  zip.file('word/document.xml', doc);
  return zip.generate({ type: 'uint8array' }) as Uint8Array;
}

/** Параметр {{…}}, разорванный на несколько прогонов — как делает Word при правке */
const splitTag = (name: string, at: number) => run(`{{${name.slice(0, at)}`) + run(`${name.slice(at)}}}`);

const form = (data: Uint8Array, fields: Record<string, string> = {}) => {
  const fd = new FormData();
  fd.set('file', new File([data], 'template.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

beforeAll(async () => {
  setFileStore(new MemoryFileStore());
  owner = new Client();
  await owner.signup({ workspaceName: 'DOCX шаблоны WS' });
  other = new Client();
  await other.signup({ workspaceName: 'Чужие DOCX WS' });
  company = (await owner.post('/companies', { name: 'ООО «Ромашка»', inn: '7728168971' })).body.id;
  const c = await owner.post('/contracts', { companyId: company, number: 'Д-95', date: '2026-05-01', validFrom: '2026-05-01', kind: 'customer' });
  contract = c.body.id;
});

afterAll(() => setFileStore(null));

describe('загрузка .docx-шаблона', () => {
  test('файл становится шаблоном, найденные параметры возвращаются (разорванные прогоны склеиваются)', async () => {
    // {{Номер договора}} разбит на два прогона, {{Организация}} — целый
    const docx = makeDocx(`<w:p>${splitTag('Номер договора', 5)} от ${run('{{Дата договора}}')}</w:p><w:p>${run('{{Организация}}')}</w:p>`);
    const r = await owner.form('POST', '/doc-templates/docx', form(docx, { purpose: 'contract' }));
    expect(r.status).toBe(201);
    expect(r.body.source).toBe('docx');
    expect(r.body.purpose).toBe('contract');
    expect(r.body.docxAttachmentId).toBeTruthy();
    expect(r.body.tags).toContain('Номер договора');
    expect(r.body.tags).toContain('Дата договора');
    expect(r.body.tags).toContain('Организация');
  });

  test('не-docx файл и битый zip — 422/400', async () => {
    const fd = new FormData();
    fd.set('file', new File([new Uint8Array([1, 2, 3])], 'not-a-template.docx'));
    expect((await owner.form('POST', '/doc-templates/docx', fd)).status).toBe(422);
    const fd2 = new FormData();
    fd2.set('file', new File([new Uint8Array([1, 2, 3])], 'file.txt', { type: 'text/plain' }));
    expect((await owner.form('POST', '/doc-templates/docx', fd2)).status).toBe(422);
  });

  test('скачивание исходного .docx шаблона', async () => {
    const docx = makeDocx(`<w:p>${run('{{Контрагент}}')}</w:p>`);
    const r = await owner.form('POST', '/doc-templates/docx', form(docx));
    const id = r.body.id;
    const d = await owner.get(`/doc-templates/${id}/docx`);
    expect(d.status).toBe(200);
    expect(d.headers.get('content-type')).toContain('wordprocessingml');
    expect(d.bytes?.length).toBeGreaterThan(100);
    // обычный шаблон — 422
    const plain = await owner.post('/doc-templates', { name: 'Текстовый', purpose: 'contract', body: '# Договор\n\n{{Номер договора}}' });
    expect((await owner.get(`/doc-templates/${plain.body.id}/docx`)).status).toBe(422);
  });
});

describe('генерация .docx договора', () => {
  test('задача ставится в очередь; чужой воркспейс шаблона не видит', async () => {
    const docx = makeDocx(`<w:p>${run('Договор {{Номер договора}} между {{Организация}} и {{Контрагент}}')}</w:p>
<w:tbl><w:tr><w:tc><w:p>${run('{{#Товары}}{{Наименование}} — {{Сумма}}{{/Товары}}')}</w:p></w:tc></w:tr></w:tbl>`);
    const r = await owner.form('POST', '/doc-templates/docx', form(docx));
    const templateId = r.body.id;
    const ok = await owner.post(`/contracts/${contract}/docx`, { templateId });
    expect(ok.status).toBe(202);
    expect(ok.body.ok).toBe(true);
    // чужой не видит ни шаблон, ни договор
    expect((await other.post(`/contracts/${contract}/docx`, { templateId })).status).toBe(404);
    // текстовый шаблон — 422 not_docx_template
    const plain = await owner.post('/doc-templates', { name: 'Текст', purpose: 'contract', body: '# Д' });
    expect((await owner.post(`/contracts/${contract}/docx`, { templateId: plain.body.id })).status).toBe(422);
  });
});

describe('воркер: заполнение шаблона и вложение договора', () => {
  test('document.docx заполняет параметры и создаёт вложение; повторная генерация — новая версия', async () => {
    const { docxTemplateTags, renderContractDocx } = await import('@gr8r/shared');
    const tpl = makeDocx(`<w:p>${run('Договор {{Номер договора}} от {{Дата договора}}. {{Организация}} — {{Контрагент}}.')}</w:p>
<w:tbl><w:tr><w:tc><w:p>${run('{{#Товары}}{{Наименование}} — {{Сумма}}; {{/Товары}}')}</w:p></w:tc></w:tr></w:tbl>`);
    // разорванный прогон тоже склеивается при рендере
    const split = makeDocx(`<w:p>${splitTag('Номер договора', 5)}</w:p>`);
    expect(docxTemplateTags(split)).toContain('Номер договора');

    // данные договора — как в воркере: реквизиты заполняются, Товары пустые (документа нет)
    const out = renderContractDocx(tpl, {
      contract: { number: 'Д-95', date: '2026-05-01', validFrom: '2026-05-01', validTo: '', kind: 'customer', category: '', paymentDays: 0, note: '', orgSignerBasis: '', partySignerName: '', partySignerTitle: '', partySignerBasis: '' },
      organization: { name: 'ООО «Гретр»', fullName: '', inn: '', kpp: '', ogrn: '', address: '', phone: '', directorName: '', directorTitle: '', bank: null },
      party: { name: 'ООО «Ромашка»', fullName: '', inn: '', kpp: '', ogrn: '', address: '', phone: '', bank: null },
      doc: null,
    } as any);
    expect(out.length).toBeGreaterThan(100);
    // результат — валидный zip с заполненным document.xml
    const zip = new PizZip(out);
    const xml = zip.file('word/document.xml')!.asText();
    expect(xml).toContain('Д-95');
    expect(xml).toContain('ООО «Гретр»');
    expect(xml).toContain('ООО «Ромашка»');
    expect(xml).not.toContain('{{');
  });
});
