/* Автопарк → Документы (задача 1210): ОСАГО, КАСКО, техосмотр, тахограф, СТС, права, медсправка со сроками.
   Напоминания приходят уведомлениями и запускают автоматизации (триггер «Срок документа машины истекает») — их шлёт воркер раз в час. */
import * as React from 'react';
import { FileText, Plus } from 'lucide-react';
import { FLEET_DOC_KIND_LIST, FLEET_DOC_KINDS, type FleetDocKind } from '@gr8r/shared';
import { Button, EmptyState, Field, Select, Skeleton } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/gr8r/data-table';
import { useT } from '@/i18n';
import { fmtDate, parse } from '../lib/dates';
import { useWorkspace } from '../data/store';
import { useMembersWith } from '../positions/data';
import { useFleetApi, useFleetDocs, useVehicles, type FleetDoc } from './data';
import { FleetHead, FormDialog, TermBadge, intOrNull, orNull } from './parts';

const ALL = 'all';

function DocDialog({ doc, onClose }: { doc: FleetDoc | null; onClose: () => void }) {
  const t = useT();
  const api = useFleetApi();
  const vehicles = useVehicles().data?.items ?? [];
  const drivers = useMembersWith(useWorkspace().data.members, 'driver', [doc?.memberId]);
  const [kind, setKind] = React.useState<FleetDocKind>(doc?.kind ?? 'osago');
  const owner = FLEET_DOC_KINDS[kind];
  return (
    <FormDialog
      title={doc ? t('fleet.doc.edit') : t('fleet.doc.new')}
      fields={[
        { key: 'number', label: t('fleet.doc.number'), type: 'text' },
        { key: 'issuedOn', label: t('fleet.doc.issuedOn'), type: 'date' },
        { key: 'validUntil', label: t('fleet.doc.validUntil'), type: 'date', hint: t('fleet.doc.validHint') },
        { key: 'remindDays', label: t('fleet.doc.remindDays'), type: 'number', hint: t('fleet.doc.remindHint') },
        { key: 'comment', label: t('fleet.comment'), type: 'textarea' },
      ]}
      initial={{ number: doc?.number ?? '', issuedOn: doc?.issuedOn ?? '', validUntil: doc?.validUntil ?? '', remindDays: String(doc?.remindDays ?? 30), comment: doc?.comment ?? '', vehicleId: doc?.vehicleId ?? vehicles[0]?.id ?? '', memberId: doc?.memberId ?? drivers[0]?.id ?? '' }}
      onClose={onClose}
      footerExtra={
        doc ? (
          <Button
            variant="ghost"
            onClick={async () => {
              if (await api('DELETE', `documents/${doc.id}`)) onClose();
            }}
          >
            {t('fleet.delete')}
          </Button>
        ) : null
      }
      onSubmit={async v => {
        const data = { kind, vehicleId: owner === 'vehicle' ? String(v.vehicleId) || null : null, memberId: owner === 'driver' ? String(v.memberId) || null : null, number: String(v.number).trim(), issuedOn: orNull(v.issuedOn), validUntil: orNull(v.validUntil), remindDays: intOrNull(v.remindDays) ?? 30, comment: String(v.comment) };
        return !!(doc ? await api('PATCH', `documents/${doc.id}`, data) : await api('POST', 'documents', data));
      }}
      extra={(v, set) => (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
          <Field label={t('fleet.doc.kind')}>{p => <Select id={p.id} aria-label={t('fleet.doc.kind')} value={kind} onValueChange={x => setKind(x as FleetDocKind)} options={FLEET_DOC_KIND_LIST.map(k => ({ value: k, label: t(`fleet.docKind.${k}`) }))} />}</Field>
          {owner === 'vehicle' ? (
            <Field label={t('fleet.doc.vehicle')}>{p => <Select id={p.id} aria-label={t('fleet.doc.vehicle')} value={String(v.vehicleId)} onValueChange={x => set({ vehicleId: x })} options={vehicles.map(x => ({ value: x.id, label: `${x.plate} ${x.name}`.trim() }))} />}</Field>
          ) : (
            <Field label={t('fleet.doc.driver')}>{p => <Select id={p.id} aria-label={t('fleet.doc.driver')} value={String(v.memberId)} onValueChange={x => set({ memberId: x })} options={drivers.map(x => ({ value: x.id, label: x.name }))} />}</Field>
          )}
        </div>
      )}
    />
  );
}

