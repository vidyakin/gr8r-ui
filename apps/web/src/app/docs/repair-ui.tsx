/* Изделие в ремонте и материалы заказчика в карточке заказ-наряда (задача 1099). Изделие принадлежит клиенту:
   склад и остатки оно не меняет. При вводе серийного номера показывается проверка гарантии и, если она действует,
   предложение перевести заказ-наряд в гарантийный вид. */
import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Field, IconButton, Input, Select, Textarea, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { useCompanies } from '../catalog/data';
import { fmtDate, parse } from '../lib/dates';
import { call, useWsId } from '../meta/data';
import { docsKey, useDocsApi, useWorkOrderKinds, type DocDetail } from './data';
import { useCustomerMaterials, useRepairItem, useSerialLookup, type CustomerMaterial } from './serials-data';

const NONE = '__none__';

export function RepairItemPanel({ doc, editable }: { doc: DocDetail; editable: boolean }) {
  const t = useT();
  const ws = useWsId();
  const qc = useQueryClient();
  const api = useDocsApi();
  const item = useRepairItem(doc.id, true);
  const kinds = useWorkOrderKinds();
  const companies = useCompanies();
  const [products, setProducts] = React.useState<{ id: string; name: string }[]>([]);
  const [f, setF] = React.useState({ productId: '', name: '', serialText: '', defect: '', completeness: '', appearance: '', receivedAt: '', returnedAt: '', outsourceCompanyId: '', outsourcedAt: '', outsourceReturnedAt: '' });
  const [loaded, setLoaded] = React.useState(false);
  React.useEffect(() => {
    if (item.isPending || loaded) return;
    const r = item.data;
    setF({ productId: r?.productId ?? '', name: r?.name ?? '', serialText: r?.serialText ?? '', defect: r?.defect ?? '', completeness: r?.completeness ?? '', appearance: r?.appearance ?? '', receivedAt: r?.receivedAt ?? doc.date, returnedAt: r?.returnedAt ?? '', outsourceCompanyId: r?.outsourceCompanyId ?? '', outsourcedAt: r?.outsourcedAt ?? '', outsourceReturnedAt: r?.outsourceReturnedAt ?? '' });
    setLoaded(true);
  }, [item.isPending, item.data, loaded, doc.date]);
  React.useEffect(() => {
    let alive = true;
    void call<{ items: { id: string; name: string }[] }>(ws, 'GET', '/products?kind=goods&active=true&limit=200').then(r => alive && setProducts(r.items));
    return () => {
      alive = false;
    };
  }, [ws]);

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
          {p => (
            <Select
              id={p.id}
              disabled={!editable}
              value={f.productId || NONE}
              onValueChange={v => set({ productId: v === NONE ? '' : v })}
              options={[{ value: NONE, label: t('serials.repair.productPlaceholder') }, ...products.map(x => ({ value: x.id, label: x.name }))]}
            />
          )}
        </Field>
        <Field label={t('serials.repair.name')}>{p => <Input id={p.id} disabled={!editable} value={f.name} placeholder={t('serials.repair.namePlaceholder')} onChange={e => set({ name: e.target.value })} />}</Field>
        <Field label={t('serials.repair.serial')}>{p => <Input id={p.id} className="mono" disabled={!editable} value={f.serialText} placeholder={t('serials.repair.serialPlaceholder')} onChange={e => set({ serialText: e.target.value })} />}</Field>
        <Field label={t('serials.repair.receivedAt')}>{p => <Input id={p.id} type="date" disabled={!editable} value={f.receivedAt} onChange={e => set({ receivedAt: e.target.value })} />}</Field>
        <Field label={t('serials.repair.returnedAt')}>{p => <Input id={p.id} type="date" disabled={!editable} value={f.returnedAt} onChange={e => set({ returnedAt: e.target.value })} />}</Field>
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
        <Field label={t('serials.repair.outsourcedAt')}>{p => <Input id={p.id} type="date" disabled={!editable} value={f.outsourcedAt} onChange={e => set({ outsourcedAt: e.target.value })} />}</Field>
        <Field label={t('serials.repair.outsourceReturnedAt')}>{p => <Input id={p.id} type="date" disabled={!editable} value={f.outsourceReturnedAt} onChange={e => set({ outsourceReturnedAt: e.target.value })} />}</Field>
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
  const [products, setProducts] = React.useState<{ id: string; name: string }[]>([]);
  React.useEffect(() => {
    let alive = true;
    void call<{ items: { id: string; name: string }[] }>(ws, 'GET', '/products?active=true&limit=200').then(r => alive && setProducts(r.items));
    return () => {
      alive = false;
    };
  }, [ws]);
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
                  <Select
                    aria-label={t('serials.customerMaterials.product')}
                    disabled={!editable}
                    value={m.productId ?? NONE}
                    onValueChange={v => patch(i, { productId: v === NONE ? null : v })}
                    options={[{ value: NONE, label: t('serials.customerMaterials.productPlaceholder') }, ...products.map(x => ({ value: x.id, label: x.name }))]}
                  />
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
