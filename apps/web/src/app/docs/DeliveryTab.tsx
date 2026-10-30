/* Вкладка «Доставка» документа (задача 1100): заказ покупателя, реализация, заказ-наряд.
   Способ, адрес, контакт, дата и окно, расстояние, вес, цена и себестоимость (по тарифу, можно поправить), курьер или перевозчик,
   статус; кнопка «Добавить в документ» кладёт строку-услугу «Доставка». Себестоимость видят admin и owner. */
import * as React from 'react';
import { Link } from 'react-router';
import { Plus, Printer, Trash2, Truck } from 'lucide-react';
import { DELIVERY_STATUSES, type DeliveryStatus } from '@gr8r/shared';
import { Badge, Button, ConfirmDialog, EmptyState, Field, Input, Select, Skeleton, Textarea, toast, type Tone } from '@/components/ui';
import { fmtAmount, useT } from '@/i18n';
import { fmtDate, parse } from '../lib/dates';
import { useWorkspace } from '../data/store';
import { useMembersWith } from '../positions/data';
import { useCanWrite } from '../meta/custom-fields';
import { CounterpartyPicker } from './pickers';
import { errorMessage } from '../data/api';
import { useWsId } from '../meta/data';
import { downloadTransportWaybillPdf, openTransportWaybill } from '../trips/data';
import { useCanSeeCost, useDocsApi, typeLabel, type DocDetail } from './data';
import { useDeliveryMethods, useDocumentDelivery, type DeliveryItem } from './delivery-data';

export const DELIVERY_TONE: Record<DeliveryStatus, Tone> = { new: 'neutral', assigned: 'accent', in_transit: 'amber', delivered: 'green', failed: 'red' };
const NONE = 'none';

interface Form {
  methodId: string;
  address: string;
  contactName: string;
  contactPhone: string;
  deliveryDate: string;
  windowFrom: string;
  windowTo: string;
  distanceKm: string;
  weightKg: string;
  price: string;
  ourCost: string;
  courierMemberId: string;
  carrierCompanyId: string;
  carrierName: string;
  comment: string;
}

const fromItem = (d: DeliveryItem): Form => ({
  methodId: d.methodId ?? NONE,
  address: d.address,
  contactName: d.contactName,
  contactPhone: d.contactPhone,
  deliveryDate: d.deliveryDate ?? '',
  windowFrom: d.windowFrom?.slice(0, 5) ?? '',
  windowTo: d.windowTo?.slice(0, 5) ?? '',
  distanceKm: d.distanceKm,
  weightKg: d.weightKg,
  price: d.price,
  ourCost: d.ourCost ?? '',
  courierMemberId: d.courierMemberId ?? NONE,
  carrierCompanyId: d.carrierCompanyId ?? '',
  carrierName: d.carrierName ?? '',
  comment: d.comment,
});

