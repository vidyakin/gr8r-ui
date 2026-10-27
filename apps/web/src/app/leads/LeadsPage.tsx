/* CRM → Leads (задача 1175): таблица и доска по статусам, поиск и фильтр по ответственному; карточка лида — LeadCard */
import * as React from 'react';
import { Plus, SquareKanban, Table2, UserPlus } from 'lucide-react';
import { Button, EmptyState, Input, Segmented, Select, toast } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/gr8r/data-table';
import { Kanban } from '@/components/gr8r/kanban';
import { fmtDateTime } from '@/i18n/format';
import { useT } from '@/i18n';
import { MemberAvatar } from '../components/workspace';
import { useWorkspace } from '../data/store';
import { LeadCard } from './LeadCard';
import { StatusBadge } from './StatusBadge';
import { ConvertDialog } from './ConvertDialog';
import { useLeads, useLeadsApi, useLeadStatuses, type Lead } from './data';

export function LeadsPage() {
  const t = useT();
  const { data: ws } = useWorkspace();
  const api = useLeadsApi();
  const [q, setQ] = React.useState('');
  const [owner, setOwner] = React.useState('all');
  const [mode, setMode] = React.useState<'board' | 'table'>('board');
  const [open, setOpen] = React.useState<string | 'new' | null>(null);
  const [convertId, setConvertId] = React.useState<string | null>(null);
  const statuses = useLeadStatuses();
  const leadsQ = useLeads(q.trim());
  const statusById = React.useMemo(() => new Map((statuses.data ?? []).map(s => [s.id, s])), [statuses.data]);
  const memberName = (id: string | null) => ws.members.find(m => m.id === id)?.name ?? '';

  const all = leadsQ.data ?? [];
  const rows = all.filter(l => owner === 'all' || (owner === 'none' ? !l.ownerId : l.ownerId === owner));

  const columns = React.useMemo<Column<Lead>[]>(
    () => [
      { id: 'name', header: t('leads.col.name'), width: 240, value: r => r.name, cell: r => <span className="trunc" style={{ fontWeight: 450 }}>{r.name}</span> },
      { id: 'company', header: t('leads.col.company'), width: 190, value: r => r.companyName, cell: r => <span className="trunc">{r.companyName || <span className="faint">—</span>}</span> },
      { id: 'contact', header: t('leads.col.contact'), width: 190, value: r => `${r.phone} ${r.email}`, cell: r => <span className="trunc muted">{[r.phone, r.email].filter(Boolean).join(' · ') || '—'}</span> },
      { id: 'source', header: t('leads.col.source'), width: 140, value: r => r.source, cell: r => r.source || <span className="faint">—</span> },
      { id: 'status', header: t('leads.col.status'), width: 160, value: r => statusById.get(r.statusId)?.sortOrder ?? 0, cell: r => <StatusBadge status={statusById.get(r.statusId)} /> },
      {
        id: 'owner',
        header: t('leads.col.owner'),
        width: 170,
        value: r => memberName(r.ownerId),
        cell: r => (r.ownerId ? <span className="row" style={{ gap: 6 }}><MemberAvatar id={r.ownerId} size="sm" />{memberName(r.ownerId)}</span> : <span className="faint">{t('leads.noOwner')}</span>),
      },
      { id: 'created', header: t('leads.col.created'), width: 150, defaultHidden: true, value: r => r.createdAt, cell: r => <span className="muted num">{fmtDateTime(r.createdAt)}</span> },
    ],
    [t, statusById, ws.members], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const table = useDataTable(columns);

  const kanbanColumns = (statuses.data ?? []).map(s => ({ id: s.id, name: s.name, title: <StatusBadge status={s} />, subtitle: String(rows.filter(l => l.statusId === s.id).length) }));

  const move = async (l: Lead, col: string) => {
    if (l.convertedAt || col === l.statusId) return;
    const target = statusById.get(col);
    if (target?.category === 'converted') {
      setConvertId(l.id);
      return;
    }
    const r = await api<Lead>('PATCH', `/leads/${l.id}`, { statusId: col });
    if (r && target?.category === 'rejected') toast.info(t('leads.card.rejectReason'));
  };

  const owners = ws.members.filter(m => m.status === 'active');

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('leads.title')}</h1>
          <p>{t('leads.summary', { count: all.length })}</p>
        </div>
        <div className="acts">
          <Button variant="primary" onClick={() => setOpen('new')}>
            <Plus size={14} />
            {t('leads.newLead')}
          </Button>
        </div>
      </div>
      <div className="row" style={{ gap: 8, padding: '0 var(--page-pad, 24px) 12px', flexWrap: 'wrap' }}>
        <Input size="sm" value={q} onChange={e => setQ(e.target.value)} placeholder={t('leads.searchPlaceholder')} aria-label={t('leads.searchPlaceholder')} style={{ maxWidth: 260 }} />
        <Select
          size="sm"
          value={owner}
          onValueChange={setOwner}
          aria-label={t('leads.col.owner')}
          options={[{ value: 'all', label: t('leads.allOwners') }, { value: 'none', label: t('leads.noOwner') }, ...owners.map(m => ({ value: m.id, label: m.name }))]}
        />
        <Segmented
          value={mode}
          onValueChange={setMode}
          items={[
            { value: 'board', label: <span className="hide-m">{t('leads.viewKanban')}</span>, icon: <SquareKanban size={13} />, 'aria-label': t('leads.viewKanban') },
            { value: 'table', label: <span className="hide-m">{t('leads.viewTable')}</span>, icon: <Table2 size={13} />, 'aria-label': t('leads.viewTable') },
          ]}
        />
      </div>
      {!all.length && !leadsQ.isPending && !q ? (
        <EmptyState icon={<UserPlus size={20} />} title={t('leads.empty')} action={<Button size="sm" variant="primary" onClick={() => setOpen('new')}><Plus size={14} />{t('leads.newLead')}</Button>}>
          {t('leads.emptyHint')}
        </EmptyState>
      ) : mode === 'board' ? (
        <Kanban
          aria-label={t('leads.title')}
          columns={kanbanColumns}
          items={rows}
          getId={l => l.id}
          getColumn={l => l.statusId}
          renderCard={l => (
            <div className="kcard" role="button" tabIndex={0} onClick={() => setOpen(l.id)} onKeyDown={e => e.key === 'Enter' && e.target === e.currentTarget && setOpen(l.id)}>
              <div className="top"><div className="title">{l.name}</div></div>
              {l.companyName && <div className="muted trunc" style={{ fontSize: 12.5 }}>{l.companyName}</div>}
              <div className="meta">
                {l.source && <span className="m trunc">{l.source}</span>}
                <span className="m num">{fmtDateTime(l.createdAt)}</span>
                {l.ownerId && <MemberAvatar id={l.ownerId} size="sm" />}
              </div>
            </div>
          )}
          onMove={(l, col) => void move(l, col)}
          onAdd={() => setOpen('new')}
          canAdd={col => statusById.get(col)?.category === 'new'}
          addLabel={t('leads.newLead')}
        />
      ) : (
        <DataTable aria-label={t('leads.table')} columns={columns} rows={rows} table={table} getId={r => r.id} onRowClick={r => setOpen(r.id)} onNew={() => setOpen('new')} newLabel={t('leads.newLead')} />
      )}
      {open && <LeadCard leadId={open === 'new' ? null : open} onClose={() => setOpen(null)} onConvert={id => setConvertId(id)} />}
      {convertId && <ConvertDialog leadId={convertId} onClose={() => setConvertId(null)} />}
    </div>
  );
}
