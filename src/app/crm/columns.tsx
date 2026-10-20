/* Описания колонок DataTable для сделок, компаний и контактов */
import { Mail } from 'lucide-react';
import type { Column } from '@/components/gr8r/data-table';
import { ago, fmtDate } from '../lib/dates';
import { isOpen } from './stages';
import { CloseDate, CompanyLink, CompanyLogo, OwnerCell, PersonCell, StageLabel } from './components';
import { money, pct } from './format';
import { sumAmount, sumWeighted, type CompanyRow, type ContactRow, type DealRow } from './selectors';

const dash = <span className="faint">—</span>;
const lastSeen = (t: number | null) => (t ? ago(t) : dash);

export const DEAL_COLUMNS: Column<DealRow>[] = [
  { id: 'name', header: 'Deal', width: 260, value: r => r.name, cell: r => <span className="trunc" style={{ fontWeight: 450 }}>{r.name}</span> },
  { id: 'company', header: 'Company', width: 180, value: r => r.companyName, cell: r => <CompanyLink id={r.company} logo /> },
  { id: 'stage', header: 'Stage', width: 130, value: r => r.stageIndex, cell: r => <StageLabel stage={r.stage} /> },
  { id: 'amount', header: 'Amount', width: 120, align: 'right', value: r => r.amount, cell: r => money(r.amount), total: rs => <b>{money(sumAmount(rs))}</b> },
  { id: 'p', header: 'Prob.', width: 84, align: 'right', mobile: false, value: r => (isOpen(r.stage) ? r.p : null), cell: r => (isOpen(r.stage) ? pct(r.p) : dash) },
  { id: 'weighted', header: 'Weighted', width: 124, align: 'right', mobile: false, value: r => (isOpen(r.stage) ? r.weightedAmount : null), cell: r => (isOpen(r.stage) ? money(r.weightedAmount) : dash), total: rs => <b>{money(sumWeighted(rs))}</b> },
  { id: 'close', header: 'Close date', width: 118, value: r => r.closeDate, cell: r => <CloseDate deal={r} /> },
  { id: 'owner', header: 'Owner', width: 150, value: r => r.ownerName, cell: r => <OwnerCell id={r.owner} /> },
  { id: 'created', header: 'Created', width: 112, defaultHidden: true, value: r => r.created, cell: r => <span className="muted num">{fmtDate(new Date(r.created))}</span> },
];

/** Сортировка в меню Sort страницы сделок — колонки с осмысленным порядком */
export const DEAL_SORTS = ['name', 'company', 'stage', 'amount', 'close', 'owner', 'created'].map(id => ({ id, name: DEAL_COLUMNS.find(c => c.id === id)!.header }));

export const COMPANY_COLUMNS: Column<CompanyRow>[] = [
  {
    id: 'name',
    header: 'Company',
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
  { id: 'industry', header: 'Industry', width: 150, value: r => r.industry },
  { id: 'size', header: 'Size', width: 100, mobile: false, value: r => r.size },
  { id: 'owner', header: 'Owner', width: 150, value: r => r.ownerName, cell: r => <OwnerCell id={r.owner} /> },
  { id: 'open', header: 'Open deals', width: 104, align: 'right', value: r => r.open, total: rs => <b>{rs.reduce((a, r) => a + r.open, 0)}</b> },
  { id: 'pipeline', header: 'In pipeline', width: 124, align: 'right', value: r => r.pipeline, cell: r => (r.pipeline ? money(r.pipeline) : dash), total: rs => <b>{money(rs.reduce((a, r) => a + r.pipeline, 0))}</b> },
  { id: 'contacts', header: 'Contacts', width: 90, align: 'right', mobile: false, value: r => r.contacts },
  { id: 'last', header: 'Last activity', width: 126, value: r => r.lastActivity, cell: r => lastSeen(r.lastActivity) },
  { id: 'city', header: 'City', width: 120, defaultHidden: true, value: r => r.city },
];

export const CONTACT_COLUMNS: Column<ContactRow>[] = [
  { id: 'name', header: 'Contact', width: 230, value: r => r.name, cell: r => <PersonCell name={r.name} /> },
  { id: 'company', header: 'Company', width: 190, value: r => r.companyName, cell: r => <CompanyLink id={r.company} logo /> },
  { id: 'title', header: 'Title', width: 190, value: r => r.title },
  {
    id: 'email',
    header: 'Email',
    width: 250,
    value: r => r.email,
    cell: r => (
      <span className="row muted" style={{ gap: 6, minWidth: 0 }}>
        <Mail size={13} className="faint shrink-0" />
        <span className="trunc">{r.email}</span>
      </span>
    ),
  },
  { id: 'phone', header: 'Phone', width: 160, defaultHidden: true, value: r => r.phone, cell: r => <span className="num muted">{r.phone}</span> },
  { id: 'owner', header: 'Owner', width: 150, value: r => r.ownerName, cell: r => <OwnerCell id={r.owner} /> },
  { id: 'deals', header: 'Deals', width: 80, align: 'right', value: r => r.deals },
  { id: 'last', header: 'Last activity', width: 126, value: r => r.lastActivity, cell: r => lastSeen(r.lastActivity) },
];

/** Те же колонки без «Company» — для вкладок страницы компании */
export const DEAL_COLUMNS_IN_COMPANY = DEAL_COLUMNS.filter(c => c.id !== 'company');
export const CONTACT_COLUMNS_IN_COMPANY = CONTACT_COLUMNS.filter(c => c.id !== 'company');
