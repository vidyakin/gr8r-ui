/* Разбор шапки статьи (frontmatter) без Node: используют и скрипты docs:check, и приложение, и сайт.
   Формат — docs/user/README.md: `ключ: значение`, списки `[a, b]` или строки `- a`. Других конструкций YAML нет. */

export interface Frontmatter {
  title?: string;
  sections: string[];
  module?: string;
  sources: string[];
  verified?: string;
  screenshots: string[];
}

export interface ParsedHeader {
  fm: Frontmatter;
  /** текст после шапки */
  body: string;
  hasHeader: boolean;
  errors: string[];
}

const unquote = (s: string) => s.trim().replace(/^(['"])(.*)\1$/, '$2');
const LIST_KEYS = ['sections', 'sources', 'screenshots'] as const;
type ListKey = (typeof LIST_KEYS)[number];
const isListKey = (k: string): k is ListKey => (LIST_KEYS as readonly string[]).includes(k);

export function parseHeader(text: string): ParsedHeader {
  const res: ParsedHeader = { fm: { sections: [], sources: [], screenshots: [] }, body: text, hasHeader: false, errors: [] };
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return res;
  res.hasHeader = true;
  res.body = text.slice(m[0].length);
  const known = ['title', 'sections', 'module', 'sources', 'verified', 'screenshots'];
  let key: string | null = null;
  for (const raw of m[1]!.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const item = /^\s+-\s+(.*)$/.exec(raw);
    if (item) {
      if (key && isListKey(key)) res.fm[key].push(unquote(item[1]!));
      else res.errors.push(`лишний элемент списка: «${raw.trim()}»`);
      continue;
    }
    const kv = /^([a-z_]+):\s*(.*)$/.exec(raw);
    if (!kv) {
      res.errors.push(`не разобрана строка шапки: «${raw.trim()}»`);
      continue;
    }
    key = kv[1]!;
    const val = kv[2]!.trim();
    if (!known.includes(key)) {
      res.errors.push(`неизвестное поле шапки «${key}»`);
      key = null;
    } else if (isListKey(key)) {
      if (val.startsWith('[')) {
        if (!val.endsWith(']')) res.errors.push(`список «${key}» не закрыт скобкой`);
        const inner = val.replace(/^\[/, '').replace(/\]$/, '').trim();
        res.fm[key].push(...(inner ? inner.split(',').map(unquote).filter(Boolean) : []));
        key = null;
      } else if (val) res.errors.push(`поле «${key}» — список: [a, b] или строки «- a»`);
    } else if (val) (res.fm as unknown as Record<string, string>)[key] = unquote(val);
  }
  return res;
}
