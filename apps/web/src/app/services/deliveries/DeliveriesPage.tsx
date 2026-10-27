/* Экран «Доставки» (задача 1100): список по дням и курьерам с отборами (дата, курьер, способ, статус), назначение курьера,
   смена статуса и маршрутный лист; вкладка «Отчёт». Вкладка — в адресе (?tab=). Курьер-участник видит только свои доставки. */
import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import { CircleAlert, Printer, Truck } from 'lucide-react';
import { DELIVERY_STATUSES } from '@gr8r/shared';
import { Badge, Button, EmptyState, Field, Input, Select, Skeleton, toast } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/gr8r/data-table';
import { fmtAmount, useT } from '@/i18n';
import { iso, today, fmtDate, parse } from '../../lib/dates';
import { useDocsApi, useCanSeeCost, typeLabel } from '../../docs/data';
import { DELIVERY_TONE } from '../../docs/DeliveryTab';
import { openRouteSheet, useCouriers, useDeliveries, useDeliveryMethods, type DeliveryItem } from '../../docs/delivery-data';
import { useWsId } from '../../meta/data';
import { useWorkspace } from '../../data/store';
import { DeliveryReportTab } from './DeliveryReportTab';

const ALL = 'all';
const NONE = 'none';

export function DeliveriesPage() {
  const t = useT();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') === 'report' ? 'report' : 'list';
  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('delivery.list.title')}</h1>
          <p>{t('delivery.list.lead')}</p>
        </div>
      </div>
      <nav className="tabs doc-tabs" aria-label={t('delivery.list.tabs')}>
        {(['list', 'report'] as const).map(x => (
          <button key={x} type="button" className={`tab${x === tab ? ' on' : ''}`} aria-current={x === tab ? 'page' : undefined} onClick={() => setSp(x === 'list' ? {} : { tab: x }, { replace: true })}>
            {x === 'list' ? t('delivery.list.tabList') : t('delivery.list.tabReport')}
          </button>
        ))}
      </nav>
      {tab === 'report' ? <DeliveryReportTab /> : <DeliveriesList />}
    </div>
  );
}

