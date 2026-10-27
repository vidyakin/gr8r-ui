/* Settings → Delivery methods (задача 1100): справочник способов доставки с тарифами (admin и owner правят) и отметка «курьер»
   у участников. Цена и себестоимость считаются по тарифу: база + за км + за кг, не меньше минимума; бесплатно от суммы документа. */
import * as React from 'react';
import { Plus, Truck } from 'lucide-react';
import { DELIVERY_KINDS, type DeliveryKind, type DeliveryRateInput } from '@gr8r/shared';
import { Alert, Badge, Button, EmptyState, Field, Input, Select, Skeleton, Switch, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { useIsAdmin } from '../catalog/data';
import { useDocsApi } from '../docs/data';
import { useCouriers, useDeliveryMethods, type DeliveryMethod } from '../docs/delivery-data';
import { useProducts } from '../catalog/data';
import { CounterpartyPicker } from '../docs/pickers';
import { SettingsHead, SRow } from './parts';

const NONE = 'none';
const RATE_KEYS = ['base', 'perKm', 'perKg', 'min'] as const;

interface Draft {
  name: string;
  kind: DeliveryKind;
  productId: string;
  carrierCompanyId: string;
  carrierName: string;
  clientRate: DeliveryRateInput;
  costRate: DeliveryRateInput;
  freeFrom: string;
}

const emptyRate = (): DeliveryRateInput => ({ base: '0', perKm: '0', perKg: '0', min: '0' });
const blank = (): Draft => ({ name: '', kind: 'own_courier', productId: NONE, carrierCompanyId: '', carrierName: '', clientRate: emptyRate(), costRate: emptyRate(), freeFrom: '' });
const fromMethod = (m: DeliveryMethod): Draft => ({ name: m.name, kind: m.kind, productId: m.productId ?? NONE, carrierCompanyId: m.carrierCompanyId ?? '', carrierName: m.carrierName ?? '', clientRate: m.clientRate, costRate: m.costRate, freeFrom: m.freeFrom ?? '' });

function MethodForm({ draft, onChange, disabled }: { draft: Draft; onChange: (d: Draft) => void; disabled: boolean }) {
  const t = useT();
  const products = useProducts({ kind: 'service' });
  const rate = (which: 'clientRate' | 'costRate', title: string) => (
    <div>
      <div className="label" style={{ marginBottom: 4 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(70px, 1fr))', gap: 8 }}>
        {RATE_KEYS.map(k => (
          <Field key={k} label={t(`delivery.settings.${k}`)}>
            {p => <Input {...p} inputMode="decimal" disabled={disabled} value={draft[which][k]} onChange={e => onChange({ ...draft, [which]: { ...draft[which], [k]: e.target.value } })} />}
          </Field>
        ))}
      </div>
    </div>
  );
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        <Field label={t('delivery.settings.name')}>{p => <Input {...p} disabled={disabled} value={draft.name} onChange={e => onChange({ ...draft, name: e.target.value })} />}</Field>
        <Field label={t('delivery.settings.kind')}>
          {p => <Select id={p.id} disabled={disabled} value={draft.kind} onValueChange={v => onChange({ ...draft, kind: v as DeliveryKind })} aria-label={t('delivery.settings.kind')} options={DELIVERY_KINDS.map(k => ({ value: k, label: t(`delivery.kind.${k}`) }))} />}
        </Field>
        <Field label={t('delivery.settings.service')}>
          {p => <Select id={p.id} disabled={disabled} value={draft.productId} onValueChange={v => onChange({ ...draft, productId: v })} aria-label={t('delivery.settings.service')} options={[{ value: NONE, label: t('delivery.settings.noService') }, ...((products.data ?? []).map(x => ({ value: x.id, label: x.name })))]} />}
        </Field>
        {draft.kind !== 'own_courier' && (
          <Field label={t('delivery.settings.carrier')}>
            {p => <CounterpartyPicker id={p.id} disabled={disabled} value={draft.carrierName} placeholder={t('delivery.settings.noCarrier')} onPick={c => onChange({ ...draft, carrierCompanyId: c.id, carrierName: c.name })} />}
          </Field>
        )}
        <Field label={t('delivery.settings.freeFrom')} hint={t('delivery.settings.freeHint')}>{p => <Input {...p} inputMode="decimal" disabled={disabled} value={draft.freeFrom} onChange={e => onChange({ ...draft, freeFrom: e.target.value })} />}</Field>
      </div>
      {rate('clientRate', t('delivery.settings.clientRate'))}
      {rate('costRate', t('delivery.settings.costRate'))}
    </div>
  );
}

const body = (d: Draft) => ({
  name: d.name.trim(),
  kind: d.kind,
  productId: d.productId === NONE ? null : d.productId,
  carrierCompanyId: d.kind === 'own_courier' ? null : d.carrierCompanyId || null,
  clientRate: d.clientRate,
  costRate: d.costRate,
  freeFrom: d.freeFrom.trim() === '' ? null : d.freeFrom,
});

export function DeliveryMethodsSection({ title }: { title: string }) {
  const t = useT();
  const isAdmin = useIsAdmin();
  const api = useDocsApi();
  const [showArchived, setShowArchived] = React.useState(false);
  const methods = useDeliveryMethods(showArchived ? 'include' : 'exclude');
  const couriers = useCouriers();
  const [open, setOpen] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Draft>(blank());
  const [adding, setAdding] = React.useState(false);

  return (
    <>
      <SettingsHead title={title} lead={t('delivery.settings.lead')} />
      {!isAdmin && (
        <Alert tone="info" className="mb-3">
          {t('delivery.settings.onlyAdmins')}
        </Alert>
      )}
      <div className="sblock">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <label className="row" style={{ gap: 6, fontSize: 12 }}>
              <Switch checked={showArchived} aria-label={t('delivery.settings.showArchived')} onChange={e => setShowArchived(e.target.checked)} />
              {t('delivery.settings.showArchived')}
            </label>
            {isAdmin && (
              <Button size="sm" variant="ghost" onClick={() => { setAdding(true); setOpen(null); setDraft(blank()); }}>
                <Plus size={13} />
                {t('delivery.settings.add')}
              </Button>
            )}
          </div>
        </div>
        {methods.isPending ? (
          <Skeleton w="100%" h={60} />
        ) : !(methods.data ?? []).length && !adding ? (
          <EmptyState icon={<Truck size={20} />} title={t('delivery.settings.empty')}>
            {t('delivery.settings.emptyHint')}
          </EmptyState>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {adding && (
              <div className="srow" style={{ display: 'block' }}>
                <MethodForm draft={draft} onChange={setDraft} disabled={false} />
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <Button
                    size="sm"
                    disabled={!draft.name.trim()}
                    onClick={async () => {
                      const r = await api('POST', '/delivery-methods', body(draft));
                      if (r) {
                        toast(t('delivery.settings.saved'));
                        setAdding(false);
                      }
                    }}
                  >
                    {t('delivery.settings.save')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                    {t('delivery.mine.cancel')}
                  </Button>
                </div>
              </div>
            )}
            {(methods.data ?? []).map(m => (
              <div key={m.id} className="srow" style={{ display: 'block' }}>
                <SRow
                  t={
                    <>
                      {m.name} {m.archivedAt && <Badge>{t('delivery.settings.archived')}</Badge>}
                    </>
                  }
                  d={`${t(`delivery.kind.${m.kind}`)}${m.productName ? ` · ${m.productName}` : ''}`}
                >
                  <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setOpen(open === m.id ? null : m.id); setDraft(fromMethod(m)); }}>
                    {open === m.id ? t('delivery.mine.cancel') : t('delivery.settings.name')}
                  </Button>
                  {isAdmin && (
                    <Button size="sm" variant="ghost" onClick={() => void api('POST', `/delivery-methods/${m.id}/${m.archivedAt ? 'restore' : 'archive'}`)}>
                      {m.archivedAt ? t('delivery.settings.restore') : t('delivery.settings.archive')}
                    </Button>
                  )}
                </SRow>
                {open === m.id && (
                  <div style={{ marginTop: 8 }}>
                    <MethodForm draft={draft} onChange={setDraft} disabled={!isAdmin} />
                    {isAdmin && (
                      <Button
                        size="sm"
                        style={{ marginTop: 8 }}
                        disabled={!draft.name.trim()}
                        onClick={async () => {
                          const r = await api('PATCH', `/delivery-methods/${m.id}`, body(draft));
                          if (r) {
                            toast(t('delivery.settings.saved'));
                            setOpen(null);
                          }
                        }}
                      >
                        {t('delivery.settings.save')}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="sblock">
        <h2>{t('delivery.settings.couriers')}</h2>
        <p className="faint" style={{ fontSize: 12 }}>{t('delivery.settings.couriersLead')}</p>
        <div className="stack" style={{ gap: 8 }}>
          {(couriers.data ?? []).map(c => (
            <SRow key={c.id} t={c.name}>
              <label className="row" style={{ gap: 6, fontSize: 12 }}>
                <Switch checked={c.isCourier} disabled={!isAdmin} aria-label={`${t('delivery.settings.isCourier')}: ${c.name}`} onChange={e => void api('PUT', `/deliveries/couriers/${c.id}`, { isCourier: e.target.checked })} />
                {t('delivery.settings.isCourier')}
              </label>
            </SRow>
          ))}
        </div>
      </div>
    </>
  );
}
