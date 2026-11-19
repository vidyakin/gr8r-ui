/* CRM → Обращения (docs/architecture/cases.md): список и доска по статусам, счётчики «новые / открытые / просрочено»,
   метка SLA, фильтры. Карточка — CaseCard (маршрут /crm/cases/:id открывает её поверх списка). */
import * as React from 'react';
import { useNavigate, useParams } from 'react-router';
import { LifeBuoy, Plus, SquareKanban, Table2 } from 'lucide-react';
import { CASE_CHANNELS, CASE_PRIORITIES, CASE_STATUSES, type CaseStatus } from '@erp/shared';
import { Button, EmptyState, Input, Segmented, Select } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/erp/data-table';
import { Kanban } from '@/components/erp/kanban';
import { fmtDateTime } from '@/i18n/format';
import { useT } from '@/i18n';
import { MemberAvatar } from '../components/workspace';
import { useWorkspace } from '../data/store';
import { useCrm } from '../crm/store';
import { CasePriorityBadge, CaseStatusBadge } from './badges';
import { CaseCard } from './CaseCard';
import { useCases, useCasesApi, useCaseSummary, type CaseRow } from './data';
import { SlaBadge } from './sla';

const ALL = 'all';

export function CasesPage() {
  const t = useT();
  const nav = useNavigate();
  const { id: routeId } = useParams();
  const { data: ws } = useWorkspace();
  const api = useCasesApi();
  const [q, setQ] = React.useState('');
  const [status, setStatus] = React.useState(ALL);
  const [priority, setPriority] = React.useState(ALL);
  const [channel, setChannel] = React.useState(ALL);
  const [owner, setOwner] = React.useState(ALL);
  const [overdue, setOverdue] = React.useState(false);
  const [mode, setMode] = React.useState<'board' | 'table'>('table');
  const [creating, setCreating] = React.useState(false);
  const list = useCases({ q, status: status === ALL ? '' : status, priority: priority === ALL ? '' : priority, channel: channel === ALL ? '' : channel, ownerId: owner === ALL ? '' : owner, overdue });
  const summary = useCaseSummary();
  const rows = list.data ?? [];
  const memberName = (id: string | null) => ws.members.find(m => m.id === id)?.name ?? '';
  const { data: crm } = useCrm();
  const company = (id: string | null) => crm.companies.find(c => c.id === id)?.name ?? '';
  const open = routeId ?? (creating ? 'new' : null);
  const close = () => {
    setCreating(false);
    if (routeId) void nav('/crm/cases');
  };

  const columns = React.useMemo<Column<CaseRow>[]>(
    () => [
      { id: 'number', header: t('cases.col.number'), width: 130, value: r => r.number, cell: r => <span className="num">{r.number}</span> },
      { id: 'subject', header: t('cases.col.subject'), width: 280, value: r => r.subject, cell: r => <span className="trunc" style={{ fontWeight: 450 }}>{r.subject}</span> },
      { id: 'client', header: t('cases.col.client'), width: 190, value: r => company(r.companyId), cell: r => <span className="trunc">{company(r.companyId) || <span className="faint">—</span>}</span> },
      { id: 'status', header: t('cases.col.status'), width: 170, value: r => CASE_STATUSES.indexOf(r.status), cell: r => <CaseStatusBadge status={r.status} /> },
      { id: 'priority', header: t('cases.col.priority'), width: 120, value: r => CASE_PRIORITIES.indexOf(r.priority), cell: r => <CasePriorityBadge priority={r.priority} /> },
      { id: 'sla', header: t('cases.col.sla'), width: 230, value: r => r.resolveDueAt ?? '', cell: r => <SlaBadge c={r} /> },
      { id: 'channel', header: t('cases.col.channel'), width: 130, defaultHidden: true, value: r => r.channel, cell: r => t(`cases.channel.${r.channel}`) },
      {
        id: 'owner',
        header: t('cases.col.owner'),
        width: 170,
        value: r => memberName(r.ownerId),
        cell: r => (r.ownerId ? <span className="row" style={{ gap: 6 }}><MemberAvatar id={r.ownerId} size="sm" />{memberName(r.ownerId)}</span> : <span className="faint">{t('cases.noOwner')}</span>),
      },
      { id: 'created', header: t('cases.col.created'), width: 150, defaultHidden: true, value: r => r.createdAt, cell: r => <span className="muted num">{fmtDateTime(r.createdAt)}</span> },
    ],
    [t, ws.members, crm.companies], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const table = useDataTable(columns);

  const kanbanColumns = CASE_STATUSES.map(s => ({ id: s, name: t(`cases.status.${s}`), title: <CaseStatusBadge status={s} />, subtitle: String(rows.filter(c => c.status === s).length) }));
  const move = async (c: CaseRow, col: string) => {
    if (c.status === 'closed' || col === c.status) return;
    await api('PATCH', `/cases/${c.id}`, { status: col as CaseStatus });
  };

  const counters: { key: 'new' | 'open' | 'overdue'; value: number | undefined; onClick: () => void; active: boolean }[] = [
    { key: 'new', value: summary.data?.new, onClick: () => { setStatus(status === 'new' ? ALL : 'new'); setOverdue(false); }, active: status === 'new' },
    { key: 'open', value: summary.data?.open, onClick: () => { setStatus(ALL); setOverdue(false); }, active: false },
    { key: 'overdue', value: summary.data?.overdue, onClick: () => { setOverdue(!overdue); setStatus(ALL); }, active: overdue },
  ];
  const noFilters = !q && status === ALL && priority === ALL && channel === ALL && owner === ALL && !overdue;

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('cases.title')}</h1>
          <p>{t('cases.summary', { count: list.data?.length ?? 0 })}</p>
        </div>
        <div className="acts">
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={14} />
            {t('cases.newCase')}
          </Button>
        </div>
      </div>
      <div className="row" style={{ gap: 8, padding: '0 var(--page-pad, 24px) 12px', flexWrap: 'wrap' }}>
        {counters.map(c => (
          <button key={c.key} className={`chip${c.active ? ' on' : ''}`} onClick={c.onClick} aria-pressed={c.active} style={c.key === 'overdue' && (c.value ?? 0) > 0 ? { color: 'var(--red, #c0392b)' } : undefined}>
            {t(`cases.counter.${c.key}`)} <b className="num">{c.value ?? '—'}</b>
          </button>
        ))}
      </div>
      <div className="row" style={{ gap: 8, padding: '0 var(--page-pad, 24px) 12px', flexWrap: 'wrap' }}>
        <Input size="sm" value={q} onChange={e => setQ(e.target.value)} placeholder={t('cases.searchPlaceholder')} aria-label={t('cases.searchPlaceholder')} style={{ maxWidth: 280 }} />
        <Select size="sm" value={status} onValueChange={setStatus} aria-label={t('cases.col.status')} options={[{ value: ALL, label: t('cases.allStatuses') }, ...CASE_STATUSES.map(s => ({ value: s, label: t(`cases.status.${s}`) }))]} />
        <Select size="sm" value={priority} onValueChange={setPriority} aria-label={t('cases.col.priority')} options={[{ value: ALL, label: t('cases.allPriorities') }, ...CASE_PRIORITIES.map(s => ({ value: s, label: t(`cases.priority.${s}`) }))]} />
        <Select size="sm" value={channel} onValueChange={setChannel} aria-label={t('cases.col.channel')} options={[{ value: ALL, label: t('cases.allChannels') }, ...CASE_CHANNELS.map(s => ({ value: s, label: t(`cases.channel.${s}`) }))]} />
        <Select size="sm" value={owner} onValueChange={setOwner} aria-label={t('cases.col.owner')} options={[{ value: ALL, label: t('cases.allOwners') }, ...ws.members.filter(m => m.status === 'active').map(m => ({ value: m.id, label: m.name }))]} />
        <Segmented
          value={mode}
          onValueChange={setMode}
          items={[
            { value: 'table', label: <span className="hide-m">{t('cases.viewTable')}</span>, icon: <Table2 size={13} />, 'aria-label': t('cases.viewTable') },
            { value: 'board', label: <span className="hide-m">{t('cases.viewBoard')}</span>, icon: <SquareKanban size={13} />, 'aria-label': t('cases.viewBoard') },
          ]}
        />
      </div>
      {!rows.length && !list.isPending && noFilters ? (
        <EmptyState icon={<LifeBuoy size={20} />} title={t('cases.empty')} action={<Button size="sm" variant="primary" onClick={() => setCreating(true)}><Plus size={14} />{t('cases.newCase')}</Button>}>
          {t('cases.emptyHint')}
        </EmptyState>
      ) : mode === 'board' ? (
        <Kanban
          aria-label={t('cases.title')}
          columns={kanbanColumns}
          items={rows}
          getId={c => c.id}
          getColumn={c => c.status}
          renderCard={c => (
            <div className="kcard" role="button" tabIndex={0} onClick={() => void nav(`/crm/cases/${c.id}`)} onKeyDown={e => e.key === 'Enter' && e.target === e.currentTarget && void nav(`/crm/cases/${c.id}`)}>
              <div className="top"><div className="title">{c.subject}</div></div>
              <div className="muted trunc num" style={{ fontSize: 12.5 }}>{c.number}</div>
              <div className="meta">
                <CasePriorityBadge priority={c.priority} />
                <SlaBadge c={c} />
                {c.ownerId && <MemberAvatar id={c.ownerId} size="sm" />}
              </div>
            </div>
          )}
          onMove={(c, col) => void move(c, col)}
          onAdd={() => setCreating(true)}
          canAdd={col => col === 'new'}
          addLabel={t('cases.newCase')}
        />
      ) : (
        <DataTable aria-label={t('cases.table')} columns={columns} rows={rows} table={table} getId={r => r.id} onRowClick={r => void nav(`/crm/cases/${r.id}`)} onNew={() => setCreating(true)} newLabel={t('cases.newCase')} />
      )}
      {open && <CaseCard caseId={open === 'new' ? null : open} onClose={close} />}
    </div>
  );
}
