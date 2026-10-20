/* Выборки CRM — чистые функции над CrmData: воронка, прогноз, статистика компаний, строки таблиц */
import { diffDays, iso, parse, today } from '../lib/dates';
import type { IsoDate } from '../data/types';
import { STAGES, isOpen, stage } from './stages';
import type { ActivityType, Company, Contact, CrmActivity, CrmData, Deal, StageId } from './types';

export const company = (d: CrmData, id?: string | null) => d.companies.find(c => c.id === id);
export const contact = (d: CrmData, id?: string | null) => d.contacts.find(c => c.id === id);
export const deal = (d: CrmData, id?: string | null) => d.deals.find(x => x.id === id);

export const dealsOfCompany = (d: CrmData, companyId: string) => d.deals.filter(x => x.company === companyId);
export const contactsOfCompany = (d: CrmData, companyId: string) => d.contacts.filter(x => x.company === companyId);
export const dealsOfContact = (d: CrmData, contactId: string) => d.deals.filter(x => x.contacts.includes(contactId));

const byTimeDesc = (a: CrmActivity, b: CrmActivity) => b.at - a.at;
export const activitiesOfDeal = (d: CrmData, id: string) => d.activities.filter(a => a.deal === id).sort(byTimeDesc);
export const activitiesOfCompany = (d: CrmData, id: string) => d.activities.filter(a => a.company === id).sort(byTimeDesc);
export const activitiesOfContact = (d: CrmData, id: string) => d.activities.filter(a => a.contact === id).sort(byTimeDesc);

/** Вероятность сделки = вероятность её этапа */
export const probability = (x: Deal) => stage(x.stage).p;
export const weighted = (x: Deal) => (isOpen(x.stage) ? x.amount * probability(x) : 0);
export const sumAmount = (ds: Deal[]) => ds.reduce((a, x) => a + x.amount, 0);
export const sumWeighted = (ds: Deal[]) => ds.reduce((a, x) => a + weighted(x), 0);
export const openDeals = (ds: Deal[]) => ds.filter(x => isOpen(x.stage));

/** Открытая сделка с просроченной датой закрытия */
export const isOverdueDeal = (x: Deal) => isOpen(x.stage) && diffDays(parse(x.closeDate), today()) < 0;

/** Итоги по каждому этапу воронки */
export function stageSummary(ds: Deal[]) {
  return STAGES.map(s => {
    const list = ds.filter(x => x.stage === s.id);
    return { stage: s, count: list.length, amount: sumAmount(list), weighted: sumWeighted(list) };
  });
}

export interface Pipeline {
  count: number;
  amount: number;
  weighted: number;
}
export function pipeline(ds: Deal[]): Pipeline {
  const open = openDeals(ds);
  return { count: open.length, amount: sumAmount(open), weighted: sumWeighted(open) };
}

const monthKey = (date: IsoDate) => date.slice(0, 7);
const thisMonthKey = () => monthKey(iso(today()));

export const wonThisMonth = (ds: Deal[]) => ds.filter(x => x.stage === 'won' && x.closedAt && monthKey(x.closedAt) === thisMonthKey());

/** Доля выигранных среди закрытых (Won / (Won + Lost)) */
export function conversionRate(ds: Deal[]) {
  const won = ds.filter(x => x.stage === 'won').length;
  const closed = won + ds.filter(x => x.stage === 'lost').length;
  return closed ? won / closed : 0;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Выручка выигранных сделок по последним n месяцам (старые → новые) */
export function revenueByMonth(ds: Deal[], n = 6) {
  const t = today();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(t.getFullYear(), t.getMonth() - (n - 1 - i), 1);
    const key = monthKey(iso(d));
    const won = ds.filter(x => x.stage === 'won' && x.closedAt && monthKey(x.closedAt) === key);
    return { key, label: MON[d.getMonth()], amount: sumAmount(won), count: won.length, current: i === n - 1 };
  });
}