function DeliveriesList() {
  const t = useT();
  const ws = useWsId();
  const api = useDocsApi();
  const seeCost = useCanSeeCost();
  const members = useWorkspace().data.members;
  const methods = useDeliveryMethods();
  const couriers = useCouriers();
  const [from, setFrom] = React.useState(iso(today()));
  const [to, setTo] = React.useState(iso(new Date(today().getTime() + 6 * 86400000)));
  const [courier, setCourier] = React.useState(ALL);
  const [method, setMethod] = React.useState(ALL);
  const [status, setStatus] = React.useState(ALL);
  const [q, setQ] = React.useState('');
  const list = useDeliveries({ from, to, courierId: courier === ALL ? undefined : courier, methodId: method === ALL ? undefined : method, status: status === ALL ? undefined : status, q: q.trim() || undefined });
  const rows = list.data?.items ?? [];
  const courierOptions = (couriers.data ?? []).filter(c => c.isCourier);

  const columns = React.useMemo<Column<DeliveryItem>[]>(
    () => [
      { id: 'day', header: t('delivery.list.col.time'), width: 150, value: r => `${r.deliveryDate ?? ''} ${r.windowFrom ?? ''}`, cell: r => <span className="num">{r.deliveryDate ? fmtDate(parse(r.deliveryDate)) : t('delivery.list.noDate')} {r.windowFrom ? `${r.windowFrom.slice(0, 5)}${r.windowTo ? `–${r.windowTo.slice(0, 5)}` : ''}` : ''}</span> },
      { id: 'address', header: t('delivery.list.col.address'), width: 260, value: r => r.address, cell: r => <span className="trunc">{r.address || '—'}</span> },
      { id: 'contact', header: t('delivery.list.col.contact'), width: 190, value: r => r.contactName, cell: r => <span className="trunc muted">{r.contactName || '—'}{r.contactPhone ? ` · ${r.contactPhone}` : ''}</span> },
      {
        id: 'document',
        header: t('delivery.list.col.document'),
        width: 190,
        value: r => r.documentNumber ?? '',
        cell: r => (
          <Link className="crm-link" to={`/documents/${r.documentId}`} title={t('delivery.list.noDocument')}>
            {typeLabel(r.documentType as never)} {r.documentNumber ?? ''}
          </Link>
        ),
      },
      { id: 'method', header: t('delivery.list.col.method'), width: 150, value: r => r.methodName ?? '', cell: r => <span className="muted trunc">{r.methodName ?? '—'}</span> },
      {
        id: 'courier',
        header: t('delivery.list.col.courier'),
        width: 180,
        value: r => r.courierName ?? '',
        cell: r => (
          <Select
            size="sm"
            aria-label={t('delivery.list.assign')}
            value={r.courierMemberId ?? NONE}
            disabled={r.status === 'delivered' || r.status === 'failed'}
            onValueChange={async v => {
              const res = await api('POST', `/deliveries/${r.id}/assign`, { courierMemberId: v === NONE ? null : v });
              if (res) toast(t('delivery.list.changed'));
            }}
            options={[{ value: NONE, label: t('delivery.list.unassigned') }, ...(r.courierMemberId && !courierOptions.some(c => c.id === r.courierMemberId) ? [{ value: r.courierMemberId, label: r.courierName ?? '' }] : []), ...(courierOptions.length ? courierOptions : members).map(c => ({ value: c.id, label: c.name }))]}
          />
        ),
      },
      { id: 'price', header: t('delivery.list.col.price'), width: 100, value: r => r.price, cell: r => <span className="num">{fmtAmount(r.price)}</span> },
      ...(seeCost ? [{ id: 'cost', header: t('delivery.list.col.cost'), width: 110, value: (r: DeliveryItem) => r.ourCost ?? '', cell: (r: DeliveryItem) => <span className="num muted">{r.ourCost === null ? '—' : fmtAmount(r.ourCost)}</span> }] : []),
      {
        id: 'status',
        header: t('delivery.list.col.status'),
        width: 170,
        value: r => r.status,
        cell: r => (
          <Select
            size="sm"
            aria-label={t('delivery.list.col.status')}
            value={r.status}
            onValueChange={async v => {
              const res = await api('POST', `/deliveries/${r.id}/status`, { status: v });
              if (res) toast(t('delivery.list.changed'));
            }}
            options={DELIVERY_STATUSES.map(s => ({ value: s, label: t(`delivery.status.${s}`) }))}
          />
        ),
      },
    ],
    [t, api, seeCost, members, courierOptions],
  );
  const table = useDataTable(columns, { sort: { id: 'day', dir: 1 } });
  const sheetCourier = courier === ALL ? null : courier;

  return (
    <>
      <section className="panel plain" style={{ margin: '0 var(--gutter) 16px' }}>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label={t('delivery.list.from')}>{p => <Input {...p} type="date" value={from} max={to} onChange={e => setFrom(e.target.value || iso(today()))} />}</Field>
          <Field label={t('delivery.list.to')}>{p => <Input {...p} type="date" value={to} min={from} onChange={e => setTo(e.target.value || from)} />}</Field>
          <Field label={t('delivery.list.courier')}>
            {p => <Select id={p.id} value={courier} onValueChange={setCourier} aria-label={t('delivery.list.courier')} options={[{ value: ALL, label: t('delivery.list.allCouriers') }, ...members.map(m => ({ value: m.id, label: m.name }))]} />}
          </Field>
          <Field label={t('delivery.list.method')}>
            {p => <Select id={p.id} value={method} onValueChange={setMethod} aria-label={t('delivery.list.method')} options={[{ value: ALL, label: t('delivery.list.allMethods') }, ...(methods.data ?? []).map(m => ({ value: m.id, label: m.name }))]} />}
          </Field>
          <Field label={t('delivery.list.statusFilter')}>
            {p => <Select id={p.id} value={status} onValueChange={setStatus} aria-label={t('delivery.list.statusFilter')} options={[{ value: ALL, label: t('delivery.list.allStatuses') }, ...DELIVERY_STATUSES.map(s => ({ value: s, label: t(`delivery.status.${s}`) }))]} />}
          </Field>
          <Field label={t('delivery.list.search')}>{p => <Input {...p} value={q} onChange={e => setQ(e.target.value)} />}</Field>
          <Button
            size="sm"
            variant="ghost"
            disabled={!sheetCourier}
            title={t('delivery.list.routeSheet')}
            onClick={() => openRouteSheet(ws, sheetCourier, from).catch(e => toast.error(String(e instanceof Error ? e.message : e)))}
          >
            <Printer size={13} />
            {t('delivery.list.routeSheet')}
          </Button>
        </div>
      </section>
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={t('delivery.list.loadError')} action={<Button size="sm" onClick={() => list.refetch()}>{t('common.retry')}</Button>}>
          {(list.error as Error).message}
        </EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : (
        <DataTable aria-label={t('delivery.list.title')} columns={columns} rows={rows} table={table} getId={r => r.id} empty={<EmptyState icon={<Truck size={20} />} title={t('delivery.list.empty')}>{t('delivery.list.emptyHint')}</EmptyState>} />
      )}
      <p className="faint" style={{ margin: '8px var(--gutter)', fontSize: 12 }}>
        <Badge tone={DELIVERY_TONE.new}>{t('delivery.status.new')}</Badge> {t('delivery.list.couriersHint')}
      </p>
    </>
  );
}