export function DeliveryTab({ doc }: { doc: DocDetail }) {
  const t = useT();
  const api = useDocsApi();
  const canWrite = useCanWrite() && doc.status !== 'cancelled';
  const seeCost = useCanSeeCost();
  const methods = useDeliveryMethods();
  const allMembers = useWorkspace().data.members;
  const ws = useWsId();
  const q = useDocumentDelivery(doc.id);
  const item = q.data?.delivery ?? null;
  const members = useMembersWith(allMembers, 'courier', [item?.courierMemberId]); // курьеры (задача 1172)
  const [form, setForm] = React.useState<Form | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [confirmDel, setConfirmDel] = React.useState(false);
  React.useEffect(() => {
    setForm(item ? fromItem(item) : null);
  }, [item]);

  if (q.isPending) return <Skeleton w="100%" h={80} />;
  const moved = q.data?.movedTo;
  if (!item || !form) {
    return (
      <section className="doc-links panel" aria-label={t('delivery.tab.title')}>
        {moved ? (
          <p>
            {t('delivery.tab.movedTo', { type: typeLabel(moved.type as DocDetail['type']), number: moved.number ?? '' })}{' '}
            <Link className="crm-link" to={`/documents/${moved.documentId}`}>
              {t('delivery.tab.open')}
            </Link>
          </p>
        ) : (
          <EmptyState icon={<Truck size={20} />} title={t('delivery.tab.none')}>
            {canWrite && (
              <Button size="sm" disabled={busy} onClick={async () => {
                setBusy(true);
                const r = await api('PUT', `/deliveries/by-document/${doc.id}`, {});
                setBusy(false);
                if (r) toast(t('delivery.tab.saved'));
              }}>
                <Plus size={13} />
                {t('delivery.tab.create')}
              </Button>
            )}
          </EmptyState>
        )}
      </section>
    );
  }

  const set = (patch: Partial<Form>) => setForm(f => (f ? { ...f, ...patch } : f));
  const save = async (extra: Record<string, unknown> = {}) => {
    setBusy(true);
    const r = await api('PUT', `/deliveries/by-document/${doc.id}`, {
      methodId: form.methodId === NONE ? null : form.methodId,
      address: form.address,
      contactName: form.contactName,
      contactPhone: form.contactPhone,
      deliveryDate: form.deliveryDate || null,
      windowFrom: form.windowFrom || null,
      windowTo: form.windowTo || null,
      distanceKm: form.distanceKm || '0',
      weightKg: form.weightKg || '0',
      price: form.price || '0',
      ...(seeCost && form.ourCost !== '' ? { ourCost: form.ourCost } : {}),
      courierMemberId: form.courierMemberId === NONE ? null : form.courierMemberId,
      carrierCompanyId: form.carrierCompanyId || null,
      comment: form.comment,
      ...extra,
    });
    setBusy(false);
    if (r) toast(t('delivery.tab.saved'));
  };
  const changeStatus = async (status: string) => {
    const r = await api('POST', `/deliveries/${item.id}/status`, { status });
    if (r) toast(t('delivery.list.changed'));
  };
  const methodFree = methods.data?.find(m => m.id === item.methodId)?.freeFrom;
  const free = !!methodFree && Number(methodFree) > 0 && Number(doc.amountNet) >= Number(methodFree) && Number(item.price) === 0;
  const dis = !canWrite;

  return (
    <section className="doc-links panel" aria-label={t('delivery.tab.title')}>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <Badge tone={DELIVERY_TONE[item.status]}>{t(`delivery.status.${item.status}`)}</Badge>
        {item.originDocumentId && <span className="faint" style={{ fontSize: 12 }}>{t('delivery.tab.inherited')}</span>}
        {item.expensedAt && item.expenseAmount && <span className="faint" style={{ fontSize: 12 }}>{t('delivery.tab.expense', { amount: fmtAmount(item.expenseAmount), date: fmtDate(parse(item.expensedAt)) })}</span>}
        <span className="sp" />
        <Button size="sm" variant="ghost" onClick={() => openTransportWaybill(ws, { deliveryId: item.id }).catch(e => toast.error(errorMessage(e)))}>
          <Printer size={13} />
          {t('trips.tn.print')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => downloadTransportWaybillPdf(ws, { deliveryId: item.id }, { failed: t('trips.tn.failed'), timeout: t('trips.tn.timeout') }).catch(e => toast.error(errorMessage(e)))}>
          {t('trips.tn.pdf')}
        </Button>
        <Select aria-label={t('delivery.tab.status')} value={item.status} disabled={dis} onValueChange={v => void changeStatus(v)} options={DELIVERY_STATUSES.map(s => ({ value: s, label: t(`delivery.status.${s}`) }))} />
      </div>
      {doc.type === 'work_order' && <p className="faint" style={{ fontSize: 12 }}>{t('delivery.tab.costInWorkOrder')}</p>}
      <div className="grid-form" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
        <Field label={t('delivery.tab.method')}>
          {p => (
            <Select id={p.id} disabled={dis} value={form.methodId} onValueChange={v => set({ methodId: v })} options={[{ value: NONE, label: t('delivery.tab.noMethod') }, ...(methods.data ?? []).map(m => ({ value: m.id, label: m.name }))]} aria-label={t('delivery.tab.method')} />
          )}
        </Field>
        <Field label={t('delivery.tab.date')}>{p => <Input {...p} type="date" disabled={dis} value={form.deliveryDate} onChange={e => set({ deliveryDate: e.target.value })} />}</Field>
        <Field label={t('delivery.tab.from')}>{p => <Input {...p} type="time" disabled={dis} value={form.windowFrom} onChange={e => set({ windowFrom: e.target.value })} />}</Field>
        <Field label={t('delivery.tab.to')}>{p => <Input {...p} type="time" disabled={dis} value={form.windowTo} onChange={e => set({ windowTo: e.target.value })} />}</Field>
        <Field label={t('delivery.tab.address')} className="span-2">{p => <Input {...p} disabled={dis} value={form.address} onChange={e => set({ address: e.target.value })} />}</Field>
        <Field label={t('delivery.tab.contact')}>{p => <Input {...p} disabled={dis} value={form.contactName} onChange={e => set({ contactName: e.target.value })} />}</Field>
        <Field label={t('delivery.tab.phone')}>{p => <Input {...p} type="tel" disabled={dis} value={form.contactPhone} onChange={e => set({ contactPhone: e.target.value })} />}</Field>
        <Field label={t('delivery.tab.distance')}>{p => <Input {...p} inputMode="decimal" disabled={dis} value={form.distanceKm} onChange={e => set({ distanceKm: e.target.value })} />}</Field>
        <Field label={t('delivery.tab.weight')}>
          {p => (
            <div className="row" style={{ gap: 4 }}>
              <Input {...p} inputMode="decimal" disabled={dis} value={form.weightKg} onChange={e => set({ weightKg: e.target.value })} />
              {!dis && (
                <Button size="sm" variant="ghost" type="button" disabled={busy} onClick={() => void save({ recalcWeight: true, weightKg: undefined, recalc: true })}>
                  {t('delivery.tab.recalcWeight')}
                </Button>
              )}
            </div>
          )}
        </Field>
        <Field label={t('delivery.tab.price')} hint={free ? t('delivery.tab.freeHint') : undefined}>{p => <Input {...p} inputMode="decimal" disabled={dis} value={form.price} onChange={e => set({ price: e.target.value })} />}</Field>
        {seeCost && <Field label={t('delivery.tab.cost')}>{p => <Input {...p} inputMode="decimal" disabled={dis} value={form.ourCost} onChange={e => set({ ourCost: e.target.value })} />}</Field>}
        <Field label={t('delivery.tab.courier')}>
          {p => (
            <Select id={p.id} disabled={dis} value={form.courierMemberId} onValueChange={v => set({ courierMemberId: v })} options={[{ value: NONE, label: t('delivery.tab.noCourier') }, ...members.map(m => ({ value: m.id, label: m.name }))]} aria-label={t('delivery.tab.courier')} />
          )}
        </Field>
        <Field label={t('delivery.tab.carrier')}>
          {p => <CounterpartyPicker id={p.id} disabled={dis} value={form.carrierName} placeholder={t('delivery.tab.noCarrier')} onPick={c => set({ carrierCompanyId: c.id, carrierName: c.name })} />}
        </Field>
      </div>
      <Field label={t('delivery.tab.comment')} className="mt-3">{p => <Textarea {...p} rows={2} disabled={dis} value={form.comment} onChange={e => set({ comment: e.target.value })} />}</Field>
      {canWrite && (
        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <Button size="sm" disabled={busy} onClick={() => void save()}>
            {t('delivery.tab.save')}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save({ recalc: true })}>
            {t('delivery.tab.recalc')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || doc.status !== 'draft' || form.methodId === NONE}
            title={t('delivery.tab.lineHint')}
            onClick={async () => {
              await save();
              const r = await api('POST', `/deliveries/${item.id}/add-to-document`);
              if (r) {
                toast(t('delivery.tab.addedToDocument'));
                void api('GET', `/documents/${doc.id}`, undefined, { quiet: true });
              }
            }}
          >
            {t('delivery.tab.addToDocument')}
          </Button>
          <span className="sp" />
          <Button size="sm" variant="ghost" onClick={() => setConfirmDel(true)}>
            <Trash2 size={13} />
            {t('delivery.tab.remove')}
          </Button>
        </div>
      )}
      <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>{t('delivery.tab.lineHint')}</p>
      <ConfirmDialog
        open={confirmDel}
        onOpenChange={setConfirmDel}
        title={t('delivery.tab.remove')}
        description={t('delivery.tab.removeConfirm')}
        confirmLabel={t('delivery.tab.remove')}
        cancelLabel={t('delivery.mine.cancel')}
        danger
        onConfirm={async () => {
          const r = await api('DELETE', `/deliveries/${item.id}`);
          if (r) toast(t('delivery.tab.deleted'));
          setConfirmDel(false);
        }}
      />
    </section>
  );
}