export const topDeals = (ds: Deal[], n = 5) => openDeals(ds).sort((a, b) => b.amount - a.amount).slice(0, n);

/** Ближайшие закрытия: открытые сделки по возрастанию даты (просроченные — первыми) */
export const closingSoon = (ds: Deal[], n = 5) => openDeals(ds).sort((a, b) => (a.closeDate > b.closeDate ? 1 : a.closeDate < b.closeDate ? -1 : 0)).slice(0, n);

export function companyStats(d: CrmData, companyId: string) {
  const ds = dealsOfCompany(d, companyId);
  const open = openDeals(ds);
  const won = ds.filter(x => x.stage === 'won');
  const last = d.activities.filter(a => a.company === companyId && !(a.type === 'task' && !a.done && a.at > Date.now())).reduce((m, a) => Math.max(m, a.at), 0);
  return { open: open.length, pipeline: sumAmount(open), won: sumAmount(won), contacts: contactsOfCompany(d, companyId).length, lastActivity: last || null };
}

export function contactStats(d: CrmData, contactId: string) {
  const last = d.activities.filter(a => a.contact === contactId).reduce((m, a) => Math.max(m, a.at), 0);
  return { deals: dealsOfContact(d, contactId).length, lastActivity: last || null };
}

/** Строка таблицы сделок: сделка + производные поля для сортировки и показа */
export interface DealRow extends Deal {
  companyName: string;
  ownerName: string;
  p: number;
  weightedAmount: number;
  stageIndex: number;
}
export function dealRows(d: CrmData, ownerName: (id: string) => string, ds: Deal[] = d.deals): DealRow[] {
  return ds.map(x => ({
    ...x,
    companyName: company(d, x.company)?.name ?? '—',
    ownerName: ownerName(x.owner),
    p: probability(x),
    weightedAmount: weighted(x),
    stageIndex: STAGES.findIndex(s => s.id === x.stage),
  }));
}

export interface DealFilters {
  q: string;
  owner: string[];
  company: string[];
  stage: string[];
}

/** Фильтры вида «Deals»: поиск по названию, компании и контактам + выбранные значения полей */
export function filterDeals(d: CrmData, rows: DealRow[], f: Partial<DealFilters>): DealRow[] {
  const q = f.q?.trim().toLowerCase();
  return rows.filter(r => {
    if (f.owner?.length && !f.owner.includes(r.owner)) return false;
    if (f.company?.length && !f.company.includes(r.company)) return false;
    if (f.stage?.length && !f.stage.includes(r.stage)) return false;
    if (q) {
      const names = r.contacts.map(id => contact(d, id)?.name ?? '').join(' ');
      return `${r.name} ${r.companyName} ${names}`.toLowerCase().includes(q);
    }
    return true;
  });
}

export interface ActivityFilters {
  type: ActivityType | 'all';
  who: string;
}
export const filterActivities = (as: CrmActivity[], f: ActivityFilters) => as.filter(a => !a.system && (f.type === 'all' || a.type === f.type) && (f.who === 'all' || a.by === f.who)).sort(byTimeDesc);

/** Строка таблицы компаний */
export interface CompanyRow extends Company {
  ownerName: string;
  open: number;
  pipeline: number;
  contacts: number;
  lastActivity: number | null;
}
export function companyRows(d: CrmData, ownerName: (id: string) => string): CompanyRow[] {
  return d.companies.map(c => ({ ...c, ownerName: ownerName(c.owner), ...companyStats(d, c.id) }));
}

export interface ContactRow extends Contact {
  companyName: string;
  ownerName: string;
  deals: number;
  lastActivity: number | null;
}
export function contactRows(d: CrmData, ownerName: (id: string) => string): ContactRow[] {
  return d.contacts.map(c => ({ ...c, companyName: company(d, c.company)?.name ?? '—', ownerName: ownerName(c.owner), ...contactStats(d, c.id) }));
}

export type { StageId };
