/** Добавление и правка строки спецификации: материал (товар каталога), полуфабрикат (другая продукция), работа (участок), расход (услуга). */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Package, Search } from 'lucide-react';
import { bomLineCreate, compileExpr, ExprError } from '@gr8r/shared';
import { Button, Dialog, DialogClose, DialogContent, Field, Input, toast } from '@/components/ui';
import { uuidv7 } from '../lib/uuid';
import { searchProducts, unitSymbol, useUnits, type Product } from '../catalog/data';
import { useWsId } from '../meta/data';
import { canInclude, type BomLine, type Item, type Material, type ProductionMutations, type Snapshot } from './data';

const toMaterial = (p: Product): Material => ({ id: p.id, name: p.name, sku: p.sku, kind: p.kind, unitCode: p.unitCode, price: p.price, purchasePrice: p.purchasePrice, archived: false });

/** Поиск товара: товары (материал) или услуги (расход подрядчику): поле + список результатов */
function ProductPicker({ value, onChange, invalid, kind = 'goods' }: { value: Material | null; onChange: (m: Material) => void; invalid?: boolean; kind?: 'goods' | 'service' }) {
  const ws = useWsId();
  const units = useUnits();
  const [q, setQ] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  const results = useQuery({ queryKey: ['ws', ws, 'catalog', 'picker', debounced, kind], queryFn: () => searchProducts(ws, debounced, kind, 8), staleTime: 5_000 });
  return (
    <div className="picker">
      <Input icon={<Search size={14} />} aria-label="Search products" placeholder={kind === 'service' ? 'Search services by name or SKU' : 'Search goods by name, SKU or barcode'} invalid={invalid} value={q} onChange={e => setQ(e.target.value)} autoFocus />
      <div className="picker-list" role="listbox" aria-label="Products">
        {results.data?.map(p => (
          <button type="button" key={p.id} role="option" aria-selected={value?.id === p.id} className={value?.id === p.id ? 'mi on' : 'mi'} onClick={() => onChange(toMaterial(p))}>
            <Package size={14} className="faint" />
            <span className="trunc" style={{ flex: 1, textAlign: 'left' }}>
              {p.name}
            </span>
            {p.sku && <span className="mono faint">{p.sku}</span>}
            <span className="faint">{unitSymbol(units.data, p.unitCode)}</span>
            {value?.id === p.id && <Check size={14} />}
          </button>
        ))}
        {results.data && !results.data.length && <div className="faint" style={{ padding: 8, fontSize: 12.5 }}>Nothing found</div>}
        {results.isPending && <div className="faint" style={{ padding: 8, fontSize: 12.5 }}>Loading…</div>}
      </div>
      {value && (
        <div className="picker-chosen">
          Selected: <b>{value.name}</b>
        </div>
      )}
    </div>
  );
}

