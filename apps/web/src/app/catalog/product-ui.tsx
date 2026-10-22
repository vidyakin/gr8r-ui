/* Карточка товара (EntityDrawer) и форма создания. Характеристики категории рисуются теми же FieldInput / FieldValue и
   проверяются той же zod-схемой (validateRecord), что и поля конструктора. */
import * as React from 'react';
import { Barcode, CircleAlert, CircleDollarSign, FolderTree, Hash, Package, Percent, Power, Ruler, Tag, Timer, Trash2, Wrench, type LucideIcon } from 'lucide-react';
import { PRODUCT_KINDS, VAT_LABELS, VAT_RATES, validateRecord, type ProductKind } from '@gr8r/shared';
import { Button, ConfirmDialog, Dialog, DialogClose, DialogContent, Field, Input, MenuItem, Segmented, Switch, toast } from '@/components/ui';
import { DrawerSection, EntityDrawer } from '@/components/gr8r/entity-drawer';
import { fmtDate } from '../lib/dates';
import { useCanWrite, useCustomRows } from '../meta/custom-fields';
import { FieldInput, FieldValue } from '../meta/field-ui';
import type { MetaField } from '../meta/data';
import { attributeAsField, flattenTree, useAttributes, useProductMutations, useSaveWorkNorm, useUnits, useWorkCenters, useWorkNorms, type CategoryNode, type Product } from './data';

/** Служебное «поле» для обычной колонки товара, чтобы редактировать её тем же FieldInput */
const col = (key: string, name: string, type: MetaField['type']): MetaField => ({
  id: key,
  entityId: 'product',
  key,
  name,
  type,
  required: false,
  unique: false,
  filterable: false,
  options: {},
  sortOrder: 0,
  isSystem: true,
  archivedAt: null,
});

const F = {
  sku: col('sku', 'SKU', 'text'),
  barcode: col('barcode', 'Barcode', 'text'),
  price: col('price', 'Price', 'number'),
  purchasePrice: col('purchasePrice', 'Purchase price', 'number'),
  normHours: col('normHours', 'Norm hours', 'number'),
};

const KIND_LABEL: Record<ProductKind, string> = { goods: 'Goods', service: 'Service', work: 'Work', operation: 'Operation' };

export function CategorySelect({ tree, value, onChange, id, label = 'Category', allowNone = true }: { tree: CategoryNode[]; value: string | null; onChange: (v: string | null) => void; id?: string; label?: string; allowNone?: boolean }) {
  return (
    <select className="select" id={id} aria-label={label} value={value ?? ''} onChange={e => onChange(e.target.value || null)}>
      {allowNone && <option value="">No category</option>}
      {flattenTree(tree).map(n => (
        <option key={n.id} value={n.id}>
          {' '.repeat(n.depth)}
          {n.name}
        </option>
      ))}
    </select>
  );
}

export function UnitSelect({ value, onChange, id, label = 'Unit' }: { value: string; onChange: (v: string) => void; id?: string; label?: string }) {
  const units = useUnits();
  return (
    <select className="select" id={id} aria-label={label} value={value} onChange={e => onChange(e.target.value)}>
      {(units.data ?? []).map(u => (
        <option key={u.code} value={u.code}>
          {u.symbol} — {u.name} ({u.code})
        </option>
      ))}
    </select>
  );
}

