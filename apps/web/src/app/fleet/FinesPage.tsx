/* Автопарк → Штрафы (задача 1210): штрафы ГИБДД вводятся вручную (загрузка по API — позже). Водитель определяется по путевому листу
   машины на дату нарушения; «удержать с водителя» — отметка для зарплаты, иначе оплаченный штраф идёт в затраты на машину. */
import * as React from 'react';
import { Plus, ReceiptText } from 'lucide-react';
import { FINE_STATUSES, type FineStatus } from '@gr8r/shared';
import { Badge, Button, EmptyState, Field, Input, Select, Skeleton } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/gr8r/data-table';
import { fmtAmount, useT } from '@/i18n';
import { iso, today, fmtDate, parse } from '../lib/dates';
import { useWorkspace } from '../data/store';
import { useMembersWith } from '../positions/data';
import { useFines, useFleetApi, useVehicles, type Fine } from './data';
import { FleetHead, FormDialog, num, orNull } from './parts';

const ALL = 'all';
const NONE = 'none';
const TONE: Record<FineStatus, 'red' | 'green' | 'amber'> = { unpaid: 'red', paid: 'green', appealed: 'amber' };

function FineDialog({ fine, onClose }: { fine: Fine | null; onClose: () => void }) {
  const t = useT();
  const api = useFleetApi();
  const vehicles = useVehicles().data?.items ?? [];
  const drivers = useMembersWith(useWorkspace().data.members, 'driver', [fine?.driverMemberId]);
  return (
    <FormDialog
      title={fine ? fine.uin || t('fleet.fine.title1') : t('fleet.fine.new')}
      fields={[
        { key: 'vehicleId', label: t('fleet.fuel.vehicle'), type: 'select', required: true, options: vehicles.map(v => ({ value: v.id, label: `${v.plate} ${v.name}`.trim() })) },
        { key: 'date', label: t('fleet.fine.date'), type: 'date', required: true },
        { key: 'amount', label: t('fleet.fine.amount'), type: 'number', required: true },
        { key: 'uin', label: t('fleet.fine.uin'), type: 'text' },
        { key: 'article', label: t('fleet.fine.article'), type: 'text' },
        { key: 'driverMemberId', label: t('fleet.fine.driver'), type: 'select', hint: t('fleet.fine.driverHint'), options: [{ value: NONE, label: t('fleet.fine.byWaybill') }, ...drivers.map(m => ({ value: m.id, label: m.name }))] },
        { key: 'status', label: t('fleet.fine.status'), type: 'select', options: FINE_STATUSES.map(s => ({ value: s, label: t(`fleet.fineStatus.${s}`) })) },
        { key: 'paidOn', label: t('fleet.fine.paidOn'), type: 'date' },
        { key: 'chargeDriver', label: t('fleet.fine.chargeDriver'), type: 'check' },
        { key: 'comment', label: t('fleet.comment'), type: 'textarea' },
      ]}
      initial={{ vehicleId: fine?.vehicleId ?? vehicles[0]?.id ?? '', date: fine?.date ?? iso(today()), amount: fine ? String(Number(fine.amount)) : '', uin: fine?.uin ?? '', article: fine?.article ?? '', driverMemberId: fine?.driverMemberId ?? NONE, status: fine?.status ?? 'unpaid', paidOn: fine?.paidOn ?? '', chargeDriver: fine?.chargeDriver ?? false, comment: fine?.comment ?? '' }}
      onClose={onClose}
      footerExtra={
        fine ? (
          <Button
            variant="ghost"
            onClick={async () => {
              if (await api('DELETE', `fines/${fine.id}`)) onClose();
            }}
          >
            {t('fleet.delete')}
          </Button>
        ) : null
      }
      onSubmit={async v => {
        const data = { vehicleId: String(v.vehicleId), date: String(v.date), amount: num(v.amount) ?? '0', uin: String(v.uin).trim(), article: String(v.article).trim(), ...(v.driverMemberId === NONE ? (fine ? {} : {}) : { driverMemberId: String(v.driverMemberId) }), status: v.status as FineStatus, paidOn: orNull(v.paidOn), chargeDriver: !!v.chargeDriver, comment: String(v.comment) };
        return !!(fine ? await api('PATCH', `fines/${fine.id}`, data) : await api('POST', 'fines', data));
      }}
    />
  );
}

