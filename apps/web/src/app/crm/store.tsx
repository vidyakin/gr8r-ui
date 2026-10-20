/* Хранилище CRM — useReducer + context, по образцу app/data/store.tsx.
   Данные меняются только через dispatch(action); владельцы — id участников основного воркспейса. */
import * as React from 'react';
import { iso, today } from '../lib/dates';
import { uid } from '../data/store';
import { seedCrm } from './seed';
import { stage } from './stages';
import type { ActivityType, Company, Contact, CrmActivity, CrmData, Deal, StageId } from './types';

export type DealPatch = Partial<Pick<Deal, 'name' | 'amount' | 'owner' | 'closeDate' | 'company' | 'contacts'>>;
export type NewDeal = Pick<Deal, 'name' | 'company' | 'owner' | 'amount' | 'stage' | 'closeDate'> & Partial<Pick<Deal, 'id' | 'contacts'>>;
export type NewActivity = { type: ActivityType; subject: string; by: string; deal?: string; company?: string; contact?: string; due?: string; body?: string };

export type CrmAction =
  | { type: 'deal/create'; deal: NewDeal }
  | { type: 'deal/update'; id: string; patch: DealPatch }
  /** Перенос сделки: stage + before (id карточки, перед которой встаём; null — в конец) либо только порядок внутри колонки */
  | { type: 'deal/move'; id: string; stage: StageId; before?: string | null; by: string; lostReason?: string }
  | { type: 'deal/delete'; id: string }
  | { type: 'company/create'; company: Pick<Company, 'name' | 'industry' | 'size' | 'owner'> & Partial<Pick<Company, 'id' | 'website' | 'city'>> }
  | { type: 'company/update'; id: string; patch: Partial<Pick<Company, 'name' | 'industry' | 'size' | 'owner' | 'website' | 'city'>> }
  | { type: 'contact/create'; contact: Pick<Contact, 'name' | 'company' | 'owner'> & Partial<Pick<Contact, 'id' | 'title' | 'email' | 'phone'>> }
  | { type: 'contact/update'; id: string; patch: Partial<Pick<Contact, 'name' | 'title' | 'email' | 'phone' | 'owner' | 'company'>> }
  | { type: 'activity/add'; activity: NewActivity }
  | { type: 'activity/toggle'; id: string };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

function systemNote(by: string, deal: Deal, subject: string): CrmActivity {
  return { id: uid('ac'), type: 'note', subject, deal: deal.id, company: deal.company, by, at: Date.now(), system: true };
}

export function crmReducer(d: CrmData, a: CrmAction): CrmData {
  switch (a.type) {
    case 'deal/create': {
      // Новая сделка встаёт в начало своей колонки
      const order = Math.min(1, ...d.deals.filter(x => x.stage === a.deal.stage).map(x => x.order)) - 1;
      const x: Deal = { contacts: [], ...a.deal, id: a.deal.id ?? uid('d'), created: Date.now(), order };
      const closed = x.stage === 'won' || x.stage === 'lost';
      return { ...d, deals: [...d.deals, closed ? { ...x, closedAt: x.closeDate } : x] };
    }
    case 'deal/update':
      return { ...d, deals: d.deals.map(x => (x.id === a.id ? { ...x, ...a.patch } : x)) };
    case 'deal/move': {
      const x = d.deals.find(y => y.id === a.id);
      if (!x) return d;
      // порядок: между соседями в целевой колонке (как в board-view задач)
      const col = d.deals.filter(y => y.stage === a.stage && y.id !== x.id).sort((p, q) => p.order - q.order);
      let order: number;
      if (a.before) {
        const i = col.findIndex(y => y.id === a.before);
        const nx = col[i];
        const prev = col[i - 1];
        order = !nx ? (col.length ? col[col.length - 1].order + 1 : x.order) : prev ? (prev.order + nx.order) / 2 : nx.order - 1;
      } else order = col.length ? col[col.length - 1].order + 1 : x.order;
      const changed = x.stage !== a.stage;
      let next: Deal = { ...x, stage: a.stage, order };
      if (changed) {
        const closed = a.stage === 'won' || a.stage === 'lost';
        const day = iso(today());
        next = { ...next, closedAt: closed ? day : undefined, lostReason: a.stage === 'lost' ? a.lostReason : undefined, closeDate: a.stage === 'won' ? day : next.closeDate };
      }
      return {
        ...d,
        deals: d.deals.map(y => (y.id === x.id ? next : y)),
        activities: changed ? [systemNote(a.by, x, `Stage changed: ${stage(x.stage).name} → ${stage(a.stage).name}${a.lostReason ? ` (${a.lostReason})` : ''}`), ...d.activities] : d.activities,
      };
    }
    case 'deal/delete':
      return { ...d, deals: d.deals.filter(x => x.id !== a.id), activities: d.activities.filter(x => x.deal !== a.id) };
    case 'company/create': {
      const website = a.company.website || `${slug(a.company.name)}.com`;
      const c: Company = { website, city: '', ...a.company, id: a.company.id ?? uid('co'), created: Date.now() };
      return { ...d, companies: [...d.companies, c] };
    }
    case 'company/update':
      return { ...d, companies: d.companies.map(x => (x.id === a.id ? { ...x, ...a.patch } : x)) };
    case 'contact/create': {
      const co = d.companies.find(x => x.id === a.contact.company);
      const first = a.contact.name.toLowerCase().split(/\s+/);
      const email = a.contact.email ?? (co ? `${first[0]}.${first.slice(1).join('')}@${co.website}`.replace(/[^a-z0-9.@-]/g, '') : '');
      const c: Contact = { title: '', phone: '', ...a.contact, email, id: a.contact.id ?? uid('ct'), created: Date.now() };
      return { ...d, contacts: [...d.contacts, c] };
    }
    case 'contact/update':
      return { ...d, contacts: d.contacts.map(x => (x.id === a.id ? { ...x, ...a.patch } : x)) };
    case 'activity/add': {
      const n = a.activity;
      const dl = d.deals.find(x => x.id === n.deal);
      const act: CrmActivity = { ...n, id: uid('ac'), at: Date.now(), company: n.company ?? dl?.company, done: n.type === 'task' ? false : undefined };
      return { ...d, activities: [act, ...d.activities] };
    }
    case 'activity/toggle':
      return { ...d, activities: d.activities.map(x => (x.id === a.id && x.type === 'task' ? { ...x, done: !x.done } : x)) };
  }
}

const Ctx = React.createContext<{ data: CrmData; dispatch: React.Dispatch<CrmAction> } | null>(null);

export function CrmProvider({ children, initial }: { children: React.ReactNode; initial?: CrmData }) {
  const [data, dispatch] = React.useReducer(crmReducer, initial, i => i ?? seedCrm());
  const value = React.useMemo(() => ({ data, dispatch }), [data]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCrm() {
  const c = React.useContext(Ctx);
  if (!c) throw new Error('useCrm() нужно вызывать внутри <CrmProvider>');
  return c;
}

export { uid as newCrmId };