export function LineDialog({ kind, item, line, snap, m, onClose }: { kind: BomLine['kind']; item: Item; line?: BomLine; snap: Snapshot; m: ProductionMutations; onClose: () => void }) {
  const units = useUnits();
  const ws = useWsId();
  const edit = !!line;
  const [material, setMaterial] = React.useState<Material | null>(() => (line?.productId ? (snap.materials.find(x => x.id === line.productId) ?? null) : null));
  const [opProduct, setOpProduct] = React.useState<string>('');
  // операции каталога: работа спецификации может ссылаться на операцию (норма времени и расценки)
  const operations = useQuery({ queryKey: ['ws', ws, 'catalog', 'operations'], queryFn: () => searchProducts(ws, '', 'operation', 100), staleTime: 60_000 });
  const [childId, setChildId] = React.useState(line?.childItemId ?? '');
  const [mode, setMode] = React.useState<'stock' | 'explode'>(line?.semiMode ?? 'stock');
  const [qty, setQty] = React.useState(line ? line.qty.replace(/\.?0+$/, '') : '1');
  const [scrap, setScrap] = React.useState(line ? line.scrapPct.replace(/\.?0+$/, '') : '0');
  const [operation, setOperation] = React.useState(line?.operation ?? '');
  // формулы строки: количество по параметрам и условие включения строки в состав
  const [qtyExpr, setQtyExpr] = React.useState(line?.qtyExpr ?? '');
  const [condition, setCondition] = React.useState(line?.condition ?? '');
  const paramKeys = (item.params ?? []).map(p => p.key);
  React.useEffect(() => {
    // у работы с операцией её название берётся из товара каталога
    if (kind === 'work' && !opProduct) {
      const found = operations.data?.find(p => p.id === line?.productId);
      if (found) setOpProduct(found.id);
    }
  }, [operations.data, kind, line?.productId, opProduct]);
  const [center, setCenter] = React.useState(line?.workCenterId ?? '');
  const [stageId, setStageId] = React.useState(line?.stageId ?? '');
  const [hours, setHours] = React.useState(line ? line.hours.replace(/\.?0+$/, '') : '1');
  const [rate, setRate] = React.useState(line?.rate ? line.rate.replace(/\.00$/, '') : '');
  const [fixed, setFixed] = React.useState(line?.fixedCost ? line.fixedCost.replace(/\.00$/, '') : '');
  const [err, setErr] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  const candidates = snap.items.filter(i => i.id !== item.id && (i.id === line?.childItemId || canInclude(snap.items, item.id, i.id)));
  // вид производства изделия: этап, на котором расходуется материал или выполняется операция
  const prodKind = snap.kinds.find(k => k.id === item.productionKindId) ?? null;
  const centerObj = snap.workCenters.find(w => w.id === center);
  const title = `${edit ? 'Edit' : 'Add'} ${kind === 'material' ? 'material' : kind === 'semi' ? 'semi-finished product' : kind === 'expense' ? 'expense' : 'work operation'}`;

  /** Ошибка выражения видна сразу: ключи параметров спецификации известны */
  const exprError = (src: string): string | undefined => {
    if (!src.trim()) return undefined;
    try {
      compileExpr(src, paramKeys);
      return undefined;
    } catch (e) {
      return e instanceof ExprError ? e.message : 'Invalid expression';
    }
  };
  const qtyExprError = exprError(qtyExpr);
  const conditionError = exprError(condition);

  const submit = async () => {
    const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
    const body: Record<string, unknown> = {
      stageId: prodKind ? stageId || null : null,
      ...(kind === 'material' || kind === 'expense'
        ? { kind, productId: material?.id, qty: num(qty), scrapPct: kind === 'material' ? (num(scrap) ?? 0) : 0, ...(qtyExpr.trim() ? { qtyExpr: qtyExpr.trim() } : {}), ...(condition.trim() ? { condition: condition.trim() } : {}) }
        : kind === 'semi'
          ? { kind, childItemId: childId || undefined, qty: num(qty), semiMode: mode, ...(qtyExpr.trim() ? { qtyExpr: qtyExpr.trim() } : {}), ...(condition.trim() ? { condition: condition.trim() } : {}) }
          : { kind, operation: operation.trim(), productId: opProduct || null, workCenterId: center || null, hours: num(hours) ?? 0, rate: rate.trim() === '' ? null : Number(rate), fixedCost: fixed.trim() === '' ? null : Number(fixed) }),
    };
    if (qtyExprError || conditionError) {
      setErr({ ...(qtyExprError ? { qtyExpr: qtyExprError } : {}), ...(conditionError ? { condition: conditionError } : {}) });
      return;
    }
    const parsed = bomLineCreate.safeParse(body);
    if (!parsed.success) {
      const out: Record<string, string> = {};
      for (const i of parsed.error.issues) out[String(i.path[0])] ??= i.message;
      return setErr(out);
    }
    setBusy(true);
    try {
      if (edit) {
        const { kind: _k, ...patch } = body;
        await m.updateLine.mutateAsync({ id: line!.id, itemId: item.id, patch });
      } else await m.addLine.mutateAsync({ itemId: item.id, id: uuidv7(), body, material: kind === 'material' || kind === 'expense' ? (material ?? undefined) : undefined });
      toast(edit ? 'Line saved' : 'Line added');
      onClose();
    } catch {
      setBusy(false); // тост с ошибкой показал хук мутации
    }
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={title}
        description={`In “${item.name}”`}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              {edit ? 'Save line' : 'Add line'}
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
          {prodKind && (
            <Field label="Stage" hint="The stage of the production kind where the material is used or the operation is performed." error={err.stageId}>
              {p => (
                <select className="select" id={p.id} value={stageId} onChange={e => (setStageId(e.target.value), setErr({}))}>
                  <option value="">Choose a stage…</option>
                  {prodKind.stages.map(st => (
                    <option key={st.id} value={st.id}>
                      {st.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          {kind === 'material' && (
            <>
              <Field label="Material" error={err.productId}>
                {() => <ProductPicker value={material} onChange={mat => (setMaterial(mat), setErr({}))} invalid={!!err.productId} />}
              </Field>
              <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                <Field label={`Quantity${material ? `, ${unitSymbol(units.data, material.unitCode)}` : ''}`} className="grow" error={err.qty}>
                  {p => <Input {...p} inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} />}
                </Field>
                <Field label="Scrap, %" className="grow" hint="Extra material lost in production." error={err.scrapPct}>
                  {p => <Input {...p} inputMode="decimal" value={scrap} onChange={e => setScrap(e.target.value)} />}
                </Field>
              </div>
            </>
          )}
          {kind === 'semi' && (
            <>
              <Field label="Product to include" error={err.childItemId} hint="Products that already contain this one are not offered: a bill of materials cannot loop.">
                {p => (
                  <select className="select" id={p.id} value={childId} onChange={e => (setChildId(e.target.value), setErr({}))}>
                    <option value="">Choose a product…</option>
                    {candidates.map(i => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                        {i.code ? ` (${i.code})` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Quantity" error={err.qty}>
                {p => <Input {...p} inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} />}
              </Field>
              <Field label="Mode" hint="Stock: the semi-finished product is produced separately and taken from the warehouse. Explode: it is expanded into its materials and works in the same release.">
                {p => (
                  <select className="select" id={p.id} value={mode} onChange={e => setMode(e.target.value as 'stock' | 'explode')}>
                    <option value="stock">Take from stock</option>
                    <option value="explode">Expand to materials</option>
                  </select>
                )}
              </Field>
            </>
          )}
          {kind === 'expense' && (
            <>
              <Field label="Service" hint="A service of a contractor: it is included in the planned cost, but it is not taken from stock." error={err.productId}>
                {() => <ProductPicker kind="service" value={material} onChange={mat => (setMaterial(mat), setErr({}))} invalid={!!err.productId} />}
              </Field>
              <Field label="Quantity" error={err.qty}>
                {p => <Input {...p} inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} />}
              </Field>
            </>
          )}
          {(kind === 'material' || kind === 'semi' || kind === 'expense') && paramKeys.length > 0 && (
            <>
              <Field label="Quantity formula" hint="Counted over the parameters of the product. Empty: the quantity above." error={err.qtyExpr ?? qtyExprError}>
                {p => <Input {...p} placeholder="e.g. width * height / 1000000 * 1.05" value={qtyExpr} onChange={e => setQtyExpr(e.target.value)} invalid={!!(err.qtyExpr ?? qtyExprError)} />}
              </Field>
              <Field label="Condition" hint="The line is included in the composition only when the condition is true. Empty: the line is always included." error={err.condition ?? conditionError}>
                {p => <Input {...p} placeholder="e.g. color = 'white'" value={condition} onChange={e => setCondition(e.target.value)} invalid={!!(err.condition ?? conditionError)} />}
              </Field>
            </>
          )}
          {kind === 'work' && (
            <>
              <Field label="Operation" hint="An operation is a product of the “Operation” kind: it carries the norm of time and the history of rates." error={err.operation}>
                {p => (
                  <select
                    className="select"
                    id={p.id}
                    value={opProduct}
                    onChange={e => {
                      setOpProduct(e.target.value);
                      const found = operations.data?.find(x => x.id === e.target.value);
                      if (found) setOperation(found.name);
                      setErr({});
                    }}
                  >
                    <option value="">No operation (text work)</option>
                    {(operations.data ?? []).map(o => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                        {o.sku ? ` (${o.sku})` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Name of the work" error={err.operation}>
                {p => <Input {...p} autoFocus placeholder="e.g. Assembly" value={operation} onChange={e => (setOperation(e.target.value), setErr({}))} />}
              </Field>
              <Field label="Work center" hint={centerObj ? `Rate of the center: ${Number(centerObj.hourlyRate).toFixed(2)} per hour.` : 'Optional: without a center, set the rate below.'}>
                {p => (
                  <select className="select" id={p.id} value={center} onChange={e => setCenter(e.target.value)}>
                    <option value="">No work center</option>
                    {snap.workCenters
                      .filter(w => !w.archivedAt || w.id === line?.workCenterId)
                      .map(w => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                  </select>
                )}
              </Field>
              <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                <Field label="Hours" className="grow" error={err.hours}>
                  {p => <Input {...p} inputMode="decimal" value={hours} onChange={e => (setHours(e.target.value), setErr({}))} />}
                </Field>
                <Field label="Rate per hour" className="grow" hint="Empty: the rate of the work center.">
                  {p => <Input {...p} inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} />}
                </Field>
                <Field label="Fixed cost" className="grow" hint="Added to hours × rate.">
                  {p => <Input {...p} inputMode="decimal" value={fixed} onChange={e => setFixed(e.target.value)} />}
                </Field>
              </div>
            </>
          )}
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}
