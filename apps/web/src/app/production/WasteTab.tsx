/* Вкладка «Отходы» выпуска и заказа на производство: возвратные отходы — товар, количество, цена и сумма.
   Цену и сумму видят и правят admin и owner (у остальных столбцов нет: сервер их не отдаёт). Правка черновика сохраняется сразу. */
import * as React from 'react';
import { Trash2 } from 'lucide-react';
import { dec, fmt, mul, type WasteValuation } from '@gr8r/shared';
import { Field, IconButton, Input, Segmented, Select } from '@/components/ui';
import { money, type Product } from '../catalog/data';
import { ProductPicker } from '../docs/pickers';
import { useT } from '@/i18n';

/** Строка отхода: компонент выпуска с видом `waste` */
export interface WasteComponent {
  id: string;
  productId: string | null;
  productName: string;
  qty: string;
  price: string | null;
}

/** Строка для сохранения: без id — новая */
export interface WasteInput {
  id?: string;
  productId: string;
  qty: string;
  price?: string | null;
}

const trim = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
const isNum = (s: string) => /^\d+([.,]\d+)?$/.test(s.trim()) && Number(s.trim().replace(',', '.')) > 0;
const norm = (s: string) => s.trim().replace(',', '.');
const amount = (qty: string, price: string | null) => (isNum(qty) && price !== null && price !== '' ? fmt(mul(dec(norm(qty)), dec(norm(price))), 2) : null);