export function FinesPage() {
  const t = useT();
  const vehicles = useVehicles().data?.items ?? [];
  const [from, setFrom] = React.useState(iso(new Date(today().getTime() - 180 * 86400000)));
  const [to, setTo] = React.useState(iso(today()));
  const [vehicle, setVehicle] = React.useState(ALL);
  const [status, setStatus] = React.useState(ALL);
  const list = useFines({ from, to, ...(vehicle === ALL ? {} : { vehicleId: vehicle }), ...(status === ALL ? {} : { status }) });
  const [edit, setEdit] = React.useState<Fine | 'new' | null>(null);
  const columns = React.useMemo<Column<Fine>[]>(
    () => [
      { id: 'date', header: t('fleet.fine.date'), width: 110, value: r => r.date, cell: r => <span className="num">{fmtDate(parse(r.date))}</span> },
      { id: 'vehicle', header: t('fleet.fuel.vehicle'), width: 120, value: r => r.plate, cell: r => <b>{r.plate}</b> },
      { id: 'driver', header: t('fleet.fine.driver'), width: 170, value: r => r.driverName ?? '', cell: r => <span className="trunc">{r.driverName ?? '—'}</span> },
      { id: 'waybill', header: t('fleet.fuel.waybill'), width: 140, value: r => r.waybillNumber ?? '', cell: r => <span className="muted">{r.waybillNumber ?? '—'}</span> },
      { id: 'uin', header: t('fleet.fine.uin'), width: 190, value: r => r.uin, cell: r => <span className="num muted">{r.uin || '—'}</span> },
      { id: 'article', header: t('fleet.fine.article'), width: 230, value: r => r.article, cell: r => <span className="trunc">{r.article || '—'}</span> },
      { id: 'amount', header: t('fleet.fine.amount'), width: 110, align: 'right', value: r => Number(r.amount), cell: r => <span className="num">{fmtAmount(r.amount)}</span>, total: rows => <span className="num">{fmtAmount(rows.reduce((s, r) => s + Number(r.amount), 0))}</span> },
      { id: 'charge', header: t('fleet.fine.chargeShort'), width: 130, value: r => (r.chargeDriver ? 1 : 0), cell: r => (r.chargeDriver ? <Badge tone="violet">{t('fleet.fine.chargeShort')}</Badge> : <span className="faint">—</span>) },
      { id: 'status', header: t('fleet.fine.status'), width: 120, value: r => r.status, cell: r => <Badge tone={TONE[r.status]}>{t(`fleet.fineStatus.${r.status}`)}</Badge> },
    ],
    [t],
  );
  const table = useDataTable(columns, { sort: { id: 'date', dir: -1 } });
  return (
    <div className="page flush">
      <FleetHead
        title={t('fleet.fines.title')}
        lead={t('fleet.fines.lead')}
        actions={
          <Button size="sm" onClick={() => setEdit('new')}>
            <Plus size={13} />
            {t('fleet.fine.new')}
          </Button>
        }
      />
      <section className="panel plain" style={{ margin: '0 var(--gutter) 16px' }}>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label={t('fleet.from')}>{p => <Input {...p} type="date" value={from} max={to} onChange={e => setFrom(e.target.value || from)} />}</Field>
          <Field label={t('fleet.to')}>{p => <Input {...p} type="date" value={to} min={from} onChange={e => setTo(e.target.value || to)} />}</Field>
          <Field label={t('fleet.fuel.vehicle')}>
            {p => <Select id={p.id} aria-label={t('fleet.fuel.vehicle')} value={vehicle} onValueChange={setVehicle} options={[{ value: ALL, label: t('fleet.all') }, ...vehicles.map(v => ({ value: v.id, label: v.plate }))]} />}
          </Field>
          <Field label={t('fleet.fine.status')}>
            {p => <Select id={p.id} aria-label={t('fleet.fine.status')} value={status} onValueChange={setStatus} options={[{ value: ALL, label: t('fleet.all') }, ...FINE_STATUSES.map(s => ({ value: s, label: t(`fleet.fineStatus.${s}`) }))]} />}
          </Field>
        </div>
      </section>
      {list.isPending ? (
        <div style={{ padding: 16 }}><Skeleton w="100%" h={36} /></div>
      ) : (
        <DataTable aria-label={t('fleet.fines.title')} columns={columns} rows={list.data?.items ?? []} table={table} getId={r => r.id} onRowClick={setEdit} empty={<EmptyState icon={<ReceiptText size={20} />} title={t('fleet.fines.empty')}>{t('fleet.fines.emptyHint')}</EmptyState>} />
      )}
      {edit && <FineDialog key={edit === 'new' ? 'new' : edit.id} fine={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
