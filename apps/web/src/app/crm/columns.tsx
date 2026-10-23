/* Описания колонок DataTable для сделок, компаний и контактов (фабрики с t) */
import { Mail } from 'lucide-react';
import type { Column } from '@/components/gr8r/data-table';
type TFunction = (key: any, params?: Record<string, string | number | null | undefined>) => string;
import { ago, fmtDate } from '../lib/dates';
import { isOpen } from './stages';
import { CloseDate, CompanyLink, CompanyLogo, OwnerCell, PersonCell, StageLabel } from './components';
import { money, pct } from './format';
import { sumAmount, sumWeighted, type CompanyRow, type ContactRow, type DealRow } from './selectors';

const dash = <span className="faint">—</span>;
const lastSeen = (t: number | null) => (t ? ago(t) : dash);

export function dealColumns(t: TFunction): Column<DealRow>[] {
  return [
    { id: 'name', header: t('crm.deals.col.deal'), width: 260, value: r => r.name, cell: r => <span className="trunc" style={{ fontWeight: 450 }}>{r.name}</span> },
    { id: 'company', header: t('crm.deals.col.company'), width: 180, value: r => r.companyName, cell: r => <CompanyLink id={r.company} logo /> },
    { id: 'stage', header: t('crm.deals.col.stage'), width: 130, value: r => r.stageIndex, cell: r => <StageLabel stage={r.stage} /> },
    { id: 'amount', header: t('crm.deals.col.amount'), width: 120, align: 'right', value: r => r.amount, cell: r => money(r.amount), total: rs => <b>{money(sumAmount(rs))}</b> },
    { id: 'p', header: t('crm.deals.col.prob'), width: 84, align: 'right', mobile: false, value: r => (isOpen(r.stage) ? r.p : null), cell: r => (isOpen(r.stage) ? pct(r.p) : dash) },
    { id: 'weighted', header: t('crm.deals.col.weighted'), width: 124, align: 'right', mobile: false, value: r => (isOpen(r.stage) ? r.weightedAmount : null), cell: r => (isOpen(r.stage) ? money(r.weightedAmount) : dash), total: rs => <b>{money(sumWeighted(rs))}</b> },
    { id: 'close', header: t('crm.deals.col.close'), width: 118, value: r => r.closeDate, cell: r => <CloseDate deal={r} /> },
    { id: 'owner', header: t('crm.deals.col.owner'), width: 150, value: r => r.ownerName, cell: r => <OwnerCell id={r.owner} /> },
    { id: 'created', header: t('crm.deals.col.created'), width: 112, defaultHidden: true, value: r => r.created, cell: r => <span className="muted num">{fmtDate(new Date(r.created))}</span> },
  ];
}

/** Сортировка в меню Sort страницы сделок — колонки с осмысленным порядком */
export function dealSorts(t: TFunction) {
  const cols = dealColumns(t);
  return ['name', 'company', 'stage', 'amount', 'close', 'owner', 'created'].map(id => ({ id, name: cols.find(c => c.id === id)!.header }));
}

export function companyColumns(t: TFunction): Column<CompanyRow>[] {
  return [
    {
      id: 'name',
      header: t('crm.companies.col.company'),
      width: 270,
      value: r => r.name,
      cell: r => (
        <span className="row" style={{ gap: 8, minWidth: 0 }}>
          <CompanyLogo name={r.name} size={20} />
          <span className="trunc" style={{ fontWeight: 450 }}>{r.name}</span>
          <span className="mono faint trunc hide-m" style={{ fontSize: 11, marginLeft: 'auto' }}>{r.website}</span>
        </span>
      ),
    },
    { id: 'industry', header: t('crm.companies.col.industry'), width: 150, value: r => r.industry },
    { id: 'size', header: t('crm.companies.col.size'), width: 100, mobile: false, value: r => r.size },
    { id: 'owner', header: t('crm.companies.col.owner'), width: 150, value: r => r.ownerName, cell: r => <OwnerCell id={r.owner} /> },
    { id: 'open', header: t('crm.companies.col.open'), width: 104, align: 'right', value: r => r.open, total: rs => <b>{rs.reduce((a, r) => a + r.open, 0)}</b> },
    { id: 'pipeline', header: t('crm.companies.col.pipeline'), width: 124, align: 'right', value: r => r.pipeline, cell: r => (r.pipeline ? money(r.pipeline) : dash), total: rs => <b>{money(rs.reduce((a, r) => a + r.pipeline, 0))}</b> },
    { id: 'contacts', header: t('crm.companies.col.contacts'), width: 90, align: 'right', mobile: false, value: r => r.contacts },
    { id: 'last', header: t('crm.companies.col.last'), width: 126, value: r => r.lastActivity, cell: r => lastSeen(r.lastActivity) },
    { id: 'city', header: t('crm.companies.col.city'), width: 120, defaultHidden: true, value: r => r.city },
  ];
}

export function contactColumns(t: TFunction): Column<ContactRow>[] {
  return [
    { id: 'name', header: t('crm.contacts.col.contact'), width: 230, value: r => r.name, cell: r => <PersonCell name={r.name} /> },
    { id: 'company', header: t('crm.contacts.col.company'), width: 190, value: r => r.companyName, cell: r => <CompanyLink id={r.company} logo /> },
    { id: 'title', header: t('crm.contacts.col.title'), width: 190, value: r => r.title },
    {
      id: 'email',
      header: t('crm.contacts.col.email'),
      width: 250,
      value: r => r.email,
      cell: r => (
        <span className="row muted" style={{ gap: 6, minWidth: 0 }}>
          <Mail size={13} className="faint shrink-0" />
          <span className="trunc">{r.email}</span>
        </span>
      ),
    },
    { id: 'phone', header: t('crm.contacts.col.phone'), width: 160, defaultHidden: true, value: r => r.phone, cell: r => <span className="num muted">{r.phone}</span> },
    { id: 'owner', header: t('crm.contacts.col.owner'), width: 150, value: r => r.ownerName, cell: r => <OwnerCell id={r.owner} /> },
    { id: 'deals', header: t('crm.contacts.col.deals'), width: 80, align: 'right', value: r => r.deals },
    { id: 'last', header: t('crm.contacts.col.last'), width: 126, value: r => r.lastActivity, cell: r => lastSeen(r.lastActivity) },
  ];
}

/** Те же колонки без «Company» — для вкладок страницы компании */
export function dealColumnsInCompany(t: TFunction): Column<DealRow>[] {
  return dealColumns(t).filter(c => c.id !== 'company');
}
export function contactColumnsInCompany(t: TFunction): Column<ContactRow>[] {
  return contactColumns(t).filter(c => c.id !== 'company');
}
