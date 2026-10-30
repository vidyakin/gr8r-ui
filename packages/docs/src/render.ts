/* Markdown → HTML для справки в приложении и сайта документации. Санитизация без DOM (работает и в браузере, и в Bun):
   сырой HTML из текста экранируется, ссылки — только http(s), mailto и относительные на статьи, картинки — только из docs/user/img. */
import { Marked, type Tokens } from 'marked';

export interface RenderOptions {
  /** id статьи, из которой рендерим (от неё считаются относительные ссылки), например `finance/payments` */
  from: string;
  /** есть ли такая статья в каталоге */
  hasArticle(id: string): boolean;
  /** адрес перехода к статье (приложение — `#doc:<id>`, сайт — `#/<id>`) */
  linkHref(id: string): string;
  /** адрес картинки по имени файла из docs/user/img; нет файла — undefined */
  imageUrl(name: string): string | undefined;
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Склеивает относительный путь с папкой статьи: `../finance/a.md` из `general/b` → `finance/a.md`. null — вышли за корень */
export function resolveRelative(fromId: string, href: string): string | null {
  const parts = fromId.split('/').slice(0, -1);
  for (const seg of href.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function renderMarkdown(body: string, o: RenderOptions): string {
  const md = new Marked({ gfm: true, breaks: false });
  md.use({
    renderer: {
      // сырой HTML не пропускаем, показываем как текст
      html: ({ text }: Tokens.HTML | Tokens.Tag) => escapeHtml(text),
      link(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, { href, title, tokens }: Tokens.Link) {
        const inner = this.parser.parseInline(tokens as Tokens.Generic[]);
        const ttl = title ? ` title="${escapeHtml(title)}"` : '';
        if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return `<a href="${escapeHtml(href)}"${ttl} target="_blank" rel="noopener noreferrer">${inner}</a>`;
        if (SCHEME.test(href) || href.startsWith('//')) return inner; // javascript:, data: и т. п.
        if (href.startsWith('#')) return inner;
        const path = href.split('#')[0]!;
        const id = resolveRelative(o.from, path)?.replace(/\.md$/, '');
        if (id && path.endsWith('.md') && o.hasArticle(id)) return `<a href="${escapeHtml(o.linkHref(id))}" data-doc="${escapeHtml(id)}"${ttl}>${inner}</a>`;
        return `<span class="doc-broken">${inner}</span>`;
      },
      image({ href, title, text }: Tokens.Image) {
        const rel = SCHEME.test(href) || href.startsWith('//') ? null : resolveRelative(o.from, href);
        const name = rel?.startsWith('img/') ? rel.slice(4) : null;
        const url = name ? o.imageUrl(name) : undefined;
        if (!url) return `<em class="doc-noimg">${escapeHtml(text)}</em>`;
        return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ''} loading="lazy">`;
      },
    },
  });
  return md.parse(body, { async: false });
}

/** Ссылки на статьи внутри markdown (для проверки в тесте): id статьи или null, если не нашлась */
export function articleLinks(body: string, from: string): { href: string; id: string | null }[] {
  const out: { href: string; id: string | null }[] = [];
  for (const m of body.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const href = m[1]!;
    if (SCHEME.test(href) || href.startsWith('#') || href.startsWith('//')) continue;
    const path = href.split('#')[0]!;
    out.push({ href, id: path.endsWith('.md') ? (resolveRelative(from, path)?.replace(/\.md$/, '') ?? null) : null });
  }
  return out;
}
