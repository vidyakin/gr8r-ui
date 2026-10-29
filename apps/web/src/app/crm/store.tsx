/* Хранилище CRM — reducer + context, по образцу app/data/store.tsx.
   Данные меняются только через dispatch(action); владельцы — id участников основного воркспейса.
   Данные живут на сервере (кэш TanStack Query, коллекции companies / contacts / deals / crmActivities); dispatch — оптимистичные мутации. */
import * as React from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { engineFor, type Domain } from '../data/engine';
import { useSession } from '../data/session';
import type { CollName } from '../data/specs';
import { iso, today } from '../lib/dates';
import { LoadingScreen, uid } from '../data/store';
import { setStageRegistry, stage } from './stages';
import { stageDefs, usePipelines, type PipelinesData } from './pipelines';
import type { ActivityType, Company, Contact, CrmActivity, CrmData, Deal, StageId } from './types';

export type DealPatch = Partial<Pick<Deal, 'name' | 'amount' | 'owner' | 'closeDate' | 'company' | 'contacts' | 'custom' | 'sourceId'>>;
export type NewDeal = Pick<Deal, 'name' | 'company' | 'owner' | 'amount' | 'stage' | 'closeDate'> & Partial<Pick<Deal, 'id' | 'contacts' | 'pipeline'>>;
export type NewActivity = { type: ActivityType; subject: string; by: string; deal?: string; company?: string; contact?: string; due?: string; body?: string };

export type CrmAction =
  | { type: 'deal/create'; deal: NewDeal }
  | { type: 'deal/update'; id: string; patch: DealPatch }
  /** Перенос сделки: stage + before (id карточки, перед которой встаём; null — в конец) либо только порядок внутри колонки */
  /** patch — поля, которые нужны этапу (обязательные): уходят тем же запросом, что и смена этапа. lostReasonId — причина из справочника */
  | { type: 'deal/move'; id: string; stage: StageId; before?: string | null; by: string; lostReasonId?: string; lostReason?: string; patch?: DealPatch }
  | { type: 'deal/delete'; id: string }
  | { type: 'company/create'; company: Pick<Company, 'name' | 'industry' | 'size' | 'owner'> & Partial<Pick<Company, 'id' | 'website' | 'city'>> }
  | { type: 'company/update'; id: string; patch: Partial<Pick<Company, 'name' | 'industry' | 'size' | 'owner' | 'website' | 'city' | 'custom' | 'nextContactDate' | 'nextContactNote'>> }
  | { type: 'contact/create'; contact: Pick<Contact, 'name' | 'company' | 'owner'> & Partial<Pick<Contact, 'id' | 'title' | 'email' | 'phone'>> }
  | { type: 'contact/update'; id: string; patch: Partial<Pick<Contact, 'name' | 'title' | 'email' | 'phone' | 'owner' | 'company' | 'custom'>> }
  | { type: 'activity/add'; activity: NewActivity }
  | { type: 'activity/toggle'; id: string };

const isOpen = (id: StageId) => stage(id).category === 'in_progress';
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
      const closed = !isOpen(x.stage);
      return { ...d, deals: [...d.deals, { ...x, pipeline: stage(x.stage).pipelineId, stageEnteredAt: Date.now(), ...(closed ? { closedAt: x.closeDate } : {}) }] };
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
      const to = stage(a.stage);
      let next: Deal = { ...x, ...a.patch, stage: a.stage, pipeline: to.pipelineId, order };
      if (changed) {
        const closed = to.category !== 'in_progress';
        const day = iso(today());
        next = {
          ...next,
          closedAt: closed ? day : undefined,
          lostReasonId: to.category === 'lost' ? a.lostReasonId : undefined,
          lostReason: to.category === 'lost' ? a.lostReason : undefined,
          closeDate: to.category === 'won' ? day : next.closeDate,
          stageEnteredAt: Date.now(),
        };
      }
      return {
        ...d,
        deals: d.deals.map(y => (y.id === x.id ? next : y)),
        activities: changed ? [systemNote(a.by, x, `Stage changed: ${stage(x.stage).name} → ${to.name}`), ...d.activities] : d.activities,
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

const CRM_DOMAIN: Domain<CrmData> = { companies: 'companies', contacts: 'contacts', deals: 'deals', activities: 'crmActivities' };
const CRM_COLLS = Object.values(CRM_DOMAIN) as CollName[];

const Ctx = React.createContext<{ data: CrmData; dispatch: React.Dispatch<CrmAction>; pipes: PipelinesData } | null>(null);

export function CrmProvider({ children }: { children: React.ReactNode }) {
  const { active } = useSession();
  return active ? <CrmInner key={active.id} ws={active.id}>{children}</CrmInner> : null;
}

function CrmInner({ ws, children }: { ws: string; children: React.ReactNode }) {
  const qc = useQueryClient();
  const engine = engineFor(qc, ws);
  const results = useQueries({ queries: CRM_COLLS.map(name => ({ queryKey: engine.key(name), queryFn: () => engine.fetch(name), staleTime: Infinity, notifyOnChangeProps: 'all' as const })) });
  const [companies, contacts, deals, activities] = results.map(r => r.data) as [CrmData['companies'], CrmData['contacts'], CrmData['deals'], CrmData['activities']];
  // Активности удалённой (архивной) сделки остаются на сервере, но интерфейсу они не нужны
  const data = React.useMemo(() => {
    if (!(companies && contacts && deals && activities)) return null;
    const live = new Set(deals.map(d => d.id));
    return { companies, contacts, deals, activities: activities.filter(a => !a.deal || live.has(a.deal)) };
  }, [companies, contacts, deals, activities]);
  const read = React.useCallback((): CrmData | null => {
    const [c, k, d, a] = CRM_COLLS.map(n => engine.read(n));
    if (!(c && k && d && a)) return null;
    const live = new Set(d.map(x => x.id));
    return { companies: c, contacts: k, deals: d, activities: (a as CrmData['activities']).filter(x => !x.deal || live.has(x.deal)) } as CrmData;
  }, [engine]);
  const dispatch = React.useCallback<React.Dispatch<CrmAction>>(
    a => {
      const before = read();
      if (before) engine.commit(CRM_DOMAIN, before, crmReducer(before, a));
    },
    [engine, read],
  );
  React.useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __crm: unknown }).__crm = { dispatch, read };
  }, [dispatch, read]);
  const pipesQ = usePipelines();
  // реестр этапов выставляется до отрисовки детей: selectors.ts и компоненты читают этапы без props
  if (pipesQ.data) setStageRegistry(stageDefs(pipesQ.data.stages));
  const value = React.useMemo(() => (data && pipesQ.data ? { data, dispatch, pipes: pipesQ.data } : null), [data, dispatch, pipesQ.data]);
  const failed = results.find(r => r.isError) ?? (pipesQ.isError ? pipesQ : undefined);
  if (failed) return <LoadingScreen error={String((failed.error as Error).message)} onRetry={() => { results.forEach(r => void r.refetch()); void pipesQ.refetch(); }} />;
  if (!value) return <LoadingScreen />;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCrm() {
  const c = React.useContext(Ctx);
  if (!c) throw new Error('useCrm() нужно вызывать внутри <CrmProvider>');
  return c;
}

export { uid as newCrmId };
