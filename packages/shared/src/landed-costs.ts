/* Дополнительные расходы в себестоимость (задача 1385, как «Дополнительные расходы» в 1С УНФ).
   Сумма расходов (доставка, пошлина, погрузка) распределяется по строкам документов-оснований — по стоимости строки,
   по количеству, по весу или вручную. Распределение — целыми копейками методом наибольших остатков (apportionKop):
   сумма долей строго равна сумме расходов, лишняя копейка уходит строке с большим остатком от деления.

   Здесь только чистая арифметика без обращений к БД: те же функции считают сервер (при сохранении и проведении)
   и интерфейс (предпросмотр распределения), поэтому итог на экране и в проводке совпадает до копейки. */
import { dec, fmt, mul, type Dec } from './decimal';
import { fmtKop, toKop } from './documents';
import { apportionKop } from './product-kits';

/** Способы распределения доп. расходов по строкам оснований */
export const LANDED_COST_METHODS = ['by_amount', 'by_qty', 'by_weight', 'manual'] as const;
export type LandedCostMethod = (typeof LANDED_COST_METHODS)[number];

/** Документы-основания, приход товаров которых можно удорожить:
    поступление (`receipt`) и выпуск продукции (`production`, в том числе отчёт переработчика — выпуск на складе
    переработчика) — единственные документы, которые дают приход на наш склад.
    Приёма в переработку (`tolling_receipt`) здесь нет: это давальческое сырьё, оно учитывается количественно
    (customer_stock_moves), своего прихода на склад и своей себестоимости у него нет. */
export const LANDED_COST_BASE_TYPES = ['receipt', 'production'] as const;
export type LandedCostBaseType = (typeof LANDED_COST_BASE_TYPES)[number];
export const isLandedCostBaseType = (v: unknown): v is LandedCostBaseType =>
  typeof v === 'string' && (LANDED_COST_BASE_TYPES as readonly string[]).includes(v);

/** Суммы строки базового документа, по которым считается доля доп. расходов */
export interface LandedCostBaseSums {
  /** Стоимость строки без НДС (у организации на УСН — с НДС: так же, как приход попадает на склад) */
  baseAmount: string;
  /** Количество в базовых единицах (приход по строке) */
  qty: string;
  /** Вес строки: количество × вес единицы товара; пусто или 0 — вес не задан */
  weight?: string | null;
  /** Сумма, введённая вручную (только для способа `manual`) */
  amount?: string | null;
}

export interface LandedCostLineInput extends LandedCostBaseSums {
  id: string;
}

export interface LandedCostAllocationRow {
  lineId: string;
  /** Доля строки в деньгах (2 знака, точная сумма по всем строкам) */
  amount: string;
  /** Вес строки, по которому считалась доля (0 — вес не задан) */
  weight: string;
  /** Доля в процентах с двумя знаками (сумма = 100.00 при положительной базе) */
  sharePct: string;
}

export interface LandedCostAllocation {
  rows: LandedCostAllocationRow[];
  /** Фактически применённый способ: у «по весу» это может быть фолбэк на количество или сумму */
  mode: LandedCostMethod;
  /** true — вес не задан ни у одной строки, распределение ушло на количество/сумму */
  fallback: boolean;
  /** true — веса нет у части строк: они получают нулевую долю (распределение всё равно по весу) */
  partial: boolean;
  /** Сумма распределённых расходов */
  total: string;
}

const nonNeg = (v: Dec): Dec => (v > 0n ? v : 0n);

/** Веса строк для выбранного способа распределения.
    `by_weight` при полностью отсутствующем весе — фолбэк: сначала количество, затем сумма строки.
    Пустая база (все веса нулевые) даёт нулевые доли, а не деление на ноль. */
export function landedCostWeights(lines: readonly LandedCostBaseSums[], method: LandedCostMethod): { weights: Dec[]; mode: LandedCostMethod; fallback: boolean; partial: boolean } {
  if (method === 'manual') return { weights: lines.map(l => nonNeg(toKop(l.amount ?? '0')) * 10_000n), mode: 'manual', fallback: false, partial: false };
  if (method === 'by_amount') return { weights: lines.map(l => nonNeg(dec(l.baseAmount))), mode: 'by_amount', fallback: false, partial: false };
  if (method === 'by_qty') return { weights: lines.map(l => nonNeg(dec(l.qty))), mode: 'by_qty', fallback: false, partial: false };
  // by_weight
  const byWeight = lines.map(l => nonNeg(dec(l.weight ?? '0')));
  if (byWeight.some(w => w > 0n)) return { weights: byWeight, mode: 'by_weight', fallback: false, partial: byWeight.some(w => w === 0n) };
  const byQty = lines.map(l => nonNeg(dec(l.qty)));
  if (byQty.some(w => w > 0n)) return { weights: byQty, mode: 'by_qty', fallback: true, partial: false };
  return { weights: lines.map(l => nonNeg(dec(l.baseAmount))), mode: 'by_amount', fallback: true, partial: false };
}

/** Распределяет сумму доп. расходов по строкам оснований.
    `amount` — общая сумма расходов (для способа «вручную» не нужна: сумму дают строки).
    Копейки распределяются методом наибольших остатков, поэтому сумма долей равна сумме расходов. */
export function allocateLandedCost(opts: { method: LandedCostMethod; amount?: string | null; lines: readonly LandedCostLineInput[] }): LandedCostAllocation {
  const { lines, method } = opts;
  if (!lines.length) return { rows: [], mode: method, fallback: false, partial: false, total: '0.00' };
  const { weights, mode, fallback, partial } = landedCostWeights(lines, method);
  const totalKop = method === 'manual' ? lines.reduce((s, l) => s + toKop(l.amount ?? '0'), 0n) : toKop(opts.amount ?? '0');
  const shares = apportionKop(totalKop, weights);
  const sharePcts = apportionKop(10_000n, weights);
  const hasBase = weights.some(w => w > 0n);
  return {
    rows: lines.map((l, i) => ({
      lineId: l.id,
      amount: fmtKop(shares[i]!),
      weight: fmt(dec(l.weight ?? '0'), 3),
      sharePct: hasBase ? fmtKop(sharePcts[i]!) : '0.00',
    })),
    mode,
    fallback,
    partial,
    total: fmtKop(totalKop),
  };
}

/** Вес строки для распределения «по весу»: количество × вес единицы товара (0 — вес не задан).
    Считается на сервере по справочнику и передаётся в распределение; в интерфейсе — то же значение. */
export const landedCostLineWeight = (qty: string, weightKg: string | null | undefined): string => fmt(mul(dec(qty), nonNeg(dec(weightKg ?? '0'))), 3);

/** Проверка ручного распределения: суммы неотрицательны, и хотя бы одна строка получает деньги */
export function manualLandedCostError(lines: readonly LandedCostBaseSums[]): 'empty' | 'negative' | 'zero' | null {
  if (!lines.length) return 'empty';
  if (lines.some(l => toKop(l.amount ?? '0') < 0n)) return 'negative';
  if (lines.every(l => toKop(l.amount ?? '0') === 0n)) return 'zero';
  return null;
}
