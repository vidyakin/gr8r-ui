/* Прогноз прибыли объекта (задача 1275, docs/architecture/construction.md). Чистый расчёт без БД: те же правила
   на сервере, в портфеле и в подсказках интерфейса. Деньги — копейки, часы — тысячные; десятичная арифметика
   из decimal.ts, без float.
   Правила:
   - прогноз себестоимости = (факт прямых + остаток прямых) × (1 + накладные % объекта);
   - остаток позиции work — по темпу подтверждённого труда: (факт труда / done_qty) × (qty − done_qty);
     не начата — плановая себестоимость оставшегося объёма; выполнена — 0;
   - остаток позиции subcontract — (qty − принятое по актам) × cost_price;
   - остаток категорий material (материалы и щиты) и other — max(план категории − факт категории, 0):
     по этим категориям факт известен только целиком, по позициям он не распределяется;
   - ручная правка (позиция или категория) заменяет остаток целиком и всегда с причиной;
   - прибыль = стоимость договора − прогноз себестоимости; маржа при нулевой стоимости не считается;
   - нет согласованной сметы — прогноз не строится (null) с причиной; пробелы (нет ставки, нет плановой
     себестоимости) показываются, а не считаются нулём. */
import { dec, div, fmt, mul, pctOf, type Dec } from './decimal';
import type { ObjectCostCategory } from './constants';
import { estimateLineTotals, ESTIMATE_KIND_CATEGORY, type EstimateItemKind } from './estimates';

/** Как посчитан остаток строки прогноза */
export const FORECAST_BASES = ['tempo', 'plan', 'accepted', 'category', 'override', 'zero'] as const;
export type ForecastBasis = (typeof FORECAST_BASES)[number];

/** Коды пробелов данных: показываются в отчёте отдельным блоком, а не считаются нулём */
export const FORECAST_GAP_CODES = ['no_estimate', 'no_cost_price', 'no_labor_fact', 'no_rate_hours'] as const;
export type ForecastGapCode = (typeof FORECAST_GAP_CODES)[number];

/** Позиция сметы для прогноза: объём, цена заказчику, плановая себестоимость и выполненный объём */
export interface ForecastItemInput {
  id: string;
  kind: EstimateItemKind | string;
  name: string;
  unitCode: string;
  qty: string;
  price: string;
  costPrice: string;
  laborHours: string;
  doneQty: string;
}

/** Факт труда по позиции сметы из подтверждённых смен: часы и их стоимость (null — ставки нет) */
export interface ForecastItemLabor {
  itemId: string;
  hours: string;
  /** Стоимость подтверждённых часов; null — ни у одной строки часов нет ставки */
  cost: string | null;
  /** Часы без ставки: стоимость не определена (пробел) */
  hoursWithoutCost: string;
}

/** Принятое по позиции субподряда из принятых актов субподрядчика */
export interface ForecastItemAccepted {
  itemId: string;
  qty: string;
}

/** Ручная правка остатка: по позиции сметы или по категории затрат целиком */
export interface ForecastOverrideInput {
  estimateItemId: string | null;
  category: ObjectCostCategory | null;
  remaining: string;
  reason: string;
}

/** Вход расчёта: план по позициям, факты, правки и накладные объекта */
export interface ObjectForecastInput {
  /** Есть согласованная основная смета: без неё прогноз не строится */
  hasEstimate: boolean;
  /** Стоимость договора: согласованная основная смета и согласованные допработы, без НДС */
  contractValue: string;
  /** Накладные объекта, процент от прямых затрат */
  overheadPct: string;
  /** Позиции согласованной основной сметы и согласованных допработ */
  items: ForecastItemInput[];
  /** Факт по категориям (objectCostFacts) без НДС */
  facts: Record<ObjectCostCategory, string>;
  laborByItem: ForecastItemLabor[];
  acceptedByItem: ForecastItemAccepted[];
  overrides: ForecastOverrideInput[];
}

