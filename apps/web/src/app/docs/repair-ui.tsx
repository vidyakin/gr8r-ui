/* Изделие в ремонте и материалы заказчика в карточке заказ-наряда (задача 1099). Изделие принадлежит клиенту:
   склад и остатки оно не меняет. При вводе серийного номера показывается проверка гарантии и, если она действует,
   предложение перевести заказ-наряд в гарантийный вид. */
import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, X } from 'lucide-react';
import { Button, Field, IconButton, Input, Select, Textarea, toast } from '@/components/ui';
import { DateInput } from '@/components/gr8r/date-picker';
import { useT } from '@/i18n';
import { useCompanies, useProduct } from '../catalog/data';
import { fmtDate, parse } from '../lib/dates';
import { useWsId } from '../meta/data';
import { ProductField } from './position-field';
import { docsKey, useDocsApi, useWorkOrderKinds, type DocDetail } from './data';
import { useCustomerMaterials, useRepairItem, useSerialLookup, type CustomerMaterial } from './serials-data';

const NONE = '__none__';

/** Выбор товара в карточке: название берём из каталога по id */
function GoodsPick({ id, onChange, disabled, label, placeholder, clearLabel }: { id: string | null | undefined; onChange: (id: string | null) => void; disabled?: boolean; label: string; placeholder: string; clearLabel: string }) {
  const product = useProduct(id || undefined);
  const [picked, setPicked] = React.useState('');
  return (
    <div className="flex items-center min-w-0" style={{ gap: 2 }}>
      <ProductField className="grow" id={id} name={(id && (product.data?.name ?? picked)) || ''} productKind="goods" disabled={disabled} aria-label={label} placeholder={placeholder} onPick={p => (setPicked(p.name), onChange(p.id))} />
      {!disabled && id && (
        <IconButton size="xs" label={clearLabel} onClick={() => onChange(null)}>
          <X size={13} />
        </IconButton>
      )}
    </div>
  );
}