export function VatSelect({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  return (
    <select className="select" id={id} aria-label="VAT rate" value={value} onChange={e => onChange(e.target.value)}>
      {VAT_RATES.map(v => (
        <option key={v} value={v}>
          {VAT_LABELS[v]}
        </option>
      ))}
    </select>
  );
}

/* ---------------- карточка ---------------- */

export function ProductDrawer({ product: p, tree, onClose, onOpenCategory }: { product: Product; tree: CategoryNode[]; onClose: () => void; onOpenCategory: (id: string) => void }) {
  const canWrite = useCanWrite();
  const m = useProductMutations();
  const attrs = useAttributes(p.categoryId);
  const [confirm, setConfirm] = React.useState(false);
  const save = (patch: Record<string, unknown>) => m.update.mutate({ id: p.id, patch });
  const saveAttr = (a: MetaField, v: unknown) => {
    const check = validateRecord([a], { [a.key]: v }, 'patch');
    if (!check.ok) return void toast.error(check.errors[a.key] ?? 'Invalid value');
    save({ attrs: { [a.key]: v ?? null } });
  };
  const custom = useCustomRows('product', p.custom, patch => save({ custom: patch }));
  const attrFields = (attrs.data ?? []).map(attributeAsField);
  const KindIcon = p.kind === 'service' ? Wrench : Package;

  // норма времени и участок по умолчанию — только у работ (вид номенклатуры «Работа»)
  const norms = useWorkNorms();
  const centers = useWorkCenters();
  const saveNorm = useSaveWorkNorm();
  const norm = p.kind === 'work' ? (norms.data?.items ?? []).find(n => n.productId === p.id) : undefined;
  const centerName = (id: string | null | undefined) => (centers.data?.items ?? []).find(c => c.id === id)?.name ?? '';

  const row = (icon: LucideIcon, label: string, edit: React.ReactNode, view: React.ReactNode) => ({ icon, label, value: canWrite ? edit : view });

  return (
    <>
      <EntityDrawer
        label={`Product: ${p.name}`}
        onClose={onClose}
        crumb={
          <span className="row" style={{ gap: 6, fontSize: 12.5 }}>
            <KindIcon size={14} />
            {KIND_LABEL[p.kind]}
            {p.sku && <span className="mono faint">{p.sku}</span>}
          </span>
        }
        title={p.name}
        onTitleChange={canWrite ? name => save({ name }) : undefined}
        subtitle={<span className="faint">Updated {fmtDate(new Date(p.updatedAt))}</span>}
        banner={!p.isActive ? <span className="badge gray">Inactive</span> : undefined}
        menu={
          canWrite ? (
            <MenuItem icon={<Trash2 size={15} />} danger onSelect={() => setConfirm(true)}>
              Archive product
            </MenuItem>
          ) : undefined
        }
        fields={[
          row(
            Tag,
            'Type',
            <Segmented aria-label="Type" value={p.kind} onValueChange={kind => save({ kind })} items={PRODUCT_KINDS.map(k => ({ value: k, label: KIND_LABEL[k] }))} />,
            KIND_LABEL[p.kind],
          ),
          row(Hash, 'SKU', <FieldInput field={F.sku} value={p.sku} onChange={v => save({ sku: v ?? '' })} />, p.sku || <span className="faint">—</span>),
          row(Barcode, 'Barcode', <FieldInput field={F.barcode} value={p.barcode} onChange={v => save({ barcode: v ?? '' })} />, p.barcode || <span className="faint">—</span>),
          {
            icon: FolderTree,
            label: 'Category',
            value: canWrite ? (
              <CategorySelect tree={tree} value={p.categoryId} onChange={categoryId => save({ categoryId })} />
            ) : p.categoryId ? (
              <button type="button" className="crm-link" onClick={() => onOpenCategory(p.categoryId!)}>
                Open category
              </button>
            ) : (
              <span className="faint">—</span>
            ),
          },
          row(Ruler, 'Unit', <UnitSelect value={p.unitCode} onChange={unitCode => save({ unitCode })} />, p.unitCode),
          row(Percent, 'VAT', <VatSelect value={p.vatRate} onChange={vatRate => save({ vatRate })} />, VAT_LABELS[p.vatRate]),
          row(CircleDollarSign, 'Sale price', <FieldInput field={F.price} value={Number(p.price)} onChange={v => save({ price: v ?? 0 })} />, p.price),
          row(CircleDollarSign, 'Purchase price', <FieldInput field={F.purchasePrice} value={Number(p.purchasePrice)} onChange={v => save({ purchasePrice: v ?? 0 })} />, p.purchasePrice),
          row(Power, 'Active', <Switch checked={p.isActive} aria-label="Active" onChange={e => save({ isActive: e.target.checked })} />, p.isActive ? 'Yes' : 'No'),
          ...(p.kind === 'work'
            ? [
                row(Timer, 'Norm hours', <FieldInput field={F.normHours} value={Number(norm?.normHours ?? 0)} onChange={v => saveNorm.mutate({ productId: p.id, normHours: String(v ?? 0), workCenterId: norm?.workCenterId ?? null })} />, norm?.normHours ?? '—'),
                {
                  icon: Wrench,
                  label: 'Work center',
                  value: canWrite ? (
                    <select
                      className="select"
                      aria-label="Work center"
                      value={norm?.workCenterId ?? ''}
                      onChange={e => saveNorm.mutate({ productId: p.id, normHours: norm?.normHours ?? '0', workCenterId: e.target.value || null })}
                    >
                      <option value="">No work center</option>
                      {(centers.data?.items ?? []).map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    centerName(norm?.workCenterId) || <span className="faint">—</span>
                  ),
                },
              ]
            : []),
        ]}
      >
        <DrawerSection title="Characteristics" count={attrFields.length || undefined}>
          {!p.categoryId ? (
            <p className="muted" style={{ margin: 0 }}>Choose a category to describe the product with its characteristics.</p>
          ) : attrs.isPending ? (
            <p className="faint" style={{ margin: 0 }}>Loading…</p>
          ) : !attrFields.length ? (
            <p className="muted" style={{ margin: 0 }}>This category has no characteristics yet.</p>
          ) : (
            <dl className="kv" aria-label="Characteristics">
              {attrFields.map(f => (
                <React.Fragment key={f.key}>
                  <dt title={f.name}>
                    {f.name}
                    {f.required && <span className="faint"> *</span>}
                  </dt>
                  <dd>{canWrite ? <FieldInput field={f} value={p.attrs[f.key]} onChange={v => saveAttr(f, v)} /> : <FieldValue field={f} value={p.attrs[f.key]} />}</dd>
                </React.Fragment>
              ))}
            </dl>
          )}
        </DrawerSection>
        {!!custom.length && (
          <DrawerSection title="Custom fields">
            <dl className="kv">
              {custom.map(r => (
                <React.Fragment key={r.field.key}>
                  <dt>
                    <r.icon size={14} />
                    {r.label}
                  </dt>
                  <dd>{r.node}</dd>
                </React.Fragment>
              ))}
            </dl>
          </DrawerSection>
        )}
      </EntityDrawer>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        danger
        title="Archive product?"
        description={
          <>
            <b>{p.name}</b> will be hidden from the catalog. Bills of materials that use it keep working; you can restore it through the API.
          </>
        }
        confirmLabel="Archive product"
        cancelLabel="Cancel"
        onConfirm={() => {
          m.remove.mutate(p.id);
          toast(`Archived “${p.name}”`);
          onClose();
        }}
      />
    </>
  );
}

/* ---------------- создание ---------------- */

export function ProductFormDialog({ tree, initialCategory, onClose, onCreated }: { tree: CategoryNode[]; initialCategory: string | null; onClose: () => void; onCreated: (p: Product) => void }) {
  const m = useProductMutations();
  const units = useUnits();
  const [kind, setKind] = React.useState<ProductKind>('goods');
  const [name, setName] = React.useState('');
  const [sku, setSku] = React.useState('');
  const [barcode, setBarcode] = React.useState('');
  const [categoryId, setCategoryId] = React.useState<string | null>(initialCategory);
  const [unitCode, setUnitCode] = React.useState('796');
  const [vat, setVat] = React.useState('20');
  const [price, setPrice] = React.useState('');
  const [purchase, setPurchase] = React.useState('');
  const [attrs, setAttrs] = React.useState<Record<string, unknown>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const attrList = useAttributes(categoryId);
  const fields = (attrList.data ?? []).map(attributeAsField);

  // Смена типа подставляет подходящую единицу: час для услуг, штука для товаров
  React.useEffect(() => {
    if (units.data) setUnitCode(u => (kind === 'service' && u === '796' ? '356' : kind === 'goods' && u === '356' ? '796' : u));
  }, [kind, units.data]);
  React.useEffect(() => setAttrs({}), [categoryId]);

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Enter a name';
    for (const [k, v] of [['price', price], ['purchasePrice', purchase]] as const) if (v.trim() !== '' && !(Number(v) >= 0)) errs[k] = 'Enter a non-negative number';
    if (barcode.trim() && !/^\d{8,14}$/.test(barcode.trim())) errs.barcode = '8–14 digits';
    const check = validateRecord(fields, attrs, 'create');
    if (!check.ok) for (const [k, msg] of Object.entries(check.errors)) errs[`attr:${k}`] = msg;
    setErrors(errs);
    if (Object.keys(errs).length || !check.ok) return;
    setBusy(true);
    try {
      const row = await m.create.mutateAsync({ kind, name: name.trim(), sku: sku.trim(), barcode: barcode.trim(), categoryId, unitCode, vatRate: vat, price: price.trim() || '0', purchasePrice: purchase.trim() || '0', attrs: check.data });
      toast(`Added “${row.name}”`);
      onCreated(row);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        size="lg"
        title="New product"
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              Create product
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
          <Segmented aria-label="Type" value={kind} onValueChange={setKind} items={PRODUCT_KINDS.map(k => ({ value: k, label: KIND_LABEL[k] }))} />
          <Field label="Name" error={errors.name}>
            {p => <Input {...p} autoFocus value={name} onChange={e => (setName(e.target.value), setErrors(s => ({ ...s, name: '' })))} />}
          </Field>
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <Field label="SKU" className="grow">
              {p => <Input {...p} value={sku} onChange={e => setSku(e.target.value)} />}
            </Field>
            <Field label="Barcode" className="grow" error={errors.barcode}>
              {p => <Input {...p} inputMode="numeric" value={barcode} onChange={e => setBarcode(e.target.value)} />}
            </Field>
          </div>
          <Field label="Category">{p => <CategorySelect tree={tree} value={categoryId} onChange={setCategoryId} id={p.id} />}</Field>
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <Field label="Unit" className="grow">
              {p => <UnitSelect value={unitCode} onChange={setUnitCode} id={p.id} />}
            </Field>
            <Field label="VAT" className="grow">
              {p => <VatSelect value={vat} onChange={setVat} id={p.id} />}
            </Field>
          </div>
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <Field label="Sale price" className="grow" error={errors.price}>
              {p => <Input {...p} inputMode="decimal" placeholder="0.00" value={price} onChange={e => setPrice(e.target.value)} />}
            </Field>
            <Field label="Purchase price" className="grow" error={errors.purchasePrice}>
              {p => <Input {...p} inputMode="decimal" placeholder="0.00" value={purchase} onChange={e => setPurchase(e.target.value)} />}
            </Field>
          </div>
          {!!fields.length && (
            <fieldset className="attr-fieldset">
              <legend>Characteristics</legend>
              {fields.map(f => (
                <AttrFormRow key={f.key} field={f} error={errors[`attr:${f.key}`]}>
                  <FieldInput
                    live
                    field={f}
                    value={attrs[f.key]}
                    invalid={!!errors[`attr:${f.key}`]}
                    onChange={v => {
                      setAttrs(s => ({ ...s, [f.key]: v }));
                      setErrors(s => ({ ...s, [`attr:${f.key}`]: '' }));
                    }}
                  />
                </AttrFormRow>
              ))}
            </fieldset>
          )}
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AttrFormRow({ field: f, error, children }: { field: MetaField; error?: string; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {f.name}
        {f.required && <span className="faint"> *</span>}
      </label>
      {React.isValidElement(children) ? React.cloneElement(children as React.ReactElement<{ id?: string }>, { id }) : children}
      {error && (
        <span className="err">
          <CircleAlert size={12} />
          {error}
        </span>
      )}
    </div>
  );
}