export interface ObjectForecastGap {
  code: ForecastGapCode;
  /** Позиция сметы, к которой относится пробел */
  itemId?: string;
  name?: string;
  /** Часы без ставки (код no_rate_hours) */
  hours?: string;
  /** Сколько позиций затронуто (код no_cost_price / no_rate_hours) */
  count?: number;
}

/** Строка прогноза по позиции сметы */
export interface ObjectForecastItemRow {
  id: string;
  kind: string;
  category: ObjectCostCategory;
  name: string;
  unitCode: string;
  qty: string;
  doneQty: string;
  /** Выполнено, % от объёма; null — объём нулевой */
  donePct: string | null;
  planCost: string;
  /** Факт по позиции; null — по категории целиком (материалы, прочие) */
  factCost: string | null;
  planHours: string;
  factHours: string;
  remainingHours: string;
  forecastHours: string;
  remaining: string | null;
  /** Прогноз себестоимости позиции = факт + остаток; null — факта по позиции нет */
  forecast: string | null;
  /** Отклонение прогноза от плана: плюс — дороже плана */
  deviation: string | null;
  basis: ForecastBasis;
  /** Остаток заменён вручную */
  overridden: boolean;
  overrideReason: string | null;
  /** У позиции не задана плановая себестоимость */
  noCostPrice: boolean;
}

/** Итог по категории затрат с раскрытием по позициям сметы */
export interface ObjectForecastCategoryRow {
  category: ObjectCostCategory;
  planCost: string;
  factCost: string;
  /** Остаток ожидаемых затрат; null — прогноз не строится (нет согласованной сметы) */
  remaining: string | null;
  forecast: string | null;
  deviation: string | null;
  overridden: boolean;
  overrideReason: string | null;
  items: ObjectForecastItemRow[];
}

/** Итоги прогноза объекта */
export interface ObjectForecastTotals {
  /** Плановая себестоимость согласованной сметы и допработ */
  planCost: string;
  /** Факт прямых затрат по категориям */
  factCost: string;
  /** Остаток прямых затрат */
  remaining: string | null;
  /** Накладные: процент объекта от прямых затрат */
  overhead: string | null;
  /** Прогноз себестоимости; null — прогноз не строится */
  forecastCost: string | null;
  /** Стоимость договора без НДС */
  contractValue: string;
  profit: string | null;
  /** Маржа в процентах от стоимости договора; null — стоимость нулевая или прогноза нет */
  marginPct: string | null;
}

export interface ObjectForecastResult {
  hasEstimate: boolean;
  overheadPct: string;
  categories: ObjectForecastCategoryRow[];
  totals: ObjectForecastTotals;
  gaps: ObjectForecastGap[];
}

const round2 = (v: Dec): Dec => dec(fmt(v, 2));
const round3 = (v: Dec): Dec => dec(fmt(v, 3));
const money = (v: Dec): string => fmt(v, 2);
const hours3 = (v: Dec): string => fmt(v, 3);

/** Процент с одним знаком после запятой; знаменатель нулевой — null (маржа при нулевой стоимости не считается) */
const percent = (value: Dec, total: Dec): string | null => (total <= 0n ? null : fmt(div(value * 100n, total), 1));

/**
 * Прогноз прибыли объекта: строки по позициям, итоги по категориям, прогноз себестоимости, прибыль, маржа и пробелы.
 * Функция ничего не знает о БД и правах: отдачу сумм решает сервис (owner/admin).
 */
