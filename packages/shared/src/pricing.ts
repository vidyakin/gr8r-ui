/* Виды цен и прайс-листы (задача 1178): чистые расчёты — правило расчётного вида, округление, выбор вида цен документа.
   Правила — docs/architecture/pricing.md. Деньги — строки и decimal.ts, без float. */
import { dec, fmt, pctOf, type Dec } from './decimal';

export const PRICE_METHODS = ['manual', 'derived', 'cost_based'] as const;
export type PriceMethod = (typeof PRICE_METHODS)[number];
/** База расчёта «от себестоимости»: средняя себестоимость остатков или последняя закупка */
export const COST_BASES = ['avg_cost', 'last_purchase'] as const;
export type CostBasis = (typeof COST_BASES)[number];
export const ROUNDING_STEPS = ['0.01', '1', '10', '100'] as const;
export type RoundingStep = (typeof ROUNDING_STEPS)[number];
/** Округление: по математике или всегда вверх */
export const ROUNDING_MODES = ['math', 'up'] as const;
export type RoundingMode = (typeof ROUNDING_MODES)[number];
/** Системные виды цен воркспейса */
export const SYSTEM_PRICE_KINDS = [
  { key: 'retail', name: 'Розничная' },
  { key: 'purchase', name: 'Закупочная' },
] as const;
export type PriceKindKey = (typeof SYSTEM_PRICE_KINDS)[number]['key'];

export interface RoundingRule {
  step: string;
  mode: RoundingMode;
  /** «До 9»: 99, 199, 9, 19… — после округления вычитается единица (только при шаге 10 и 100) */
  nine: boolean;
}

export const NO_ROUNDING: RoundingRule = { step: '0.01', mode: 'math', nine: false };

/** Допустимость «до 9»: только крупный шаг */
export const nineAllowed = (step: string): boolean => dec(step) >= dec('10');

/** Округление цены по правилу вида; результат не отрицателен */
export function roundPrice(value: Dec, rule: RoundingRule): Dec {
  const step = dec(rule.step);
  if (step <= 0n) return value < 0n ? 0n : value;
  let steps = value / step;
  const rest = value % step;
  if (rule.mode === 'up') {
    if (rest > 0n) steps += 1n;
  } else if (rest * 2n >= step) steps += 1n;
  let out = steps * step;
  if (rule.nine && nineAllowed(rule.step) && out > 0n) out -= dec('1');
  return out < 0n ? 0n : out;
}

/** Цена по наценке (+) или скидке (−) в процентах от базы и округление */
export function applyMarkup(base: Dec, markupPct: string | Dec, rule: RoundingRule): Dec {
  const pct = typeof markupPct === 'bigint' ? markupPct : dec(markupPct);
  return roundPrice(base + pctOf(base, pct), rule);
}

/** Цена строкой с двумя знаками */
export const priceStr = (v: Dec): string => fmt(v, 2);

/** Вид цен считается из других данных (а не только вводится) */
export const isRuleKind = (method: string): boolean => method === 'derived' || method === 'cost_based';

/** Выбор вида цен документа: шапка ← договор ← контрагент ← вид заказ-наряда ← розничная;
    закупка — шапка ← договор ← вид цен поставщика ← закупочная */
export interface PriceKindPick {
  party: 'customer' | 'supplier';
  headerKindId?: string | null | undefined;
  contractKindId?: string | null | undefined;
  companyKindId?: string | null | undefined;
  workOrderKindId?: string | null | undefined;
  /** Вид цен поставщика (kind.supplier_id = контрагент) */
  supplierKindId?: string | null | undefined;
  retailKindId: string;
  purchaseKindId: string;
}

export type PriceKindSource = 'header' | 'contract' | 'company' | 'work_order_kind' | 'supplier' | 'default';

export function pickPriceKind(p: PriceKindPick): { kindId: string; source: PriceKindSource } {
  if (p.headerKindId) return { kindId: p.headerKindId, source: 'header' };
  if (p.contractKindId) return { kindId: p.contractKindId, source: 'contract' };
  if (p.party === 'supplier') {
    if (p.supplierKindId) return { kindId: p.supplierKindId, source: 'supplier' };
    return { kindId: p.purchaseKindId, source: 'default' };
  }
  if (p.companyKindId) return { kindId: p.companyKindId, source: 'company' };
  if (p.workOrderKindId) return { kindId: p.workOrderKindId, source: 'work_order_kind' };
  return { kindId: p.retailKindId, source: 'default' };
}

/** Закупочные виды (системная «Закупочная», расчётные от себестоимости, цены поставщиков): их видит тот, кто видит себестоимость */
export const isCostKind = (k: { systemKey: string | null; method: string; supplierId: string | null }): boolean => k.systemKey === 'purchase' || k.method === 'cost_based' || !!k.supplierId;

/** Цикл в цепочке расчётных видов: base → base… */
export function hasKindCycle(kindId: string, baseOf: (id: string) => string | null | undefined): boolean {
  const seen = new Set<string>([kindId]);
  let cur = baseOf(kindId);
  while (cur) {
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = baseOf(cur);
  }
  return false;
}

/** Массовое изменение цены: «+N %» и округление */
export function changeByPercent(price: string, pct: string, rule: RoundingRule): string {
  return priceStr(applyMarkup(dec(price), pct, rule));
}
