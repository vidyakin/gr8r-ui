/* Разбор журнала доработок docs/changelog.md для страницы «Что нового»: «## ГГГГ-ММ-ДД» — день, «- **Модуль** — текст» —
   запись (продолжение — строки с отступом). Текст до первого дня (вступление) пропускается. */
export interface ChangelogItem {
  module: string;
  text: string;
}
export interface ChangelogDay {
  date: string;
  items: ChangelogItem[];
}

const DAY = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/;
const ITEM = /^-\s+(.*)$/;
/** «**Каталог** и **Производство** — …»: модуль — всё до тире, без звёздочек */
const SPLIT = /^(.*?)\s+[—–-]\s+(.*)$/;

function toItem(line: string): ChangelogItem {
  const m = SPLIT.exec(line);
  if (!m || !m[1]!.includes('**')) return { module: '', text: line.replace(/\*\*/g, '') };
  return { module: m[1]!.replace(/\*\*/g, '').trim(), text: m[2]!.trim() };
}

export function parseChangelog(raw: string): ChangelogDay[] {
  const days: ChangelogDay[] = [];
  let lines: string[] | null = null;
  const flush = () => {
    if (lines && days.length) days[days.length - 1]!.items.push(toItem(lines.join(' ')));
    lines = null;
  };
  for (const row of raw.split(/\r?\n/)) {
    const day = DAY.exec(row);
    if (day) {
      flush();
      days.push({ date: day[1]!, items: [] });
      continue;
    }
    if (!days.length) continue;
    const item = ITEM.exec(row);
    if (item) {
      flush();
      lines = [item[1]!.trim()];
    } else if (lines && /^\s+\S/.test(row)) lines.push(row.trim());
    else flush();
  }
  flush();
  return days;
}

/** Разбить текст на обычные куски и `код` — для показа без innerHTML */
export const codeParts = (text: string): { code: boolean; s: string }[] =>
  text.split(/(`[^`]+`)/).filter(Boolean).map(s => (s.startsWith('`') && s.endsWith('`') && s.length > 1 ? { code: true, s: s.slice(1, -1) } : { code: false, s }));
