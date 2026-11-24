import type { MarkdownInstance } from 'astro';
import type { ModuleId } from '../demo/registry';

export interface BlogFrontmatter {
  slug: string;
  title: string;
  seoTitle?: string;
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

const MODULE_KEYWORDS: [ModuleId, string[]][] = [
  ['crm', ['crm']],
  ['production', ['производств', 'добыч', 'карьер', 'распил']],
  ['sales', ['склад', 'торгов', 'закуп', 'продаж', 'парти', 'товар']],
  ['docs', ['документ', 'смет']],
  ['services', ['услуг', 'сервис', 'ремонт', 'заказ-наряд']],
  ['logistics', ['логист', 'транспорт', 'автопарк', 'достав']],
  ['payroll', ['зарплат', 'сдель', 'табел', 'смен']],
  ['automations', ['автоматиз']],
  ['tasks', ['задач', 'объект', 'стройк']],
];

export function resolveModuleId(label: string): ModuleId | null {
  const lower = label.toLowerCase();
  for (const [id, keys] of MODULE_KEYWORDS) {
    if (keys.some(k => lower.includes(k))) return id;
  }
  return null;
}