export function RepairItemPanel({ doc, editable }: { doc: DocDetail; editable: boolean }) {
  const t = useT();
  const ws = useWsId();
  const qc = useQueryClient();
  const api = useDocsApi();
  const item = useRepairItem(doc.id, true);
  const kinds = useWorkOrderKinds();
  const companies = useCompanies();
  const [f, setF] = React.useState({ productId: '', name: '', serialText: '', defect: '', completeness: '', appearance: '', receivedAt: '', returnedAt: '', outsourceCompanyId: '', outsourcedAt: '', outsourceReturnedAt: '' });
  const [loaded, setLoaded] = React.useState(false);
  React.useEffect(() => {
    if (item.isPending || loaded) return;
    const r = item.data;
    setF({ productId: r?.productId ?? '', name: r?.name ?? '', serialText: r?.serialText ?? '', defect: r?.defect ?? '', completeness: r?.completeness ?? '', appearance: r?.appearance ?? '', receivedAt: r?.receivedAt ?? doc.date, returnedAt: r?.returnedAt ?? '', outsourceCompanyId: r?.outsourceCompanyId ?? '', outsourcedAt: r?.outsourcedAt ?? '', outsourceReturnedAt: r?.outsourceReturnedAt ?? '' });
    setLoaded(true);
  }, [item.isPending, item.data, loaded, doc.date]);

  // проверка гарантии по введённому номеру (с паузой)
  const [serialQ, setSerialQ] = React.useState('');
  React.useEffect(() => {
    const h = setTimeout(() => setSerialQ(f.serialText.trim()), 300);
    return () => clearTimeout(h);
  }, [f.serialText]);
  const lookup = useSerialLookup(serialQ);
  const hit = (lookup.data ?? []).find(h => !f.productId || h.productId === f.productId) ?? null;
  const warrantyKind = (kinds.data ?? []).find(k => k.kindType === 'warranty');
  const set = (patch: Partial<typeof f>) => setF(prev => ({ ...prev, ...patch }));

  const save = async () => {
    const r = await api('PUT', `/work-orders/${doc.id}/repair`, {
      productId: f.productId || (hit?.productId ?? null),
      name: f.name,
      serialText: f.serialText,
      defect: f.defect,
      completeness: f.completeness,
      appearance: f.appearance,
      receivedAt: f.receivedAt || null,
      returnedAt: f.returnedAt || null,
      outsourceCompanyId: f.outsourceCompanyId || null,
      outsourcedAt: f.outsourcedAt || null,
      outsourceReturnedAt: f.outsourceReturnedAt || null,
    });
    if (r) {
      toast(t('serials.repair.saved'));
      void qc.invalidateQueries({ queryKey: docsKey(ws, 'repair-item', doc.id) });
    }
  };
  const switchToWarranty = async () => {
    if (!warrantyKind) return;
    const r = await api('PATCH', `/documents/${doc.id}`, { workOrderKindId: warrantyKind.id });
    if (r) void qc.invalidateQueries({ queryKey: docsKey(ws, 'doc', doc.id) });
  };

  return (
    <section className="doc-links panel" aria-label={t('serials.repair.title')} style={{ display: 'grid', gap: 12, padding: 12 }}>
      <p className="faint" style={{ margin: 0 }}>{t('serials.repair.lead')}</p>
      {doc.kindType === 'warranty' && <p style={{ margin: 0 }}>{t('serials.repair.warrantyNoRevenue')}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        <Field label={t('serials.repair.product')}>
          {() => (
            <GoodsPick id={f.productId} disabled={!editable} label={t('serials.repair.product')} placeholder={t('serials.repair.productPlaceholder')} clearLabel={t('serials.repair.productClear')} onChange={v => set({ productId: v ?? '' })} />
          )}
        </Field>
        <Field label={t('serials.repair.name')}>{p => <Input id={p.id} disabled={!editable} value={f.name} placeholder={t('serials.repair.namePlaceholder')} onChange={e => set({ name: e.target.value })} />}</Field>
        <Field label={t('serials.repair.serial')}>{p => <Input id={p.id} className="mono" disabled={!editable} value={f.serialText} placeholder={t('serials.repair.serialPlaceholder')} onChange={e => set({ serialText: e.target.value })} />}</Field>
        <Field label={t('serials.repair.receivedAt')}>{p => <DateInput id={p.id} disabled={!editable} value={f.receivedAt} onChange={v => set({ receivedAt: v })} />}</Field>
        <Field label={t('serials.repair.returnedAt')}>{p => <DateInput id={p.id} disabled={!editable} value={f.returnedAt} onChange={v => set({ returnedAt: v })} />}</Field>
      </div>
      {serialQ && lookup.data && (
        <div role="status" className="panel" style={{ padding: 10 }} data-testid="warranty-hint">
          <strong>{t('serials.repair.checkWarranty')}: </strong>
          {!hit ? (
            t('serials.repair.notRegistered')
          ) : hit.status === 'sold' && hit.warrantyUntil ? (
            t(hit.warrantyActive ? 'serials.repair.warrantyOk' : 'serials.repair.warrantyExpired', { name: hit.ownerName ?? '—', date: hit.soldAt ? fmtDate(parse(hit.soldAt)) : '—', until: fmtDate(parse(hit.warrantyUntil)) })
          ) : (
            t('serials.repair.warrantyUnknown')
          )}
          {hit?.warrantyActive && doc.kindType !== 'warranty' && warrantyKind && editable && (
            <div style={{ marginTop: 6 }}>
              <span className="muted">{t('serials.repair.suggestWarranty')} </span>
              <Button size="sm" onClick={() => void switchToWarranty()}>
                {t('serials.repair.switchWarranty')}
              </Button>
            </div>
          )}
        </div>
      )}
      <Field label={t('serials.repair.defect')}>{p => <Textarea id={p.id} rows={2} disabled={!editable} value={f.defect} onChange={e => set({ defect: e.target.value })} />}</Field>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <Field label={t('serials.repair.completeness')}>{p => <Textarea id={p.id} rows={2} disabled={!editable} value={f.completeness} onChange={e => set({ completeness: e.target.value })} />}</Field>
        <Field label={t('serials.repair.appearance')}>{p => <Textarea id={p.id} rows={2} disabled={!editable} value={f.appearance} onChange={e => set({ appearance: e.target.value })} />}</Field>
      </div>
      <h3 style={{ margin: 0 }}>{t('serials.repair.outsource')}</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <Field label={t('serials.repair.outsourceCompany')}>
          {p => (
            <Select
              id={p.id}
              disabled={!editable}
              value={f.outsourceCompanyId || NONE}
              onValueChange={v => set({ outsourceCompanyId: v === NONE ? '' : v })}
              options={[{ value: NONE, label: t('serials.repair.none') }, ...(companies.data ?? []).map(c => ({ value: c.id, label: c.name }))]}
            />
          )}
        </Field>
        <Field label={t('serials.repair.outsourcedAt')}>{p => <DateInput id={p.id} disabled={!editable} value={f.outsourcedAt} onChange={v => set({ outsourcedAt: v })} />}</Field>
        <Field label={t('serials.repair.outsourceReturnedAt')}>{p => <DateInput id={p.id} disabled={!editable} value={f.outsourceReturnedAt} onChange={v => set({ outsourceReturnedAt: v })} />}</Field>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {editable && (
          <Button variant="primary" onClick={() => void save()}>
            {t('serials.repair.save')}
          </Button>
        )}
        <a className="btn" href={`/documents/${doc.id}/print/repair_receipt`}>
          {t('serials.repair.printReceipt')}
        </a>
        <a className="btn" href={`/documents/${doc.id}/print/repair_return`}>
          {t('serials.repair.printReturn')}
        </a>
      </div>
    </section>
  );
}

/** Материалы заказчика: что клиент принёс (номенклатура или текст), информационно */
export function CustomerMaterialsPanel({ doc, editable }: { doc: DocDetail; editable: boolean }) {
  const t = useT();
  const ws = useWsId();
  const api = useDocsApi();
  const qc = useQueryClient();
  const list = useCustomerMaterials(doc.id);
  const [rows, setRows] = React.useState<Partial<CustomerMaterial>[] | null>(null);
  const current = rows ?? list.data ?? [];
  const patch = (i: number, p: Partial<CustomerMaterial>) => setRows(current.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const save = async () => {
    const r = await api('PUT', `/work-orders/${doc.id}/customer-materials`, { materials: current.map(m => ({ id: m.id, productId: m.productId ?? null, name: m.name ?? '', qty: m.qty || '1', comment: m.comment ?? '' })) });
    if (r) {
      toast(t('serials.customerMaterials.saved'));
      setRows(null);
      void qc.invalidateQueries({ queryKey: docsKey(ws, 'customer-materials', doc.id) });
    }
  };
  return (
    <section className="doc-lines panel" aria-label={t('serials.customerMaterials.title')}>
      <p className="faint" style={{ margin: '0 0 8px' }}>{t('serials.customerMaterials.lead')}</p>
      <div className="table-wrap">
        <table className="dtbl" aria-label={t('serials.customerMaterials.title')}>
          <thead>
            <tr>
              <th style={{ width: 240 }}>{t('serials.customerMaterials.product')}</th>
              <th>{t('serials.customerMaterials.name')}</th>
              <th style={{ width: 90 }} className="r">{t('serials.customerMaterials.qty')}</th>
              <th>{t('serials.customerMaterials.comment')}</th>
              <th style={{ width: 36 }} />
            </tr>
          </thead>
          <tbody>
            {current.map((m, i) => (
              <tr key={m.id ?? `new-${i}`}>
                <td>
                  <GoodsPick id={m.productId} disabled={!editable} label={t('serials.customerMaterials.product')} placeholder={t('serials.customerMaterials.productPlaceholder')} clearLabel={t('serials.repair.productClear')} onChange={v => patch(i, { productId: v })} />
                </td>
                <td><Input aria-label={t('serials.customerMaterials.name')} disabled={!editable} value={m.name ?? ''} onChange={e => patch(i, { name: e.target.value })} /></td>
                <td><Input aria-label={t('serials.customerMaterials.qty')} className="num" inputMode="decimal" disabled={!editable} value={m.qty ?? '1'} onChange={e => patch(i, { qty: e.target.value })} /></td>
                <td><Input aria-label={t('serials.customerMaterials.comment')} disabled={!editable} value={m.comment ?? ''} onChange={e => patch(i, { comment: e.target.value })} /></td>
                <td>
                  {editable && (
                    <IconButton size="xs" label={t('serials.customerMaterials.remove')} onClick={() => setRows(current.filter((_, k) => k !== i))}>
                      <Trash2 size={13} />
                    </IconButton>
                  )}
                </td>
              </tr>
            ))}
            {!current.length && (
              <tr>
                <td colSpan={5} className="faint" style={{ textAlign: 'center', padding: 18 }}>{t('serials.customerMaterials.empty')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editable && (
        <div className="doc-add">
          <Button size="sm" variant="ghost" onClick={() => setRows([...current, { name: '', qty: '1', comment: '', productId: null }])}>
            <Plus size={13} />
            {t('serials.customerMaterials.add')}
          </Button>
          <Button size="sm" variant="primary" onClick={() => void save()}>
            {t('serials.customerMaterials.save')}
          </Button>
        </div>
      )}
    </section>
  );
}
