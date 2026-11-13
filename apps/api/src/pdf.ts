/* Таблицы и текст из PDF (импорт сметы из документов со сложной структурой): pdf-inspector (Rust/napi,
   async-варианты идут на libuv, event loop свободен) классифицирует документ («цифровой»/«скан»/«смешанный»)
   и даёт постраничный markdown. Таблицы приходят pipe-строками, но часть таблиц (автокадные спецификации)
   распознаётся текстом — поэтому в ИИ уходят и строки таблиц (по ячейкам), и текстовые строки
   (одноячеечные): модель читает их как человек, ревью с галочками страхует ошибки. Каждая строка
   помечается номером страницы (rowPages) — диалог даёт выбрать диапазон страниц до разметки ИИ. */
import { classifyPdfAsync, extractPagesMarkdownAsync } from '@firecrawl/pdf-inspector';
import { normNumber, trimEmptyColumns } from './docx';

/** Лимиты: гигантские тома проектов не разбираем целиком — берите диапазон страниц в диалоге */
export const MAX_PDF_PAGES = 300;
const MAX_ROWS = 20000;
/** Исходный markdown для просмотра: сверх — обрезаем (запросы на разметку это не используют) */
const MAX_SOURCE_CHARS = 2_000_000;

export interface PdfPages {
  pdfType: string;
  pageCount: number;
  /** Страницы без текстового слоя (смешанные документы: часть — скан) */
  pagesNeedingOcr: number[];
  header: string[];
  rows: string[][];
  /** Страница каждой строки (1-based), параллельно rows */
  rowPages: number[];
  /** Исходный markdown постранично — «документ как его видит разбор» (для просмотра в диалоге) */
  pages: { page: number; markdown: string }[];
}

/** Разбор markdown-страницы: pipe-строки → строки ячеек, остальной текст → одноячеечные строки.
    Разметку markdown (заголовки, жирный, подчёркивание) счищаем — ИИ получает чистый текст. */
export function parsePdfMarkdownRows(markdown: string): string[][] {
  const out: string[][] = [];
  for (const line of markdown.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    if (s.startsWith('|')) {
      const cells = s
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split(/(?<!\\)\|/)
        .map(c => normNumber(c.trim().replace(/\\\|/g, '|')));
      // разделитель таблицы |---|---| — не данные
      if (cells.every(c => c === '' || /^:?-+:?$/.test(c))) continue;
      if (cells.some(c => c !== '')) out.push(cells.slice(0, 100));
    } else {
      const text = normNumber(s.replace(/^#+\s*/, '').replace(/\*\*/g, '').replace(/<\/?[a-z]+>/g, '').trim());
      if (text) out.push([text]);
    }
  }
  return out;
}

/** PDF → таблица строк с тегами страниц. Сканы и файлы без текста НЕ ошибка функции — вызывающий
    (маршрут) решает по pdfType/rows; исключение — только битый/зашифрованный файл */
export async function readPdfPages(bytes: Uint8Array): Promise<PdfPages> {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const cls = await classifyPdfAsync(buf);
  const pagesNeedingOcr = cls.pagesNeedingOcr ?? [];
  const empty: PdfPages = { pdfType: cls.pdfType, pageCount: cls.pageCount, pagesNeedingOcr, header: [], rows: [], rowPages: [], pages: [] };
  if (cls.pageCount > MAX_PDF_PAGES || /scanned|image/i.test(cls.pdfType) || cls.pageCount === 0) return empty;
  const { pages } = await extractPagesMarkdownAsync(buf);
  // у автокадных спецификаций шапка приходит текстом над таблицей, поэтому заголовок для PDF
  // не выделяем (пустой): все строки остаются данными, ИИ на заголовок не опирается,
  // а диалог сопоставления строит номера колонок по ширине строк
  const seenText = new Set<string>();
  const rows: string[][] = [];
  const rowPages: number[] = [];
  for (const p of pages) {
    const page = p.page + 1; // библиотека отдаёт страницы с 0
    for (const row of parsePdfMarkdownRows(p.markdown)) {
      // повторяющиеся одноячеечные строки — повторяющиеся шапки и штампы на каждой странице
      if (row.length === 1 && row[0]!.length < 300) {
        if (seenText.has(row[0]!)) continue;
        seenText.add(row[0]!);
      }
      rows.push(row);
      rowPages.push(page);
      if (rows.length >= MAX_ROWS) break;
    }
    if (rows.length >= MAX_ROWS) break;
  }
  // исходный markdown для просмотра «как есть», с общим лимитом
  const source: { page: number; markdown: string }[] = [];
  let sourceChars = 0;
  for (const p of pages) {
    sourceChars += p.markdown.length;
    if (sourceChars > MAX_SOURCE_CHARS) break;
    source.push({ page: p.page + 1, markdown: p.markdown });
  }
  return { pdfType: cls.pdfType, pageCount: cls.pageCount, pagesNeedingOcr, header: [], rows: trimEmptyColumns(rows), rowPages, pages: source };
}
