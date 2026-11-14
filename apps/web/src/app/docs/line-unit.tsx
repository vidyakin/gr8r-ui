/* Единица строки документа (docs/plans/2026-11-14-product-packages.md): базовая единица товара или его упаковка.
   Количество и цена в форме — в единице строки; смена единицы сохраняет количество в базовых и сумму строки. */
import { dec, fmt, mul, div } from '@gr8r/shared';
import { useT } from '@/i18n';
import { unitSymbol, useProductUnits, type Unit } from '../catalog/data';

/** Цена при смене единицы: за базовую = цена / прежний коэффициент, за новую = × новый (1500 за ящик по 100 → 15 за шт) */
export function rescalePrice(price: string, fromFactor: string, toFactor: string): string {
  if (!price.trim()) return price;
  const p = dec(price.replace(',', '.'));
  return fmt(mul(div(p, dec(fromFactor) || 1_000_000n), dec(toFactor) || 1_000_000n), 2).replace(/\.00$/, '');
}

/** Количество при смене единицы: в базовых единицах не меняется (2 упак по 100 → 200 шт); до 3 знаков */
export function rescaleQty(qty: string, fromFactor: string, toFactor: string): string {
  if (!qty.trim()) return qty;
  const q = dec(qty.replace(',', '.'));
  return fmt(div(mul(q, dec(fromFactor) || 1_000_000n), dec(toFactor) || 1_000_000n), 3).replace(/\.?0+$/, '');
}

export function LineUnitCell({ line, editable, units, onChange }: { line: { productId: string | null; unitCode: string; unitFactor: string }; editable: boolean; units: Unit[] | undefined; onChange: (unitCode: string, unitFactor: string) => void }) {
  const t = useT();
  // упаковки грузим только у редактируемой строки или строки не в базовой единице — подсказка «= 100 шт»
  const packs = useProductUnits(editable || dec(line.unitFactor) !== 1_000_000n ? line.productId : null);
  const sym = (code: string) => unitSymbol(units, code);
  const base = packs.data?.baseUnitCode;
  const hint = base && dec(line.unitFactor) !== 1_000_000n ? t('catalog.packs.equals', { unit: sym(line.unitCode), factor: String(Number(line.unitFactor)), base: sym(base) }) : undefined;
  if (!editable || !base || !packs.data?.items.length) return <span title={hint}>{sym(line.unitCode)}</span>;
  const options = [{ unitCode: base, factor: '1' }, ...packs.data.items];
  // строка с единицей не из списка (упаковку удалили) — оставляем её выбранной
  if (!options.some(o => o.unitCode === line.unitCode)) options.push({ unitCode: line.unitCode, factor: line.unitFactor });
  return (
    <select
      className="select cell-input"
      style={{ minWidth: 68 }}
      title={hint}
      aria-label={t('catalog.packs.unit')}
      value={line.unitCode}
      onChange={e => {
        const o = options.find(x => x.unitCode === e.target.value);
        if (o) onChange(o.unitCode, o.factor);
      }}
    >
      {options.map(o => (
        <option key={o.unitCode} value={o.unitCode}>
          {sym(o.unitCode)}
        </option>
      ))}
    </select>
  );
}
