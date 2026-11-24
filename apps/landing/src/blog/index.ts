import type { MarkdownInstance } from 'astro';

export interface BlogFrontmatter {
  slug: string;
  title: string;
  description: string;
  industry: string;
  date: string;
  readTime: string;
  order: number;
  modules: string[];
}

export type BlogArticle = MarkdownInstance<BlogFrontmatter>;

const rawModules = import.meta.glob<BlogArticle>('./ru/*.md', { eager: true });

export function getRuArticles(): BlogArticle[] {
  return Object.values(rawModules).sort(
    (a, b) => (a.frontmatter.order ?? 999) - (b.frontmatter.order ?? 999),
  );
}

export function getRuArticle(slug: string): BlogArticle | undefined {
  return getRuArticles().find(article => article.frontmatter.slug === slug);
}

const RU_MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

export function formatRuDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = RU_MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : iso;
}
