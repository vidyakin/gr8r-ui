/* Заявки на перевозку (задача 1223): список заявок заказчиков, карточка заявки — шапка (организация, заказчик, маршрут,
   груз, ставка) и вкладка с точками маршрута, действия — подтвердить/отменить, создать рейс, выставить счёт/акт. */
import * as React from 'react';
import { FileSignature, Plus, Trash2 } from 'lucide-react';
import { TRANSPORT_ORDER_STATUSES, TRANSPORT_RATE_KINDS, computeTransportRateAmount, type TransportOrderStatus } from '@gr8r/shared';
import { Badge, Button, ConfirmDialog, Dialog, DialogContent, EmptyState, Field, IconButton, Input, Select, Skeleton, Tab, Tabs, TabsList, Textarea, toast } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/gr8r/data-table';
import { fmtNumber, useT } from '@/i18n';
import { fmtDate, iso, parse, today } from '../lib/dates';
import { useOrganizations } from '../docs/data';
import { useProducts } from '../catalog/data';
import { FleetHead } from '../fleet/parts';
import { CounterpartyPicker } from '../docs/pickers';
import { useTrips } from '../trips/data';
import { useWsId } from '../meta/data';
import { openCarrierContract } from './print';
import { errorMessage } from '../data/api';
import {
  useSuggestRateSchedule,
  useTransportApi,
  useTransportOrder,
  useTransportOrders,
  type TransportOrder,
  type TransportOrderPoint,
} from './data';

const ALL = 'all';
export const ORDER_TONE: Record<TransportOrderStatus, 'gray' | 'amber' | 'accent' | 'green' | 'red'> = { draft: 'gray', confirmed: 'amber', in_progress: 'accent', done: 'green', cancelled: 'red' };

/** Выставить счёт/акт: выбрать услугу «Перевозка» для строки документа */
function BillingDialog({ orderId, kind, onClose }: { orderId: string; kind: 'invoice' | 'act'; onClose: () => void }) {
  const t = useT();
  const api = useTransportApi();
  const products = useProducts({ kind: 'service', active: true }).data ?? [];
  const [productId, setProductId] = React.useState(products[0]?.id ?? '');
  const submit = async () => {
    if (!productId) return;
    const r = await api<{ documentId: string }>('POST', `/${orderId}/${kind}`, { productId });
    if (r) {
      toast(kind === 'invoice' ? t('transport.orders.invoiceCreated') : t('transport.orders.actCreated'));
      onClose();
    }
  };
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={t('transport.orders.billing.title')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
            <Button disabled={!productId} onClick={submit}>{t('transport.orders.billing.confirmLabel')}</Button>
          </>
        }
      >
        <Field label={t('transport.orders.billing.pickProduct')}>
          {p => <Select id={p.id} aria-label={t('transport.orders.billing.pickProduct')} value={productId} onValueChange={setProductId} options={products.map(x => ({ value: x.id, label: x.name }))} />}
        </Field>
      </DialogContent>
    </Dialog>
  );
}

/** Закрепить заявку за существующим рейсом (создание рейса — отдельно, в разделе «Рейсы»); точки маршрута заявки
    добавляются в рейс как остановки доставки. */
function TripPickDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const t = useT();
  const api = useTransportApi();
  const trips = useTrips({ status: 'planned' }).data?.items ?? [];
  const [tripId, setTripId] = React.useState(trips[0]?.id ?? '');
  const submit = async () => {
    if (!tripId) return;
    const r = await api('POST', `/${orderId}/trip`, { tripId });
    if (r) {
      toast(t('transport.orders.tripAttached'));
      onClose();
    }
  };
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={t('transport.orders.tripPicker.title')}
        description={t('transport.orders.tripPicker.hint')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
            <Button disabled={!tripId} onClick={submit}>{t('transport.orders.tripPicker.confirmLabel')}</Button>
          </>
        }
      >
        <Field label={t('transport.orders.tripPicker.pickTrip')}>
          {p =>
            trips.length ? (
              <Select id={p.id} aria-label={t('transport.orders.tripPicker.pickTrip')} value={tripId} onValueChange={setTripId} options={trips.map(tr => ({ value: tr.id, label: `${tr.number} ${tr.plate}` }))} />
            ) : (
              <span className="muted">{t('transport.orders.tripPicker.noTrips')}</span>
            )
          }
        </Field>
      </DialogContent>
    </Dialog>
  );
}