export function DocumentsPage() {
  const t = useT();
  const [term, setTerm] = React.useState(ALL);
  const [kind, setKind] = React.useState(ALL);
  const list = useFleetDocs({ ...(term === ALL ? {} : { term }), ...(kind === ALL ? {} : { kind }) });
  const [edit, setEdit] = React.useState<FleetDoc | 'new' | null>(null);
  const columns = React.useMemo<Column<FleetDoc>[]>(
    () => [
      { id: 'owner', header: t('fleet.doc.owner'), width: 190, value: r => r.plate ?? r.memberName ?? '', cell: r => <b>{r.plate ?? r.memberName}</b> },
      { id: 'kind', header: t('fleet.doc.kind'), width: 170, value: r => r.kind, cell: r => t(`fleet.docKind.${r.kind}`) },
      { id: 'number', header: t('fleet.doc.number'), width: 160, value: r => r.number, cell: r => <span className="num">{r.number || '—'}</span> },
      { id: 'issuedOn', header: t('fleet.doc.issuedOn'), width: 120, value: r => r.issuedOn ?? '', cell: r => <span className="num muted">{r.issuedOn ? fmtDate(parse(r.issuedOn)) : '—'}</span> },
      { id: 'validUntil', header: t('fleet.doc.validUntil'), width: 130, value: r => r.validUntil ?? '9999', cell: r => <span className="num">{r.validUntil ? fmtDate(parse(r.validUntil)) : '—'}</span> },
      { id: 'term', header: t('fleet.doc.term'), width: 160, value: r => r.daysLeft ?? 99999, cell: r => <TermBadge state={r.state} daysLeft={r.daysLeft} /> },
      { id: 'remind', header: t('fleet.doc.remindDays'), width: 120, align: 'right', value: r => r.remindDays, cell: r => <span className="num muted">{r.remindDays}</span> },
    ],
    [t],
  );
  const table = useDataTable(columns, { sort: { id: 'validUntil', dir: 1 } });
  return (
    <div className="page flush">
      <FleetHead
        title={t('fleet.docs.title')}
        lead={t('fleet.docs.lead')}
        actions={
          <Button size="sm" onClick={() => setEdit('new')}>
            <Plus size={13} />
            {t('fleet.doc.new')}
          </Button>
        }
      />
      <section className="panel plain" style={{ margin: '0 var(--gutter) 16px' }}>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label={t('fleet.doc.term')}>
            {p => <Select id={p.id} aria-label={t('fleet.doc.term')} value={term} onValueChange={setTerm} options={[{ value: ALL, label: t('fleet.all') }, ...(['ok', 'expiring', 'expired'] as const).map(s => ({ value: s, label: t(`fleet.termState.${s}`) }))]} />}
          </Field>
          <Field label={t('fleet.doc.kind')}>
            {p => <Select id={p.id} aria-label={t('fleet.doc.kind')} value={kind} onValueChange={setKind} options={[{ value: ALL, label: t('fleet.all') }, ...FLEET_DOC_KIND_LIST.map(k => ({ value: k, label: t(`fleet.docKind.${k}`) }))]} />}
          </Field>
        </div>
      </section>
      {list.isPending ? (
        <div style={{ padding: 16 }}><Skeleton w="100%" h={36} /></div>
      ) : (
        <DataTable aria-label={t('fleet.docs.title')} columns={columns} rows={list.data?.items ?? []} table={table} getId={r => r.id} onRowClick={setEdit} empty={<EmptyState icon={<FileText size={20} />} title={t('fleet.docs.empty')}>{t('fleet.docs.emptyHint')}</EmptyState>} />
      )}
      {edit && <DocDialog key={edit === 'new' ? 'new' : edit.id} doc={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
