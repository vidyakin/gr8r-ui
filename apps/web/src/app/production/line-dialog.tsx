/** Добавление и правка строки спецификации: материал (товар каталога), полуфабрикат (другая продукция), работа (участок), расход (услуга), выходной продукт (разборка). */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Package, Search } from 'lucide-react';
import { bomLineCreate, compileExpr, ExprError } from '@gr8r/shared';
import { Button, Dialog, DialogClose, DialogContent, Field, Input, toast } from '@/components/ui';
import { uuidv7 } from '../lib/uuid';
import { searchProducts, unitSymbol, useUnits, type Product } from '../catalog/data';
import { useWsId } from '../meta/data';
import { useT } from '@/i18n';
import { canInclude, type BomLine, type Item, type Material, type ProductionMutations, type Snapshot } from './data';

const toMaterial = (p: Product): Material => ({ id: p.id, name: p.name, sku: p.sku, kind: p.kind, unitCode: p.unitCode, price: p.price, purchasePrice: p.purchasePrice, archived: false });

/** Поиск товара: товары (материал) или услуги (расход подрядчику): поле + список результатов */
function ProductPicker({ value, onChange, invalid, kind = 'goods' }: { value: Material | null; onChange: (m: Material) => void; invalid?: boolean; kind?: 'goods' | 'service' }) {
  const ws = useWsId();
  const units = useUnits();
  const tt = useT();
  const [q, setQ] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  const results = useQuery({ queryKey: ['ws', ws, 'catalog', 'picker', debounced, kind], queryFn: () => searchProducts(ws, debounced, kind, 8), staleTime: 5_000 });
  return (
    <div className="picker">
      <Input icon={<Search size={14} />} aria-label={tt('production.line.fields.productSearchPlaceholder')} placeholder={kind === 'service' ? tt('production.line.fields.productSearchPlaceholder') : tt('production.line.fields.productSearchPlaceholder')} invalid={invalid} value={q} onChange={e => setQ(e.target.value)} autoFocus />
      <div className="picker-list" role="listbox" aria-label={tt('production.line.fields.product')}>
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
        {results.data && !results.data.length && <div className="faint" style={{ padding: 8, fontSize: 12.5 }}>{tt('common.noResults')}</div>}
        {results.isPending && <div className="faint" style={{ padding: 8, fontSize: 12.5 }}>{tt('common.loading')}</div>}
      </div>
      {value && (
        <div className="picker-chosen">
          {tt('production.line.chosen')}: <b>{value.name}</b>
        </div>
      )}
    </div>
  );
}