type PointDraft = Omit<TransportOrderPoint, 'id' | 'seq'>;
const newPoint = (kind: 'load' | 'unload'): PointDraft => ({ kind, address: '', contactName: '', contactPhone: '' });

export function TransportOrderDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useT();
  const ws = useWsId();
  const api = useTransportApi();
  const detail = useTransportOrder(id);
  const order = id ? detail.data : null;
  const orgs = useOrganizations();

  const [tab, setTab] = React.useState<'main' | 'points'>('main');
  const [organizationId, setOrganizationId] = React.useState(order?.organizationId ?? orgs.data?.[0]?.id ?? '');
  const [customer, setCustomer] = React.useState<{ id: string; name: string } | null>(null);
  const [date, setDate] = React.useState(order?.date ?? iso(today()));
  const [fromPlace, setFromPlace] = React.useState(order?.fromPlace ?? '');
  const [toPlace, setToPlace] = React.useState(order?.toPlace ?? '');
  const [readyDate, setReadyDate] = React.useState(order?.readyDate ?? '');
  const [deliveryDate, setDeliveryDate] = React.useState(order?.deliveryDate ?? '');
  const [cargoName, setCargoName] = React.useState(order?.cargoName ?? '');
  const [weightKg, setWeightKg] = React.useState(order ? String(Number(order.weightKg)) : '');
  const [volumeM3, setVolumeM3] = React.useState(order ? String(Number(order.volumeM3)) : '');
  const [places, setPlaces] = React.useState(order ? String(order.places) : '');
  const [bodyType, setBodyType] = React.useState(order?.bodyType ?? '');
  const [rateKind, setRateKind] = React.useState(order?.rateKind ?? 'flat');
  const [rate, setRate] = React.useState(order ? String(Number(order.rate)) : '0');
  const [distanceKm, setDistanceKm] = React.useState(order?.distanceKm ? String(Number(order.distanceKm)) : '');
  const [amountOverride, setAmountOverride] = React.useState<string | null>(null);
  const [comment, setComment] = React.useState(order?.comment ?? '');
  const [points, setPoints] = React.useState<PointDraft[]>([]);
  const [ask, setAsk] = React.useState<'delete' | 'cancel' | null>(null);
  const [billing, setBilling] = React.useState<'invoice' | 'act' | null>(null);
  const [tripPick, setTripPick] = React.useState(false);

  React.useEffect(() => {
    if (!order) return;
    setOrganizationId(order.organizationId);
    setCustomer({ id: order.customerCompanyId, name: '' });
    setDate(order.date);
    setFromPlace(order.fromPlace);
    setToPlace(order.toPlace);
    setReadyDate(order.readyDate ?? '');
    setDeliveryDate(order.deliveryDate ?? '');
    setCargoName(order.cargoName);
    setWeightKg(String(Number(order.weightKg)));
    setVolumeM3(String(Number(order.volumeM3)));
    setPlaces(String(order.places));
    setBodyType(order.bodyType);
    setRateKind(order.rateKind);
    setRate(String(Number(order.rate)));
    setDistanceKm(order.distanceKm ? String(Number(order.distanceKm)) : '');
    setComment(order.comment);
    setPoints(order.points.map(p => ({ kind: p.kind, address: p.address, contactName: p.contactName, contactPhone: p.contactPhone })));
  }, [order]);

  const suggest = useSuggestRateSchedule(fromPlace, toPlace, bodyType).data?.item ?? null;
  const applySuggestion = () => {
    if (!suggest) return;
    setRateKind(suggest.rateKind);
    setRate(String(Number(suggest.rate)));
    if (suggest.distanceKm) setDistanceKm(String(Number(suggest.distanceKm)));
  };
  const computedAmount = computeTransportRateAmount({ rateKind, rate: rate || '0' }, { distanceKm: distanceKm || '0', weightKg: weightKg || '0' });
  const amount = amountOverride ?? computedAmount;

  const status = order?.status ?? 'draft';
  const editable = status === 'draft';
  const final = status === 'done' || status === 'cancelled';
  const missing = !organizationId || !customer || !date;

  const body = () => ({
    date,
    organizationId,
    customerCompanyId: customer!.id,
    fromPlace,
    toPlace,
    readyDate: readyDate || null,
    deliveryDate: deliveryDate || null,
    cargoName,
    weightKg: weightKg || '0',
    volumeM3: volumeM3 || '0',
    places: Number(places) || 0,
    bodyType,
    rateScheduleId: suggest && rate === String(Number(suggest.rate)) ? suggest.id ?? null : null,
    rateKind,
    rate: rate || '0',
    distanceKm: distanceKm || null,
    amount: amountOverride ?? undefined,
    comment,
    points: points.map(p => ({ kind: p.kind, address: p.address, contactName: p.contactName, contactPhone: p.contactPhone })),
  });

  const save = async () => {
    if (missing) return;
    const r = order ? await api<TransportOrder>('PATCH', `/${order.id}`, body()) : await api<TransportOrder>('POST', '', body());
    if (r) {
      toast(order ? t('transport.orders.saved') : t('transport.orders.created'));
      if (!order) onClose();
    }
    return r;
  };

  const setStatus = async (next: TransportOrderStatus) => {
    if (!order) return;
    if (await api('POST', `/${order.id}/status`, { status: next })) {
      if (next === 'cancelled') onClose();
    }
  };

  return (
    <>
      <Dialog open onOpenChange={o => !o && onClose()}>
        <DialogContent
          title={order ? t('transport.orders.card.titleEdit', { number: order.number }) : t('transport.orders.card.titleNew')}
          description={order ? t(`transport.orders.status.${status}`) : undefined}
          size="lg"
          footer={
            <>
              <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
              {editable && (
                <Button disabled={missing} onClick={save}>{t('common.save')}</Button>
              )}
              {order && status === 'draft' && (
                <Button variant="secondary" onClick={() => void setStatus('confirmed')}>{t('transport.orders.action.confirm')}</Button>
              )}
              {order && !final && (
                <Button variant="ghost" onClick={() => setAsk('cancel')}>{t('transport.orders.action.cancel')}</Button>
              )}
              {order && status === 'draft' && (
                <Button variant="ghost" onClick={() => setAsk('delete')}>{t('transport.orders.action.delete')}</Button>
              )}
              {order && !order.tripId && !final && (
                <Button variant="secondary" onClick={() => setTripPick(true)}>{t('transport.orders.action.createTrip')}</Button>
              )}
              {order && !order.invoiceDocumentId && (
                <Button variant="ghost" onClick={() => setBilling('invoice')}>{t('transport.orders.action.invoice')}</Button>
              )}
              {order && order.tripId && (
                <Button variant="ghost" onClick={() => openCarrierContract(ws, order.tripId!).catch(e => toast.error(errorMessage(e)))}>{t('transport.orders.action.printCarrierContract')}</Button>
              )}
              {order && order.invoiceDocumentId && !order.actDocumentId && (
                <Button variant="ghost" onClick={() => setBilling('act')}>{t('transport.orders.action.act')}</Button>
              )}
            </>
          }
        >
          <div className="stack" style={{ gap: 12 }}>
            <Tabs value={tab} onValueChange={v => setTab(v as 'main' | 'points')}>
              <TabsList>
                <Tab value="main">{t('transport.orders.card.tabMain')}</Tab>
                <Tab value="points" count={points.length || undefined}>{t('transport.orders.card.tabPoints')}</Tab>
              </TabsList>
            </Tabs>
            {tab === 'main' ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
                <Field label={t('transport.orders.card.organization')}>
                  {p => <Select id={p.id} aria-label={t('transport.orders.card.organization')} disabled={!editable} value={organizationId} onValueChange={setOrganizationId} options={(orgs.data ?? []).map(o => ({ value: o.id, label: o.name }))} />}
                </Field>
                <Field label={t('transport.orders.card.customer')}>
                  {p => <CounterpartyPicker id={p.id} value={customer?.name ?? ''} disabled={!editable} onPick={c => setCustomer({ id: c.id, name: c.name })} />}
                </Field>
                <Field label={t('transport.orders.card.date')}>{p => <Input {...p} type="date" disabled={!editable} value={date} onChange={e => setDate(e.target.value)} />}</Field>
                <Field label={t('transport.orders.card.fromPlace')}>{p => <Input {...p} disabled={!editable} value={fromPlace} onChange={e => setFromPlace(e.target.value)} />}</Field>
                <Field label={t('transport.orders.card.toPlace')}>{p => <Input {...p} disabled={!editable} value={toPlace} onChange={e => setToPlace(e.target.value)} />}</Field>
                <Field label={t('transport.orders.card.readyDate')}>{p => <Input {...p} type="date" disabled={!editable} value={readyDate} onChange={e => setReadyDate(e.target.value)} />}</Field>
                <Field label={t('transport.orders.card.deliveryDate')}>{p => <Input {...p} type="date" disabled={!editable} value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} />}</Field>
                <Field label={t('transport.orders.card.cargoName')}>{p => <Input {...p} disabled={!editable} value={cargoName} onChange={e => setCargoName(e.target.value)} />}</Field>
                <Field label={t('transport.orders.card.weightKg')}>{p => <Input {...p} inputMode="decimal" disabled={!editable} value={weightKg} onChange={e => setWeightKg(e.target.value)} />}</Field>
                <Field label={t('transport.orders.card.volumeM3')}>{p => <Input {...p} inputMode="decimal" disabled={!editable} value={volumeM3} onChange={e => setVolumeM3(e.target.value)} />}</Field>
                <Field label={t('transport.orders.card.places')}>{p => <Input {...p} inputMode="numeric" disabled={!editable} value={places} onChange={e => setPlaces(e.target.value)} />}</Field>
                <Field label={t('transport.orders.card.bodyType')}>{p => <Input {...p} disabled={!editable} value={bodyType} onChange={e => setBodyType(e.target.value)} />}</Field>
                <Field label={t('transport.orders.card.rateKind')}>
                  {p => <Select id={p.id} aria-label={t('transport.orders.card.rateKind')} disabled={!editable} value={rateKind} onValueChange={v => setRateKind(v as typeof rateKind)} options={TRANSPORT_RATE_KINDS.map(k => ({ value: k, label: t(`transport.orders.rateKind.${k}`) }))} />}
                </Field>
                <Field label={t('transport.orders.card.rate')} hint={suggest ? t('transport.orders.card.rateScheduleAuto') : editable && fromPlace && toPlace ? t('transport.orders.card.rateScheduleNone') : undefined}>
                  {p => <Input {...p} inputMode="decimal" disabled={!editable} value={rate} onChange={e => setRate(e.target.value)} />}
                </Field>
                <Field label={t('transport.orders.card.distanceKm')}>{p => <Input {...p} inputMode="decimal" disabled={!editable} value={distanceKm} onChange={e => setDistanceKm(e.target.value)} />}</Field>
                <Field label={t('transport.orders.card.amount')} hint={t('transport.orders.card.amountAuto')}>
                  {p => <Input {...p} inputMode="decimal" disabled={!editable} value={amount} onChange={e => setAmountOverride(e.target.value)} />}
                </Field>
                {editable && suggest && (
                  <Button size="sm" variant="ghost" style={{ alignSelf: 'end' }} onClick={applySuggestion}>
                    {t('transport.orders.card.rateScheduleAuto')}: {fmtNumber(suggest.rate)}
                  </Button>
                )}
                <Field label={t('transport.orders.card.comment')} className="fleet-wide">
                  {p => <Textarea id={p.id} rows={2} disabled={!editable} value={comment} onChange={e => setComment(e.target.value)} />}
                </Field>
              </div>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                <div className="muted">{t('transport.orders.card.pointsHint')}</div>
                {points.map((p, i) => (
                  <div key={i} className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', borderTop: i ? '1px solid var(--line)' : undefined, paddingTop: i ? 8 : 0 }}>
                    <Field label={t('transport.orders.card.pointKind')}>
                      {fp => <Select id={fp.id} aria-label={t('transport.orders.card.pointKind')} disabled={!editable} value={p.kind} onValueChange={v => setPoints(ps => ps.map((x, j) => (j === i ? { ...x, kind: v as 'load' | 'unload' } : x)))} options={[{ value: 'load', label: t('trips.stopKind.load') }, { value: 'unload', label: t('trips.stopKind.unload') }]} />}
                    </Field>
                    <div style={{ flex: '2 1 200px' }}>
                      <Field label={t('transport.orders.card.pointAddress')}>
                        {fp => <Input {...fp} disabled={!editable} value={p.address} onChange={e => setPoints(ps => ps.map((x, j) => (j === i ? { ...x, address: e.target.value } : x)))} />}
                      </Field>
                    </div>
                    <Field label={t('transport.orders.card.pointContactName')}>
                      {fp => <Input {...fp} disabled={!editable} value={p.contactName} onChange={e => setPoints(ps => ps.map((x, j) => (j === i ? { ...x, contactName: e.target.value } : x)))} />}
                    </Field>
                    <Field label={t('transport.orders.card.pointContactPhone')}>
                      {fp => <Input {...fp} disabled={!editable} value={p.contactPhone} onChange={e => setPoints(ps => ps.map((x, j) => (j === i ? { ...x, contactPhone: e.target.value } : x)))} />}
                    </Field>
                    {editable && (
                      <IconButton label={t('transport.orders.card.removePoint')} size="sm" onClick={() => setPoints(ps => ps.filter((_, j) => j !== i))}>
                        <Trash2 size={13} />
                      </IconButton>
                    )}
                  </div>
                ))}
                {editable && (
                  <div className="row" style={{ gap: 8 }}>
                    <Button size="sm" variant="ghost" onClick={() => setPoints(ps => [...ps, newPoint('load')])}>
                      <Plus size={13} />
                      {t('transport.orders.card.addPoint')} ({t('trips.stopKind.load')})
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setPoints(ps => [...ps, newPoint('unload')])}>
                      <Plus size={13} />
                      {t('transport.orders.card.addPoint')} ({t('trips.stopKind.unload')})
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
          <ConfirmDialog
            open={ask !== null}
            onOpenChange={o => !o && setAsk(null)}
            danger
            title={ask === 'delete' ? t('transport.orders.confirm.delete') : t('transport.orders.confirm.cancel')}
            confirmLabel={ask === 'delete' ? t('transport.orders.action.delete') : t('transport.orders.action.cancel')}
            cancelLabel={t('transport.orders.confirm.keep')}
            onConfirm={() =>
              void (async () => {
                if (!order) return;
                if (ask === 'delete') {
                  if (await api('DELETE', `/${order.id}`)) onClose();
                } else {
                  await setStatus('cancelled');
                }
                setAsk(null);
              })()
            }
          />
        </DialogContent>
      </Dialog>
      {order && billing && <BillingDialog orderId={order.id} kind={billing} onClose={() => setBilling(null)} />}
      {order && tripPick && <TripPickDialog orderId={order.id} onClose={() => setTripPick(false)} />}
    </>
  );
}

