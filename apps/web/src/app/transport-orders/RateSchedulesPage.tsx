/* Тарифы по направлениям (задача 1223): справочник ставок, подсказываемых в заявке на перевозку по совпадению
   откуда/куда (и типа кузова, если задан). Простой справочник — без шапки документа, как у машин автопарка. */
import * as React from 'react';
import { ListChecks, Plus } from 'lucide-react';
import { TRANSPORT_RATE_KINDS } from '@gr8r/shared';
import { Badge, Button, EmptyState, Skeleton, Switch } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/gr8r/data-table';
import { fmtNumber, useT } from '@/i18n';
import { FleetHead, FormDialog, num, type FieldDef, type Values } from '../fleet/parts';
import { useRateSchedules, useTransportApi, type RateSchedule } from './data';

const toValues = (r: RateSchedule | null): Values => ({
  name: r?.name ?? '',
  fromPlace: r?.fromPlace ?? '',
  toPlace: r?.toPlace ?? '',
  bodyType: r?.bodyType ?? '',
  rateKind: r?.rateKind ?? 'flat',
  rate: r ? String(Number(r.rate)) : '0',
  distanceKm: r?.distanceKm ? String(Number(r.distanceKm)) : '',
  comment: r?.comment ?? '',
});

const body = (v: Values) => ({
  name: String(v.name).trim(),
  fromPlace: String(v.fromPlace).trim(),
  toPlace: String(v.toPlace).trim(),
  bodyType: String(v.bodyType).trim(),
  rateKind: v.rateKind,
  rate: num(v.rate) ?? '0',
  distanceKm: num(v.distanceKm) ?? null,
  comment: String(v.comment),
});

function RateScheduleDialog({ item, onClose }: { item: RateSchedule | null; onClose: () => void }) {
  const t = useT();
  const api = useTransportApi();
  const fields: FieldDef[] = [
    { key: 'name', label: t('transport.rates.field.name'), type: 'text', required: true },
    { key: 'fromPlace', label: t('transport.rates.field.fromPlace'), type: 'text' },
    { key: 'toPlace', label: t('transport.rates.field.toPlace'), type: 'text' },
    { key: 'bodyType', label: t('transport.rates.field.bodyType'), type: 'text' },
    { key: 'rateKind', label: t('transport.rates.field.rateKind'), type: 'select', options: TRANSPORT_RATE_KINDS.map(k => ({ value: k, label: t(`transport.orders.rateKind.${k}`) })) },
    { key: 'rate', label: t('transport.rates.field.rate'), type: 'number', required: true },
    { key: 'distanceKm', label: t('transport.rates.field.distanceKm'), type: 'number' },
    { key: 'comment', label: t('transport.rates.field.comment'), type: 'textarea' },
  ];
  return (
    <FormDialog
      title={item ? item.name : t('transport.rates.new')}
      fields={fields}
      initial={toValues(item)}
      onClose={onClose}
      onSubmit={async v => !!(item ? await api('PATCH', `/rate-schedules/${item.id}`, body(v)) : await api('POST', '/rate-schedules', body(v)))}
      footerExtra={
        item ? (
          <Button variant="ghost" onClick={async () => { if (await api('POST', `/rate-schedules/${item.id}/archive?archived=${item.archivedAt ? 'false' : 'true'}`)) onClose(); }}>
            {item.archivedAt ? t('transport.rates.restore') : t('transport.rates.archive')}
          </Button>
        ) : null
      }
    />
  );
}

export function RateSchedulesPage() {
  const t = useT();
  const [archived, setArchived] = React.useState(false);
  const list = useRateSchedules(archived ? { archived: 'include' } : {});
  const [edit, setEdit] = React.useState<RateSchedule | 'new' | null>(null);
  const rows = list.data?.items ?? [];
  const columns = React.useMemo<Column<RateSchedule>[]>(
    () => [
      { id: 'name', header: t('transport.rates.col.name'), width: 200, value: r => r.name, cell: r => <b>{r.name}</b> },
      { id: 'route', header: t('transport.rates.col.route'), width: 220, value: r => `${r.fromPlace} ${r.toPlace}`, cell: r => <span className="trunc">{[r.fromPlace, r.toPlace].filter(Boolean).join(' → ') || '—'}</span> },
      { id: 'bodyType', header: t('transport.rates.col.bodyType'), width: 140, value: r => r.bodyType, cell: r => r.bodyType || <span className="faint">—</span> },
      { id: 'rateKind', header: t('transport.rates.col.rateKind'), width: 120, value: r => r.rateKind, cell: r => t(`transport.orders.rateKind.${r.rateKind}`) },
      { id: 'rate', header: t('transport.rates.col.rate'), width: 130, align: 'right', value: r => Number(r.rate), cell: r => <span className="num">{fmtNumber(r.rate)}</span> },
      { id: 'distanceKm', header: t('transport.rates.col.distanceKm'), width: 130, align: 'right', value: r => Number(r.distanceKm ?? 0), cell: r => <span className="num">{r.distanceKm ? fmtNumber(r.distanceKm) : '—'}</span> },
      { id: 'status', header: t('transport.rates.col.status'), width: 110, value: r => (r.archivedAt ? 1 : 0), cell: r => (r.archivedAt ? <Badge tone="gray">{t('transport.rates.archived')}</Badge> : <span className="faint">—</span>) },
    ],
    [t],
  );
  const table = useDataTable(columns, { sort: { id: 'name', dir: 1 } });
  return (
    <div className="page flush">
      <FleetHead
        title={t('transport.rates.title')}
        lead={t('transport.rates.lead')}
        actions={
          <>
            <label className="row" style={{ gap: 6, fontSize: 12 }}>
              <Switch checked={archived} aria-label={t('transport.rates.showArchived')} onChange={e => setArchived(e.target.checked)} />
              {t('transport.rates.showArchived')}
            </label>
            <Button size="sm" onClick={() => setEdit('new')}>
              <Plus size={13} />
              {t('transport.rates.new')}
            </Button>
          </>
        }
      />
      {list.isPending ? (
        <div style={{ padding: 16 }}><Skeleton w="100%" h={36} /></div>
      ) : (
        <DataTable aria-label={t('transport.rates.title')} columns={columns} rows={rows} table={table} getId={r => r.id} onRowClick={r => setEdit(r)} empty={<EmptyState icon={<ListChecks size={20} />} title={t('transport.rates.empty')}>{t('transport.rates.emptyHint')}</EmptyState>} />
      )}
      {edit && <RateScheduleDialog key={edit === 'new' ? 'new' : edit.id} item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