export function LineDialog({ kind, item, line, snap, m, onClose }: { kind: BomLine['kind']; item: Item; line?: BomLine; snap: Snapshot; m: ProductionMutations; onClose: () => void }) {
  const units = useUnits();
  const ws = useWsId();
  const tt = useT();
  const edit = !!line;
  const [material, setMaterial] = React.useState<Material | null>(() => (line?.productId ? (snap.materials.find(x => x.id === line.productId) ?? null) : null));
  const [opProduct, setOpProduct] = React.useState<string>('');
  // операции каталога: работа спецификации может ссылаться на операцию (норма времени и расценки)
  const operations = useQuery({ queryKey: ['ws', ws, 'catalog', 'operations'], queryFn: () => searchProducts(ws, '', 'operation', 100), staleTime: 60_000 });
  const [childId, setChildId] = React.useState(line?.childItemId ?? '');
  const [mode, setMode] = React.useState<'stock' | 'explode'>(line?.semiMode ?? 'stock');
  const [qty, setQty] = React.useState(line ? line.qty.replace(/\.?0+$/, '') : '1');
  // доля стоимости исходного товара (выходной продукт разборки), %
  const [costShare, setCostShare] = React.useState(line?.costShare ? line.costShare.replace(/\.?0+$/, '') : '');
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
  const kindKey = kind === 'material' ? 'material' : kind === 'semi' ? 'semi' : kind === 'expense' ? 'expense' : kind === 'output' ? 'output' : kind === 'waste' ? 'waste' : 'work';
  const title = `${edit ? tt('production.common.edit') : tt('production.common.add')} ${tt(`production.line.kind.${kindKey}`)}`;

  /** Ошибка выражения видна сразу: ключи параметров спецификации известны */
  const exprError = (src: string): string | undefined => {
    if (!src.trim()) return undefined;
    try {
      compileExpr(src, paramKeys);
      return undefined;
    } catch (e) {
      return e instanceof ExprError ? e.message : tt('production.line.exprErrorInvalid');
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
        : kind === 'output'
          ? { kind, productId: material?.id, qty: num(qty), ...(costShare.trim() ? { costShare: Number(costShare) } : {}), ...(qtyExpr.trim() ? { qtyExpr: qtyExpr.trim() } : {}), ...(condition.trim() ? { condition: condition.trim() } : {}) }
          : kind === 'semi'
            ? { kind, childItemId: childId || undefined, qty: num(qty), semiMode: mode, ...(qtyExpr.trim() ? { qtyExpr: qtyExpr.trim() } : {}), ...(condition.trim() ? { condition: condition.trim() } : {}) }
            : kind === 'waste'
              ? { kind, productId: material?.id, qty: num(qty), ...(qtyExpr.trim() ? { qtyExpr: qtyExpr.trim() } : {}), ...(condition.trim() ? { condition: condition.trim() } : {}) }
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
      } else await m.addLine.mutateAsync({ itemId: item.id, id: uuidv7(), body, material: kind === 'material' || kind === 'expense' || kind === 'output' || kind === 'waste' ? (material ?? undefined) : undefined });
      toast(edit ? tt('production.line.saved') : tt('production.line.added'));
      onClose();
    } catch {
      setBusy(false); // тост с ошибкой показал хук мутации
    }
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={title}
        description={tt('production.line.inItem', { name: item.name })}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">{tt('production.common.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              {edit ? tt('production.line.saveLine') : tt('production.item.addLine')}
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
            <Field label={tt('production.line.fields.stage')} hint={tt('production.line.hints.stage')} error={err.stageId}>
              {p => (
                <select className="select" id={p.id} value={stageId} onChange={e => (setStageId(e.target.value), setErr({}))}>
                  <option value="">{tt('production.line.chooseStage')}</option>
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
              <Field label={tt('production.line.fields.product')} error={err.productId}>
                {() => <ProductPicker value={material} onChange={mat => (setMaterial(mat), setErr({}))} invalid={!!err.productId} />}
              </Field>
              <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                <Field label={material ? tt('production.line.fields.qtyUnit', { unit: unitSymbol(units.data, material.unitCode) }) : tt('production.field.quantity')} className="grow" error={err.qty}>
                  {p => <Input {...p} inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} />}
                </Field>
                <Field label={tt('production.line.fields.scrap')} className="grow" hint={tt('production.line.hints.scrap')} error={err.scrapPct}>
                  {p => <Input {...p} inputMode="decimal" value={scrap} onChange={e => setScrap(e.target.value)} />}
                </Field>
              </div>
            </>
          )}
          {kind === 'semi' && (
            <>
              <Field label={tt('production.line.fields.product')} error={err.childItemId} hint={tt('production.line.hints.semi')}>
                {p => (
                  <select className="select" id={p.id} value={childId} onChange={e => (setChildId(e.target.value), setErr({}))}>
                    <option value="">{tt('production.line.chooseProduct')}</option>
                    {candidates.map(i => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                        {i.code ? ` (${i.code})` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label={tt('production.field.quantity')} error={err.qty}>
                {p => <Input {...p} inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} />}
              </Field>
              <Field label={tt('production.line.fields.mode')} hint={tt('production.line.hints.semiMode')}>
                {p => (
                  <select className="select" id={p.id} value={mode} onChange={e => setMode(e.target.value as 'stock' | 'explode')}>
                    <option value="stock">{tt('production.line.mode.stock')}</option>
                    <option value="explode">{tt('production.line.mode.explode')}</option>
                  </select>
                )}
              </Field>
            </>
          )}
          {kind === 'expense' && (
            <>
              <Field label={tt('production.line.fields.productService')} hint={tt('production.line.hints.expense')} error={err.productId}>
                {() => <ProductPicker kind="service" value={material} onChange={mat => (setMaterial(mat), setErr({}))} invalid={!!err.productId} />}
              </Field>
              <Field label={tt('production.field.quantity')} error={err.qty}>
                {p => <Input {...p} inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} />}
              </Field>
            </>
          )}
          {kind === 'output' && (
            <>
              <Field label={tt('production.line.fields.outputProduct')} hint={tt('production.line.hints.output')} error={err.productId}>
                {() => <ProductPicker value={material} onChange={mat => (setMaterial(mat), setErr({}))} invalid={!!err.productId} />}
              </Field>
              <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                <Field label={material ? tt('production.line.fields.qtyUnit', { unit: unitSymbol(units.data, material.unitCode) }) : tt('production.field.quantity')} className="grow" error={err.qty}>
                  {p => <Input {...p} inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} />}
                </Field>
                <Field label={tt('production.line.fields.costShare')} className="grow" hint={tt('production.line.hints.costShare')} error={err.costShare}>
                  {p => <Input {...p} inputMode="decimal" placeholder={'60'} value={costShare} onChange={e => setCostShare(e.target.value)} />}
                </Field>
              </div>
            </>
          )}
          {kind === 'waste' && (
            <>
              <Field label={tt('production.line.fields.wasteProduct')} hint={tt('production.line.hints.waste')} error={err.productId}>
                {() => <ProductPicker value={material} onChange={mat => (setMaterial(mat), setErr({}))} invalid={!!err.productId} />}
              </Field>
              <Field label={material ? tt('production.line.fields.qtyUnit', { unit: unitSymbol(units.data, material.unitCode) }) : tt('production.field.quantity')} error={err.qty}>
                {p => <Input {...p} inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} />}
              </Field>
            </>
          )}
          {(kind === 'material' || kind === 'semi' || kind === 'expense' || kind === 'output' || kind === 'waste') && paramKeys.length > 0 && (
            <>
              <Field label={tt('production.line.fields.expr')} hint={tt('production.line.fields.exprHint', { example: 'width * height / 1000000 * 1.05' })} error={err.qtyExpr ?? qtyExprError}>
                {p => <Input {...p} placeholder={'width * height / 1000000 * 1.05'} value={qtyExpr} onChange={e => setQtyExpr(e.target.value)} invalid={!!(err.qtyExpr ?? qtyExprError)} />}
              </Field>
              <Field label={tt('production.line.fields.condition')} hint={tt('production.line.hints.condition')} error={err.condition ?? conditionError}>
                {p => <Input {...p} placeholder={`color = 'white'`} value={condition} onChange={e => setCondition(e.target.value)} invalid={!!(err.condition ?? conditionError)} />}
              </Field>
            </>
          )}
          {kind === 'work' && (
            <>
              <Field label={tt('production.line.fields.operation')} hint={tt('production.line.hints.operation')} error={err.operation}>
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
                    <option value="">{tt('production.line.operationNone')}</option>
                    {(operations.data ?? []).map(o => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                        {o.sku ? ` (${o.sku})` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label={tt('production.line.fields.operationName')} error={err.operation}>
                {p => <Input {...p} autoFocus placeholder={tt('production.line.operationPlaceholder')} value={operation} onChange={e => (setOperation(e.target.value), setErr({}))} />}
              </Field>
              <Field label={tt('production.line.fields.workCenter')} hint={centerObj ? tt('production.line.hints.centerRate', { rate: Number(centerObj.hourlyRate).toFixed(2) }) : tt('production.line.hints.workCenterNo')}>
                {p => (
                  <select className="select" id={p.id} value={center} onChange={e => setCenter(e.target.value)}>
                    <option value="">{tt('production.line.noWorkCenter')}</option>
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
                <Field label={tt('production.field.hours')} className="grow" error={err.hours}>
                  {p => <Input {...p} inputMode="decimal" value={hours} onChange={e => (setHours(e.target.value), setErr({}))} />}
                </Field>
                <Field label={tt('production.line.fields.ratePerHour')} className="grow" hint={tt('production.line.hints.rate')}>
                  {p => <Input {...p} inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} />}
                </Field>
                <Field label={tt('production.line.fields.fixed')} className="grow" hint={tt('production.line.hints.fixed')}>
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