export function TransportOrdersPage() {
  const t = useT();
  const [from, setFrom] = React.useState(iso(new Date(today().getTime() - 30 * 86400000)));
  const [to, setTo] = React.useState(iso(new Date(today().getTime() + 30 * 86400000)));
  const [status, setStatus] = React.useState(ALL);
  const [q, setQ] = React.useState('');
  const list = useTransportOrders({ from, to, ...(status === ALL ? {} : { status }), ...(q.trim() ? { q: q.trim() } : {}) });
  const [edit, setEdit] = React.useState<string | 'new' | null>(null);
  const columns = React.useMemo<Column<TransportOrder>[]>(
    () => [
      { id: 'number', header: t('transport.orders.col.number'), width: 140, value: r => r.number, cell: r => <b>{r.number}</b> },
      { id: 'date', header: t('transport.orders.col.date'), width: 110, value: r => r.date, cell: r => <span className="num">{fmtDate(parse(r.date))}</span> },
      { id: 'route', header: t('transport.orders.col.route'), width: 220, value: r => `${r.fromPlace} ${r.toPlace}`, cell: r => <span className="trunc">{[r.fromPlace, r.toPlace].filter(Boolean).join(' → ') || '—'}</span> },
      { id: 'cargo', header: t('transport.orders.col.cargo'), width: 180, value: r => r.cargoName, cell: r => <span className="trunc">{r.cargoName || '—'}</span> },
      { id: 'amount', header: t('transport.orders.col.amount'), width: 130, align: 'right', value: r => Number(r.amount), cell: r => <span className="num">{fmtNumber(r.amount)}</span> },
      { id: 'trip', header: t('transport.orders.col.trip'), width: 90, value: r => (r.tripId ? 1 : 0), cell: r => (r.tripId ? <Badge tone="gray">{t('transport.orders.col.trip')}</Badge> : <span className="faint">—</span>) },
      { id: 'status', header: t('transport.orders.col.status'), width: 130, value: r => r.status, cell: r => <Badge tone={ORDER_TONE[r.status]}>{t(`transport.orders.status.${r.status}`)}</Badge> },
    ],
    [t],
  );
  const table = useDataTable(columns, { sort: { id: 'date', dir: -1 } });
  return (
    <div className="page flush">
      <FleetHead
        title={t('transport.orders.title')}
        lead={t('transport.orders.lead')}
        actions={
          <Button size="sm" onClick={() => setEdit('new')}>
            <Plus size={13} />
            {t('transport.orders.new')}
          </Button>
        }
      />
      <section className="panel plain" style={{ margin: '0 var(--gutter) 16px' }}>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label={t('transport.orders.from')}>{p => <Input {...p} type="date" value={from} max={to} onChange={e => setFrom(e.target.value || from)} />}</Field>
          <Field label={t('transport.orders.to')}>{p => <Input {...p} type="date" value={to} min={from} onChange={e => setTo(e.target.value || to)} />}</Field>
          <Field label={t('transport.orders.col.status')}>
            {p => <Select id={p.id} aria-label={t('transport.orders.col.status')} value={status} onValueChange={setStatus} options={[{ value: ALL, label: t('transport.orders.all') }, ...TRANSPORT_ORDER_STATUSES.map(s => ({ value: s, label: t(`transport.orders.status.${s}`) }))]} />}
          </Field>
          <Field label={t('transport.orders.search')}>{p => <Input {...p} value={q} onChange={e => setQ(e.target.value)} />}</Field>
        </div>
      </section>
      {list.isPending ? (
        <div style={{ padding: 16 }}><Skeleton w="100%" h={36} /></div>
      ) : (
        <DataTable
          aria-label={t('transport.orders.title')}
          columns={columns}
          rows={list.data?.items ?? []}
          table={table}
          getId={r => r.id}
          onRowClick={r => setEdit(r.id)}
          empty={<EmptyState icon={<FileSignature size={20} />} title={t('transport.orders.empty')}>{t('transport.orders.emptyHint')}</EmptyState>}
        />
      )}
      {edit && <TransportOrderDialog key={edit} id={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
