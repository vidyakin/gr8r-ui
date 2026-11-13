import * as React from 'react';
import { MANUFACTURED_KINDS } from '@gr8r/shared';
import { Button, Checkbox, Dialog, DialogClose, DialogContent, Field, Input, Segmented, toast } from '@/components/ui';
import { t, tEnum } from '@/i18n';
import { parseNumber } from '@/i18n/format';
import { UnitSelect } from '../catalog/product-ui';
import { useProductionMutations, type Item } from './data';
import { useCreateProductFor } from './item-product';

const KIND_LABEL = { product: 'Product', semi: 'Semi-finished' } as const;
const kindLabel = (k: keyof typeof KIND_LABEL) => tEnum('productionKind', k, KIND_LABEL[k]);

export function NewItemDialog({ initialName = '', initialUnitCode = '796', onClose, onCreated }: { initialName?: string; initialUnitCode?: string; onClose: () => void; onCreated: (i: Item) => void }) {
  const m = useProductionMutations();
  const [kind, setKind] = React.useState<'product' | 'semi'>('product');
  const [name, setName] = React.useState(initialName);
  const [code, setCode] = React.useState('');
  const [unitCode, setUnitCode] = React.useState(initialUnitCode);
  const [batch, setBatch] = React.useState('1');
  const [overhead, setOverhead] = React.useState('0');
  // товар каталога нужен для выпуска на склад и продажи; полуфабрикату — только если он хранится на складе
  const [withProduct, setWithProduct] = React.useState(true);
  const createProduct = useCreateProductFor();
  const [err, setErr] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = t('common.enterName');
    if (!(parseNumber(batch) > 0)) errs.batch = t('common.required');
    if (!(parseNumber(overhead) >= 0)) errs.overhead = t('catalog.product.nonNegative');
    setErr(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const product = withProduct ? await createProduct({ name: name.trim(), code: code.trim(), unitCode }) : null;
      const row = await m.createItem.mutateAsync({ name: name.trim(), code: code.trim(), kind, unitCode, batchQty: parseNumber(batch), overheadPct: parseNumber(overhead), productId: product?.id ?? null });
      toast(t('catalog.product.added', { name: row.name }));
      onCreated(row);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={t('production.list.newProduct')}
        description={t('production.item.bomEmptyHint')}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">{t('production.common.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              {t('production.common.create')}
            </Button>
          </>
        }
      >
        <form
          className="contents"
          noValidate
          onSubmit={e => {
            e.preventDefault();
            void submit();
          }}
        >
          <Segmented aria-label={t('production.field.type')} value={kind} onValueChange={k => (setKind(k), setWithProduct(k === 'product'))} items={MANUFACTURED_KINDS.map(k => ({ value: k, label: kindLabel(k) }))} />
          <Field label={t('production.field.name')} error={err.name}>
            {p => <Input {...p} autoFocus value={name} onChange={e => (setName(e.target.value), setErr({}))} />}
          </Field>
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <Field label={t('production.field.code')} className="grow">
              {p => <Input {...p} value={code} onChange={e => setCode(e.target.value)} />}
            </Field>
            <Field label={t('production.field.unit')} className="grow">
              {p => <UnitSelect value={unitCode} onChange={setUnitCode} id={p.id} />}
            </Field>
          </div>
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <Field label={t('production.item.batch')} className="grow" error={err.batch}>
              {p => <Input {...p} inputMode="decimal" value={batch} onChange={e => setBatch(e.target.value)} />}
            </Field>
            <Field label="Overhead, %" className="grow" error={err.overhead}>
              {p => <Input {...p} inputMode="decimal" value={overhead} onChange={e => setOverhead(e.target.value)} />}
            </Field>
          </div>
          <label className="row" style={{ gap: 8 }}>
            <Checkbox checked={withProduct} onChange={e => setWithProduct(e.currentTarget.checked)} />
            <span>{t('production.item.createProductToo')}</span>
          </label>
          <span className="faint" style={{ fontSize: 12 }}>{t('production.item.createProductHint')}</span>
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}