export function computeObjectForecast(input: ObjectForecastInput): ObjectForecastResult {
  const gaps: ObjectForecastGap[] = [];
  if (!input.hasEstimate) gaps.push({ code: 'no_estimate' });

  // правки: по позициям и по категориям (уникальны по цели — это гарантирует и БД)
  const itemOverrides = new Map<string, ForecastOverrideInput>();
  const categoryOverrides = new Map<ObjectCostCategory, ForecastOverrideInput>();
  for (const o of input.overrides) {
    if (o.estimateItemId) itemOverrides.set(o.estimateItemId, o);
    else if (o.category) categoryOverrides.set(o.category, o);
  }
  const laborByItem = new Map(input.laborByItem.map(l => [l.itemId, l]));
  const acceptedByItem = new Map(input.acceptedByItem.map(a => [a.itemId, a]));

  const categories = new Map<ObjectCostCategory, ObjectForecastCategoryRow>();
  const ensureCategory = (category: ObjectCostCategory): ObjectForecastCategoryRow => {
    let row = categories.get(category);
    if (!row) {
      row = {
        category,
        planCost: '0.00',
        factCost: money(dec(input.facts[category])),
        remaining: '0.00',
        forecast: '0.00',
        deviation: '0.00',
        overridden: false,
        overrideReason: null,
        items: [],
      };
      categories.set(category, row);
    }
    return row;
  };

  let noCostPriceCount = 0;
  let hoursWithoutCostTotal = 0n;
  let hoursWithoutCostCount = 0;

  for (const item of input.items) {
    const category = ESTIMATE_KIND_CATEGORY[item.kind as EstimateItemKind] ?? 'other';
    const cat = ensureCategory(category);
    const plan = estimateLineTotals(item);
    const qty = dec(item.qty);
    const done = dec(item.doneQty);
    const restQty = qty - done > 0n ? qty - done : 0n;
    const costPrice = dec(item.costPrice);
    const noCostPrice = costPrice === 0n;
    if (noCostPrice) noCostPriceCount += 1;
    const itemOverride = itemOverrides.get(item.id) ?? null;

    const labor = laborByItem.get(item.id);
    const factHours = labor ? round3(dec(labor.hours)) : 0n;
    if (labor && dec(labor.hoursWithoutCost) > 0n) {
      hoursWithoutCostTotal += dec(labor.hoursWithoutCost);
      hoursWithoutCostCount += 1;
    }

    let factCost: Dec | null = null;
    let remaining: Dec | null = null;
    let basis: ForecastBasis = 'category';
    const planHours = round3(dec(plan.hours));
    let remainingHours = 0n;

    if (item.kind === 'work') {
      const laborCost = labor?.cost == null ? null : dec(labor.cost);
      factCost = laborCost;
      // часы: по темпу подтверждённого труда, иначе плановая норма на оставшийся объём
      if (done > 0n && done < qty && factHours > 0n) remainingHours = round3(div(mul(factHours, restQty), done));
      else if (done >= qty && qty > 0n) remainingHours = 0n;
      else remainingHours = round3(mul(restQty, dec(item.laborHours)));
      if (itemOverride) {
        remaining = round2(dec(itemOverride.remaining));
        basis = 'override';
      } else if (done >= qty && qty > 0n) {
        remaining = 0n;
        basis = 'zero';
      } else if (done > 0n && laborCost !== null && laborCost > 0n) {
        // по темпу: стоимость выполненного труда на единицу × оставшийся объём
        remaining = round2(div(mul(laborCost, restQty), done));
        basis = 'tempo';
      } else {
        remaining = round2(mul(restQty, costPrice));
        basis = 'plan';
        // выполнение есть, а подтверждённого труда по позиции нет — остаток только по плану
        if (done > 0n) gaps.push({ code: 'no_labor_fact', itemId: item.id, name: item.name });
      }
    } else if (item.kind === 'subcontract') {
      const accepted = round3(dec(acceptedByItem.get(item.id)?.qty ?? '0'));
      const acceptedRest = qty - accepted > 0n ? qty - accepted : 0n;
      factCost = round2(mul(accepted, costPrice));
      if (itemOverride) {
        remaining = round2(dec(itemOverride.remaining));
        basis = 'override';
      } else {
        remaining = round2(mul(acceptedRest, costPrice));
        basis = 'accepted';
      }
    } else {
      // материалы, щиты и прочие: факт и остаток считаются только по категории целиком
      if (itemOverride) {
        remaining = round2(dec(itemOverride.remaining));
        basis = 'override';
      }
    }

    const forecast = factCost !== null && remaining !== null ? round2(factCost + remaining) : null;
    const deviation = forecast !== null ? round2(forecast - dec(plan.cost)) : null;
    cat.planCost = money(dec(cat.planCost) + dec(plan.cost));
    cat.items.push({
      id: item.id,
      kind: item.kind,
      category,
      name: item.name,
      unitCode: item.unitCode,
      qty: item.qty,
      doneQty: item.doneQty,
      donePct: percent(done, qty),
      planCost: plan.cost,
      factCost: factCost === null ? null : money(factCost),
      planHours: hours3(planHours),
      factHours: hours3(factHours),
      remainingHours: hours3(remainingHours),
      forecastHours: hours3(factHours + remainingHours),
      remaining: remaining === null ? null : money(remaining),
      forecast: forecast === null ? null : money(forecast),
      deviation: deviation === null ? null : money(deviation),
      basis,
      overridden: !!itemOverride,
      overrideReason: itemOverride?.reason ?? null,
      noCostPrice,
    });
  }

  if (noCostPriceCount) gaps.push({ code: 'no_cost_price', count: noCostPriceCount });
  if (hoursWithoutCostTotal > 0n) gaps.push({ code: 'no_rate_hours', hours: fmt(hoursWithoutCostTotal, 2), count: hoursWithoutCostCount });

  // факт по категории может быть и без позиций сметы (например, прочие затраты документами)
  for (const category of ['material', 'labor', 'subcontract', 'other'] as const) {
    const cat = ensureCategory(category);
    const plan = dec(cat.planCost);
    const fact = dec(cat.factCost);
    let remaining: Dec | null;
    const override = categoryOverrides.get(category) ?? null;
    if (!input.hasEstimate) {
      remaining = null;
    } else if (override) {
      remaining = round2(dec(override.remaining));
      cat.overridden = true;
      cat.overrideReason = override.reason;
    } else if (category === 'material' || category === 'other') {
      // по этим категориям факт известен только целиком: остаток = план − факт, но не меньше нуля
      remaining = plan - fact > 0n ? round2(plan - fact) : 0n;
    } else {
      // труд и субподряд: сумма остатков позиций (правки позиций уже учтены)
      let sum = 0n;
      for (const row of cat.items) if (row.remaining !== null) sum += dec(row.remaining);
      remaining = round2(sum);
    }
    cat.remaining = remaining === null ? null : money(remaining);
    cat.forecast = remaining === null ? null : money(fact + remaining);
    cat.deviation = cat.forecast === null ? null : money(dec(cat.forecast) - plan);
  }

  const categoryRows = (['material', 'labor', 'subcontract', 'other'] as const).map(c => categories.get(c)!);

  let planTotal = 0n;
  let factTotal = 0n;
  let remainingTotal = 0n;
  let canForecast = input.hasEstimate;
  for (const cat of categoryRows) {
    planTotal += dec(cat.planCost);
    factTotal += dec(cat.factCost);
    if (cat.remaining === null) canForecast = false;
    else remainingTotal += dec(cat.remaining);
  }

  const direct = factTotal + remainingTotal;
  const overhead = round2(pctOf(direct, dec(input.overheadPct)));
  const forecastCost = canForecast ? round2(direct + overhead) : null;
  const contractValue = round2(dec(input.contractValue));
  const profit = forecastCost === null ? null : round2(contractValue - forecastCost);
  const marginPct = profit === null ? null : percent(profit, contractValue);

  return {
    hasEstimate: input.hasEstimate,
    overheadPct: fmt(dec(input.overheadPct), 2),
    categories: categoryRows,
    totals: {
      planCost: money(planTotal),
      factCost: money(factTotal),
      remaining: canForecast ? money(remainingTotal) : null,
      overhead: canForecast ? money(overhead) : null,
      forecastCost: forecastCost === null ? null : money(forecastCost),
      contractValue: money(contractValue),
      profit: profit === null ? null : money(profit),
      marginPct,
    },
    gaps,
  };
}
