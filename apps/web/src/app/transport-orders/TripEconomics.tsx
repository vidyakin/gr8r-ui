/* Экономика рейса (задача 1223, docs/architecture/transport-orders.md): наёмный перевозчик (экспедирование), прочие
   затраты рейса и маржа. Самодостаточный блок — подключается одной строкой в карточке рейса (TripDialog) и в карточке
   заявки на перевозку, если понадобится. Все тексты через t(), суммы — fmtAmount. */
import * as React from 'react';
import { Plus, Printer, Trash2 } from 'lucide-react';
import { Badge, Button, Field, IconButton, Input, Select, toast } from '@/components/ui';
import { fmtAmount, useT } from '@/i18n';
import { useCompanies, useIsAdmin } from '../catalog/data';
import { useCostItems } from '../docs/data';
import { errorMessage } from '../data/api';
import { useFleetTripCarrier, useFleetTripCosts, useTransportApi, useTripMargin, type FleetTripCarrier } from './data';
import { openCarrierContract } from './print';
import { useWsId } from '../meta/data';

/** Блок «наёмный перевозчик, затраты, маржа» в карточке рейса. Показывается только для сохранённого рейса. */
export function TripEconomics({ tripId }: { tripId: string }) {
  const t = useT();
  const ws = useWsId();
  const api = useTransportApi();
  const companies = useCompanies().data ?? [];
  const costItems = useCostItems('expense').data ?? [];
  const carrier = useFleetTripCarrier(tripId).data?.item ?? null;
  const costs = useFleetTripCosts(tripId).data?.items ?? [];
  const margin = useTripMargin(tripId, useIsAdmin()).data;

  const [carrierForm, setCarrierForm] = React.useState(false);
  const [cf, setCf] = React.useState(() => carrierFields(carrier));
  React.useEffect(() => setCf(carrierFields(carrier)), [carrier]);
  const [addingCost, setAddingCost] = React.useState(false);
  const [costDraft, setCostForm] = React.useState({ costItemId: '', amount: '', comment: '' });
  const costForm = { ...costDraft, costItemId: costDraft.costItemId || (costItems[0]?.id ?? '') };

  const saveCarrier = async () => {
    if (!cf.carrierCompanyId) return;
    const body = {
      carrierCompanyId: cf.carrierCompanyId,
      rate: cf.rate || '0',
      vehiclePlate: cf.vehiclePlate,
      vehicleModel: cf.vehicleModel,
      driverName: cf.driverName,
      driverPhone: cf.driverPhone,
      driverLicense: cf.driverLicense,
      contractNumber: cf.contractNumber,
      contractDate: cf.contractDate || null,
      comment: cf.comment,
    };
    if (await api('PUT', `/trips/${tripId}/carrier`, body)) {
      toast.success(t('transport.carrier.saved'));
      setCarrierForm(false);
    }
  };
  const removeCarrier = async () => {
    if (await api('DELETE', `/trips/${tripId}/carrier`)) toast.success(t('transport.carrier.removed'));
  };
  const addCost = async () => {
    if (!costForm.costItemId || !costForm.amount) return;
    if (await api('POST', `/trips/${tripId}/costs`, costForm)) {
      toast.success(t('transport.costs.saved'));
      setCostForm({ costItemId: '', amount: '', comment: '' });
      setAddingCost(false);
    }
  };
  const removeCost = async (id: string) => {
    if (await api('DELETE', `/trips/${tripId}/costs/${id}`)) toast.success(t('transport.costs.removed'));
  };
  const costItemName = (id: string) => costItems.find(c => c.id === id)?.name ?? '—';
  const companyName = (id: string) => companies.find(c => c.id === id)?.name ?? '—';

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="label">{t('transport.carrier.title')}</div>
        <span className="muted">{t('transport.carrier.hint')}</span>
      </div>

      {!carrier && !carrierForm && (
        <Button size="sm" variant="ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setCarrierForm(true)}>
          <Plus size={13} />
          {t('transport.carrier.assign')}
        </Button>
      )}

      {carrier && !carrierForm && (
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>
            <b>{companyName(carrier.carrierCompanyId)}</b> · {fmtAmount(carrier.rate)}
          </span>
          {carrier.vehiclePlate && <span className="muted">{carrier.vehiclePlate}</span>}
          {carrier.driverName && <span className="muted">{carrier.driverName}</span>}
          <Button size="sm" variant="ghost" onClick={() => setCarrierForm(true)}>{t('common.edit')}</Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => openCarrierContract(ws, tripId).catch(e => toast.error(errorMessage(e)))}
          >
            <Printer size={13} />
            {t('transport.contract.print')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void removeCarrier()}>{t('transport.carrier.remove')}</Button>
        </div>
      )}

      {carrierForm && (
        <div className="stack" style={{ gap: 10, border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 }}>
            <Field label={t('transport.carrier.company')}>
              {p => (
                <Select
                  id={p.id}
                  aria-label={t('transport.carrier.company')}
                  value={cf.carrierCompanyId}
                  onValueChange={v => setCf(s => ({ ...s, carrierCompanyId: v }))}
                  options={companies.map(c => ({ value: c.id, label: c.name }))}
                />
              )}
            </Field>
            <Field label={t('transport.carrier.rate')}>
              {p => <Input {...p} inputMode="decimal" value={cf.rate} onChange={e => setCf(s => ({ ...s, rate: e.target.value }))} />}
            </Field>
            <Field label={t('transport.carrier.vehiclePlate')}>
              {p => <Input {...p} value={cf.vehiclePlate} onChange={e => setCf(s => ({ ...s, vehiclePlate: e.target.value }))} />}
            </Field>
            <Field label={t('transport.carrier.vehicleModel')}>
              {p => <Input {...p} value={cf.vehicleModel} onChange={e => setCf(s => ({ ...s, vehicleModel: e.target.value }))} />}
            </Field>
            <Field label={t('transport.carrier.driverName')}>
              {p => <Input {...p} value={cf.driverName} onChange={e => setCf(s => ({ ...s, driverName: e.target.value }))} />}
            </Field>
            <Field label={t('transport.carrier.driverPhone')}>
              {p => <Input {...p} value={cf.driverPhone} onChange={e => setCf(s => ({ ...s, driverPhone: e.target.value }))} />}
            </Field>
            <Field label={t('transport.carrier.driverLicense')}>
              {p => <Input {...p} value={cf.driverLicense} onChange={e => setCf(s => ({ ...s, driverLicense: e.target.value }))} />}
            </Field>
            <Field label={t('transport.carrier.contractNumber')}>
              {p => <Input {...p} value={cf.contractNumber} onChange={e => setCf(s => ({ ...s, contractNumber: e.target.value }))} />}
            </Field>
            <Field label={t('transport.carrier.contractDate')}>
              {p => <Input {...p} type="date" value={cf.contractDate} onChange={e => setCf(s => ({ ...s, contractDate: e.target.value }))} />}
            </Field>
          </div>
          <Field label={t('transport.carrier.comment')}>
            {p => <Input {...p} value={cf.comment} onChange={e => setCf(s => ({ ...s, comment: e.target.value }))} />}
          </Field>
          <div className="row" style={{ gap: 8 }}>
            <Button size="sm" disabled={!cf.carrierCompanyId} onClick={() => void saveCarrier()}>{t('common.save')}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setCarrierForm(false); setCf(carrierFields(carrier)); }}>{t('common.cancel')}</Button>
          </div>
        </div>
      )}

      <div className="row" style={{ gap: 12, alignItems: 'center', marginTop: 6 }}>
        <div className="label">{t('transport.costs.title')}</div>
      </div>
      {costs.length === 0 && !addingCost && <div className="muted">{t('transport.costs.empty')}</div>}
      {costs.map(c => (
        <div key={c.id} className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span style={{ flex: 1 }}>{costItemName(c.costItemId)}{c.comment ? ` · ${c.comment}` : ''}</span>
          <b className="num">{fmtAmount(c.amount)}</b>
          <IconButton label={t('common.delete')} size="sm" onClick={() => void removeCost(c.id)}><Trash2 size={13} /></IconButton>
        </div>
      ))}
      {addingCost ? (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label={t('transport.costs.costItem')}>
            {p => (
              <Select
                id={p.id}
                aria-label={t('transport.costs.costItem')}
                value={costForm.costItemId}
                onValueChange={v => setCostForm(s => ({ ...s, costItemId: v }))}
                options={costItems.map(c => ({ value: c.id, label: c.name }))}
              />
            )}
          </Field>
          <Field label={t('transport.costs.amount')}>
            {p => <Input {...p} style={{ width: 120 }} inputMode="decimal" value={costForm.amount} onChange={e => setCostForm(s => ({ ...s, amount: e.target.value }))} />}
          </Field>
          <Field label={t('transport.costs.comment')}>
            {p => <Input {...p} value={costForm.comment} onChange={e => setCostForm(s => ({ ...s, comment: e.target.value }))} />}
          </Field>
          <Button size="sm" disabled={!costForm.costItemId || !costForm.amount} onClick={() => void addCost()}>{t('common.save')}</Button>
          <Button size="sm" variant="ghost" onClick={() => setAddingCost(false)}>{t('common.cancel')}</Button>
        </div>
      ) : (
        <Button size="sm" variant="ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setAddingCost(true)}>
          <Plus size={13} />
          {t('transport.costs.add')}
        </Button>
      )}

      {margin && (
        <div className="stack" style={{ gap: 4, marginTop: 6 }}>
          <div className="label">{t('transport.carrier.margin.title')}</div>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <span className="muted">{t('transport.carrier.margin.income')}: <b className="num">{fmtAmount(margin.income)}</b></span>
            <span className="muted">{t('transport.carrier.margin.fuelAmount')}: <b className="num">{fmtAmount(margin.fuelAmount)}</b></span>
            <span className="muted">{t('transport.carrier.margin.driverPay')}: <b className="num">{fmtAmount(margin.driverPay)}</b></span>
            <span className="muted">{t('transport.carrier.margin.carrierRate')}: <b className="num">{fmtAmount(margin.carrierRate)}</b></span>
            <span className="muted">{t('transport.carrier.margin.otherCosts')}: <b className="num">{fmtAmount(margin.otherCosts)}</b></span>
            <span className="muted">{t('transport.carrier.margin.totalCosts')}: <b className="num">{fmtAmount(margin.totalCosts)}</b></span>
            <Badge tone={Number(margin.margin) >= 0 ? 'green' : 'red'}>
              {t('transport.carrier.margin.margin')}: {fmtAmount(margin.margin)}
              {margin.marginPct !== null ? ` (${fmtAmount(margin.marginPct)}%)` : ''}
            </Badge>
          </div>
          {margin.forwarding && (
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <span className="muted">{t('transport.carrier.margin.forwardingTitle')}:</span>
              <Badge tone={Number(margin.forwarding.margin) >= 0 ? 'green' : 'red'}>
                {fmtAmount(margin.forwarding.margin)}
                {margin.forwarding.marginPct !== null ? ` (${fmtAmount(margin.forwarding.marginPct)}%)` : ''}
              </Badge>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function carrierFields(c: FleetTripCarrier | null) {
  return {
    carrierCompanyId: c?.carrierCompanyId ?? '',
    rate: c?.rate ?? '',
    vehiclePlate: c?.vehiclePlate ?? '',
    vehicleModel: c?.vehicleModel ?? '',
    driverName: c?.driverName ?? '',
    driverPhone: c?.driverPhone ?? '',
    driverLicense: c?.driverLicense ?? '',
    contractNumber: c?.contractNumber ?? '',
    contractDate: c?.contractDate ?? '',
    comment: c?.comment ?? '',
  };
}