export function WasteTab({ rows, editable, seeCost, onSave }: { rows: WasteComponent[]; editable: boolean; seeCost: boolean; onSave: (waste: WasteInput[]) => Promise<unknown> }) {
  const t = useT();
  const [draft, setDraft] = React.useState(() => rows.map(r => ({ ...r, qty: trim(r.qty), price: r.price === null ? null : trim(r.price) })));
  // строки меняются из ответа сервера: форма берёт их заново
  const sig = rows.map(r => `${r.id}:${r.productId}:${r.qty}:${r.price}`).join('|');
  React.useEffect(() => setDraft(rows.map(r => ({ ...r, qty: trim(r.qty), price: r.price === null ? null : trim(r.price) }))), [sig]);

  const toInput = (list: typeof draft): WasteInput[] => list.filter(r => r.productId && isNum(r.qty)).map(r => ({ id: r.id.startsWith('new:') ? undefined : r.id, productId: r.productId!, qty: norm(r.qty), ...(seeCost && r.price !== null && r.price !== '' ? { price: norm(r.price) } : {}) }));
  const commit = (list = draft) => void onSave(toInput(list));
  const patch = (id: string, p: Partial<(typeof draft)[number]>) => setDraft(d => d.map(r => (r.id === id ? { ...r, ...p } : r)));
  const pick = (p: Product) => {
    const next = [...draft, { id: `new:${p.id}:${draft.length}`, productId: p.id, productName: p.name, qty: '1', price: null as string | null }];
    setDraft(next);
    commit(next);
  };
  const remove = (id: string) => {
    const next = draft.filter(r => r.id !== id);
    setDraft(next);
    commit(next);
  };
  const total = draft.reduce((sum, r) => sum + dec(amount(r.qty, r.price) ?? '0'), 0n);

  return (
    <section className="doc-lines panel" aria-label={t('production.waste.aria')}>
      <div className="table-wrap">
        <table className="dtbl" aria-label={t('production.waste.aria')}>
          <thead>
            <tr>
              <th style={{ width: 34 }}>#</th>
              <th>{t('production.waste.colProduct')}</th>
              <th style={{ width: 120 }} className="r">
                {t('production.waste.colQty')}
              </th>
              {seeCost && (
                <>
                  <th style={{ width: 120 }} className="r">
                    {t('production.waste.colPrice')}
                  </th>
                  <th style={{ width: 130 }} className="r">
                    {t('production.waste.colAmount')}
                  </th>
                </>
              )}
              <th style={{ width: 36 }} />
            </tr>
          </thead>
          <tbody>
            {draft.map((r, n) => (
              <tr key={r.id}>
                <td className="faint num">{n + 1}</td>
                <td>
                  <span className="trunc">{r.productName}</span>
                </td>
                <td className="r">
                  {editable ? <Input aria-label={t('production.waste.colQty')} inputMode="decimal" value={r.qty} invalid={!isNum(r.qty)} onChange={e => patch(r.id, { qty: e.target.value })} onBlur={() => commit()} /> : <span className="num">{r.qty}</span>}
                </td>
                {seeCost && (
                  <>
                    <td className="r">
                      {editable ? <Input aria-label={t('production.waste.colPrice')} inputMode="decimal" value={r.price ?? ''} onChange={e => patch(r.id, { price: e.target.value })} onBlur={() => commit()} /> : <span className="num">{r.price === null ? '—' : money(r.price)}</span>}
                    </td>
                    <td className="r num">{amount(r.qty, r.price) === null ? '—' : money(amount(r.qty, r.price)!)}</td>
                  </>
                )}
                <td>
                  {editable && (
                    <IconButton size="xs" label={t('production.waste.remove')} onClick={() => remove(r.id)}>
                      <Trash2 size={13} />
                    </IconButton>
                  )}
                </td>
              </tr>
            ))}
            {!draft.length && (
              <tr>
                <td colSpan={seeCost ? 6 : 4} className="faint" style={{ textAlign: 'center', padding: 22 }}>
                  {editable ? t('production.waste.emptyEditable') : t('production.waste.empty')}
                </td>
              </tr>
            )}
          </tbody>
          {seeCost && draft.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={4} className="r muted">
                  {t('production.waste.total')}
                </td>
                <td className="r num">{money(fmt(total, 2))}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {editable && (
        <div className="doc-add" style={{ maxWidth: 360 }}>
          <ProductPicker value="" price="purchasePrice" placeholder={t('production.waste.pickProduct')} onPick={pick} />
        </div>
      )}
    </section>
  );
}

/** Поля шапки выпуска и заказа: стоимость отходов и склады «Отходы в» / «Брак в» (брак — только у выпуска сборки) */
export function WasteHeaderFields({
  valuation,
  wasteWarehouseId,
  defectWarehouseId,
  warehouses,
  editable,
  showDefect,
  onChange,
}: {
  valuation: WasteValuation;
  wasteWarehouseId: string | null;
  defectWarehouseId: string | null;
  warehouses: { id: string; name: string }[];
  editable: boolean;
  showDefect: boolean;
  onChange: (patch: { wasteValuation?: WasteValuation; wasteWarehouseId?: string | null; defectWarehouseId?: string | null }) => void;
}) {
  const t = useT();
  const select = (label: string, value: string | null, key: 'wasteWarehouseId' | 'defectWarehouseId') => (
    <Field label={label}>
      {p => (
        <Select
          id={p.id}
          disabled={!editable}
          value={value ?? ''}
          onValueChange={v => onChange({ [key]: v || null })}
          options={warehouses.map(w => ({ value: w.id, label: w.name }))}
          placeholder={t('production.waste.warehouseDefault')}
          aria-label={label}
        />
      )}
    </Field>
  );
  return (
    <>
      <Field label={t('production.waste.valuation')} hint={t('production.waste.valuationHint')}>
        {() => (
          <Segmented
            aria-label={t('production.waste.valuation')}
            disabled={!editable}
            value={valuation}
            onValueChange={v => editable && onChange({ wasteValuation: v })}
            items={[
              { value: 'accounting', label: t('production.waste.valuationAccounting') },
              { value: 'zero', label: t('production.waste.valuationZero') },
            ]}
          />
        )}
      </Field>
      {select(t('production.waste.wasteWarehouse'), wasteWarehouseId, 'wasteWarehouseId')}
      {showDefect && select(t('production.waste.defectWarehouse'), defectWarehouseId, 'defectWarehouseId')}
    </>
  );
}

/** Режим материалов выпуска (задача 1135): при выпуске или по итогам смены. Меняется в черновике сборки */
export function MaterialModeField({ value, editable, onChange }: { value: 'on_release' | 'shift'; editable: boolean; onChange: (v: 'on_release' | 'shift') => void }) {
  const t = useT();
  return (
    <Field label={t('production.shift.mode')} hint={t('production.shift.modeHint')}>
      {() => (
        <Segmented
          aria-label={t('production.shift.mode')}
          disabled={!editable}
          value={value}
          onValueChange={v => editable && onChange(v)}
          items={[
            { value: 'on_release', label: t('production.shift.modeOnRelease') },
            { value: 'shift', label: t('production.shift.modeShift') },
          ]}
        />
      )}
    </Field>
  );
}
