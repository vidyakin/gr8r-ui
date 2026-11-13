/* Таблицы из DOCX (импорт сметы из Word-документа): docx — zip с word/document.xml, таблицы
   <w:tbl>/<w:tr>/<w:tc>. Извлекаются только таблицы — картинки и текст вне таблиц отфильтровываются сами.
   Объединённые ячейки: gridSpan — значение в первую колонку, остальные пустые (выравнивание по шапке);
   vMerge — значение протягивается вниз (колонки разделов сметы). Числа «1 234,50» нормализуются:
   десятичная схема API принимает только точку. Формат вывода — как у readXlsx: первая строка заголовок,
   лимиты те же (20 000 строк, 100 колонок), zip-«бомбы» прикрыты в zipRead. */
import { unXml, zipRead } from './xlsx';

const dec = new TextDecoder('utf-8');

/** Таблицы верхнего уровня с подсчётом вложенности (вложенная таблица достаётся вместе с внешней) */
function topLevelTables(xml: string): string[] {
  const out: string[] = [];
  const re = /<w:tbl\b[^>]*>|<\/w:tbl>/g;
  let depth = 0;
  let innerStart = 0;
  for (let m: RegExpExecArray | null; (m = re.exec(xml)); ) {
    if (m[0][1] === '/') {
      depth--;
      if (depth === 0) out.push(xml.slice(innerStart, m.index));
    } else if (depth++ === 0) innerStart = m.index + m[0].length;
  }
  return out;
}

/** Убрать вложенные таблицы (сначала самые внутренние): их строки не смешиваются со строками внешней */
function stripNestedTables(xml: string): string {
  for (let prev = ''; prev !== xml; ) {
    prev = xml;
    xml = xml.replace(/<w:tbl\b[^>]*>(?:(?!<w:tbl\b|<\/w:tbl>)[\s\S])*<\/w:tbl>/g, '');
  }
  return xml;
}

/** «1 234,50» → «1234.50» (неразрывные пробелы тоже): колонки с числами должны проходить схему decimal.
    Общая для docx и pdf (pdf.ts). */
export function normNumber(s: string): string {
  const t = s.replace(/[\u00A0\u202F]/g, ' ').trim();
  if (/[ ,]/.test(t) && /^-?\d[\d ]*(?:[.,]\d+)?$/.test(t)) return t.replace(/ /g, '').replace(',', '.');
  return s;
}

/** Текст ячейки: абзацы через пробел, разорванные прогонами <w:r> фрагменты склеиваются (Word рвёт текст),
   табуляция и перенос строки — пробел */
function cellText(tc: string): string {
  return tc
    .split('</w:p>')
    .map(p => unXml([...p.replace(/<w:(?:tab|br)\b[^>]*\/>/g, ' ').matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m => m[1]).join('')).trim())
    .filter(t => t !== '')
    .join(' ');
}

/** Строки одной таблицы: ячейки по сетке (gridSpan добавляет пустые колонки), vMerge протягивает значение вниз */
function tableRows(tblInner: string): string[][] {
  const rows: string[][] = [];
  const carry: string[] = [];
  for (const rm of tblInner.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)) {
    const row: string[] = [];
    let col = 0;
    for (const cm of (rm[1] ?? '').matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)) {
      if (col >= 100) break;
      const tc = cm[1] ?? '';
      const tcPr = /<w:tcPr\b[^>]*>([\s\S]*?)<\/w:tcPr>/.exec(tc)?.[1] ?? '';
      const text = normNumber(cellText(tc));
      const span = Math.max(1, Number(/<w:gridSpan w:val="(\d+)"/.exec(tcPr)?.[1] ?? 1));
      const vMerge = /<w:vMerge\b/.test(tcPr) && !/w:vMerge w:val="restart"/.test(tcPr);
      // продолжение вертикального объединения: пустая ячейка наследует значение верхней
      row.push(vMerge && text === '' ? (carry[col] ?? '') : text);
      if (!vMerge || text !== '') carry[col] = text;
      for (let s = 1; s < span && col + s < 100; s++) row.push('');
      col += span;
    }
    if (row.some(c => c.trim() !== '')) rows.push(row);
  }
  return rows;
}

/** Строки совпадают с точностью до пробелов и регистра (шапка повторяется на каждой странице) */
export const sameRow = (a: string[], b: string[]) => {
  const norm = (r: string[]) => r.map(c => c.trim().replace(/\s+/g, ' ').toLowerCase());
  const [na, nb] = [norm(a), norm(b)];
  return na.length === nb.length && na.some(c => c !== '') && na.every((c, i) => c === nb[i]);
};

/** Пустые колонки справа не несут данных (gridSpan шапки бывает шире строк) */
export function trimEmptyColumns(rows: string[][]): string[][] {
  let width = 0;
  for (const r of rows) width = Math.max(width, r.length);
  while (width > 0 && rows.every(r => (r[width - 1] ?? '').trim() === '')) width--;
  return rows.map(r => r.slice(0, width));
}

/** Все таблицы документа, склеенные в одну (формат readXlsx): первая строка первой таблицы — заголовок,
    повторы шапки и таблицы-визитки (подписи, реквизиты: <2 строк или <2 колонок) выбрасываются */
export function readDocxTables(bytes: Uint8Array): string[][] {
  const files = zipRead(bytes, name => name === 'word/document.xml');
  const doc = files.get('word/document.xml');
  if (!doc) throw new Error('no word/document.xml');
  const out: string[][] = [];
  let header: string[] | null = null;
  for (const tbl of topLevelTables(dec.decode(doc))) {
    const rows = tableRows(stripNestedTables(tbl));
    if (rows.length < 2 || Math.max(...rows.map(r => r.length)) < 2) continue;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!.slice(0, 100);
      if (header && i === 0 && sameRow(row, header)) continue;
      if (!header) header = row;
      out.push(row);
      if (out.length >= 20000) return trimEmptyColumns(out);
    }
  }
  return trimEmptyColumns(out);
}
