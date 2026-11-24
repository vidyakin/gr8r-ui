/* Диалог создания/редактирования взвешивания с живым расчётом нетто (т) и объёма (м³) по насыпной плотности */
import * as React from 'react';
import type { WeighingDirection } from '@erp/shared';
import { Button, Dialog, DialogContent, Field, Input, Segmented, Select, Textarea } from '@/components/ui';
import { fmtNumber, useT } from '@/i18n';
import { useCompanies, useProducts } from '../catalog/data';
import { useVehicles } from '../fleet/data';
import { fromLocalInput, toLocalInput } from '../fleet/parts';
import { useWeighingActions, type Weighing } from './data';

const NONE = 'none';

export function WeighingDialog({ item, onClose }: { item: Weighing | null; onClose: () => void }) {
  const t = useT();
  const actions = useWeighingActions();
  const vehicles = useVehicles().data?.items ?? [];
  const companies = useCompanies().data ?? [];
  const products = useProducts({ active: true }).data ?? [];

  const [direction, setDirection] = React.useState<WeighingDirection>(item?.direction ?? 'out');
  const [weighedAt, setWeighedAt] = React.useState(() => toLocalInput(item?.weighedAt) || toLocalInput(new Date().toISOString()));
  const [vehicleId, setVehicleId] = React.useState(item?.vehicleId ?? NONE);
  const [plateNumber, setPlateNumber] = React.useState(item?.plateNumber ?? '');
  const [driverName, setDriverName] = React.useState(item?.driverName ?? '');
  const [counterpartyId, setCounterpartyId] = React.useState(item?.counterpartyId ?? NONE);
  const [productId, setProductId] = React.useState(item?.productId ?? NONE);
  const [grossKg, setGrossKg] = React.useState(item ? String(Number(item.grossKg)) : '');
  const [tareKg, setTareKg] = React.useState(item ? String(Number(item.tareKg)) : '');
  const [bulkDensity, setBulkDensity] = React.useState(item?.bulkDensity ? String(Number(item.bulkDensity)) : '');
  const [waybillNumber, setWaybillNumber] = React.useState(item?.waybillNumber ?? '');
  const [notes, setNotes] = React.useState(item?.notes ?? '');
  const [busy, setBusy] = React.useState(false);

  const gross = Number(grossKg) || 0;
  const tare = Number(tareKg) || 0;
  const netKg = Math.max(0, gross - tare);
  const netT = netKg / 1000;
  const density = Number(bulkDensity) || 0;
  const volumeM3 = density > 0 ? netT / density : null;
  const valid = grossKg.trim() !== '' && tareKg.trim() !== '' && gross >= tare && tare >= 0;

  const onVehicleChange = (id: string) => {
    setVehicleId(id);
    const v = vehicles.find(x => x.id === id);
    if (v && !plateNumber.trim()) setPlateNumber(v.plate);
    if (v?.driverName && !driverName.trim()) setDriverName(v.driverName);
  };

  const onProductChange = (id: string) => {
    setProductId(id);
    const p = products.find(x => x.id === id);
    if (p?.bulkDensity) setBulkDensity(String(Number(p.bulkDensity)));
  };

  const submit = async () => {
    setBusy(true);
    try {
      const payload = {
        direction,
        weighedAt: fromLocalInput(weighedAt) ?? new Date().toISOString(),
        vehicleId: vehicleId === NONE ? null : vehicleId,
        plateNumber: plateNumber.trim(),
        driverName: driverName.trim(),
        counterpartyId: counterpartyId === NONE ? null : counterpartyId,
        productId: productId === NONE ? null : productId,
        grossKg: gross,
        tareKg: tare,
        bulkDensity: density > 0 ? density : null,
        waybillNumber: waybillNumber.trim(),
        notes: notes.trim(),
      };
      const res = item ? await actions.update(item.id, payload) : await actions.create(payload);
      if (res) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={item ? `${t('mining.edit')} ${item.number}` : t('mining.new')}
        size="lg"
        footer={
          <>
            {item && (
              <Button variant="ghost" disabled={busy} onClick={async () => { if (await actions.remove(item.id)) onClose(); }}>
                {t('mining.delete')}
              </Button>
            )}
            <span className="sp" />
            <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
            <Button disabled={!valid || busy} onClick={submit}>{t('common.save')}</Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label={t('mining.col.direction')}>
              {() => (
                <Segmented
                  value={direction}
                  onValueChange={setDirection}
                  items={[
                    { value: 'out', label: t('mining.direction.out') },
                    { value: 'in', label: t('mining.direction.in') },
                  ]}
                />
              )}
            </Field>
            <Field label={t('mining.col.date')}>
              {p => <Input {...p} type="datetime-local" value={weighedAt} onChange={e => setWeighedAt(e.target.value)} />}
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
            <Field label={t('mining.col.vehicle')}>
              {p => <Select id={p.id} value={vehicleId} onValueChange={onVehicleChange} options={[{ value: NONE, label: t('mining.form.none') }, ...vehicles.map(v => ({ value: v.id, label: `${v.plate} ${v.name}`.trim() }))]} />}
            </Field>
            <Field label={t('mining.form.plate')}>
              {p => <Input {...p} value={plateNumber} onChange={e => setPlateNumber(e.target.value)} />}
            </Field>
            <Field label={t('mining.form.driver')}>
              {p => <Input {...p} value={driverName} onChange={e => setDriverName(e.target.value)} />}
            </Field>
            <Field label={t('mining.col.counterparty')}>
              {p => <Select id={p.id} value={counterpartyId} onValueChange={setCounterpartyId} options={[{ value: NONE, label: t('mining.form.none') }, ...companies.map(c => ({ value: c.id, label: c.name }))]} />}
            </Field>
            <Field label={t('mining.col.product')}>
              {p => <Select id={p.id} value={productId} onValueChange={onProductChange} options={[{ value: NONE, label: t('mining.form.none') }, ...products.map(pr => ({ value: pr.id, label: pr.name }))]} />}
            </Field>
            <Field label={t('mining.col.waybill')}>
              {p => <Input {...p} value={waybillNumber} onChange={e => setWaybillNumber(e.target.value)} />}
            </Field>
            <Field label={t('mining.col.gross')}>
              {p => <Input {...p} type="number" min={0} step="any" value={grossKg} onChange={e => setGrossKg(e.target.value)} />}
            </Field>
            <Field label={t('mining.col.tare')}>
              {p => <Input {...p} type="number" min={0} step="any" value={tareKg} onChange={e => setTareKg(e.target.value)} />}
            </Field>
            <Field label={t('mining.form.density')}>
              {p => <Input {...p} type="number" min={0} step="0.001" value={bulkDensity} onChange={e => setBulkDensity(e.target.value)} />}
            </Field>
          </div>
          <div className="panel plain row" style={{ gap: 20, padding: '10px 14px', flexWrap: 'wrap' }}>
            <div>
              <span className="muted">{t('mining.form.calcNet')}: </span>
              <b className="num">{fmtNumber(netT, { maximumFractionDigits: 3 })} {t('mining.unit.t')}</b>
              <span className="muted num"> ({fmtNumber(netKg)} {t('mining.unit.kg')})</span>
            </div>
            <div>
              <span className="muted">{t('mining.form.calcVolume')}: </span>
              {volumeM3 !== null ? (
                <b className="num">{fmtNumber(volumeM3, { maximumFractionDigits: 3 })} {t('mining.unit.m3')}</b>
              ) : (
                <span className="muted">{t('mining.form.noDensity')}</span>
              )}
            </div>
          </div>
          <Field label={t('mining.form.notes')}>
            {p => <Textarea {...p} rows={2} value={notes} onChange={e => setNotes(e.target.value)} />}
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
