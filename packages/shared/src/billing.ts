/* Договоры, тарифные планы и расчёт счёта периода — чистые функции без БД (этап 8 «УНФ: Услуги»).

   Здесь три вещи:
   - календарь периодов (месяц / квартал / год) и подпись периода по-русски (печатные формы у нас русские);
   - пропорция по дням действия договора (неполный первый и последний период);
   - правила абонентской позиции из 1С:УНФ — «первичек нет или оказано ≤ плана — по плану, заказ-нарядом больше — по первичному
     документу, учётом времени больше — абонентская часть по плану + разница по прайсу».

   Деньги и количества — десятичные (decimal.ts), без float. */
import { dec, fmt, mul, roundDiv, type Dec } from './decimal';

/* ---------------- виды и настройки ---------------- */

/** Вид договора: с покупателем, с поставщиком, прочее (комиссия, эквайринг и доставка — вне объёма) */
export const CONTRACT_KINDS = ['customer', 'supplier', 'other'] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];
export const CONTRACT_KIND_LABELS: Record<ContractKind, string> = { customer: 'Customer', supplier: 'Supplier', other: 'Other' };

/** Периодичность биллинга: месяц, квартал, год */
export const BILLING_PERIODICITIES = ['month', 'quarter', 'year'] as const;
export type BillingPeriodicity = (typeof BILLING_PERIODICITIES)[number];
export const BILLING_PERIODICITY_LABELS: Record<BillingPeriodicity, string> = { month: 'Monthly', quarter: 'Quarterly', year: 'Yearly' };

/** Пакет документов договора обслуживания: только счёт или счёт и акт */
export const BILLING_PACKAGES = ['invoice', 'invoice_act'] as const;
export type BillingPackage = (typeof BILLING_PACKAGES)[number];
export const BILLING_PACKAGE_LABELS: Record<BillingPackage, string> = { invoice: 'Invoice only', invoice_act: 'Invoice and act' };

/** Что делать с номенклатурой вне тарифного плана */
export const EXTRA_PRODUCT_POLICIES = ['allow', 'warn', 'forbid'] as const;
export type ExtraProductPolicy = (typeof EXTRA_PRODUCT_POLICIES)[number];
export const EXTRA_PRODUCT_POLICY_LABELS: Record<ExtraProductPolicy, string> = { allow: 'Allow', warn: 'Warn', forbid: 'Forbid' };

/** Виды первичных документов биллинга */
export const BILLING_SOURCE_KINDS = ['work_order', 'time_log', 'realization'] as const;
export type BillingSourceKind = (typeof BILLING_SOURCE_KINDS)[number];
export const BILLING_SOURCE_KIND_LABELS: Record<BillingSourceKind, string> = { work_order: 'Work order', time_log: 'Time entry', realization: 'Shipment' };

/* ---------------- часовой пояс воркспейса ---------------- */

/** Часовые пояса IANA, поддерживаемые рантаймом (для настройки арендатора) */
export function supportedTimezones(): string[] {
  const anyIntl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  const list = anyIntl.supportedValuesOf?.('timeZone');
  return list && list.length ? list : ['UTC', 'Europe/Moscow', 'Europe/Kaliningrad', 'Asia/Yekaterinburg', 'Asia/Novosibirsk', 'Asia/Vladivostok'];
}

/** Проверка часового пояса: неизвестный IANA-идентификатор — ошибка */
export function isValidTimezone(timezone: string): boolean {
  if (!timezone || timezone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Дата (YYYY-MM-DD) в часовом поясе воркспейса: «сейчас» для биллинга и расписаний */
export function dateInTimezone(timezone: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** Стенные часы в поясе воркспейса как Date с UTC-полями: так «сейчас» сравнивается с выражением cron */
export function wallClock(at: Date, timezone: string): Date {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(at);
    const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
    const hour = get('hour');
    return new Date(Date.UTC(get('year'), get('month') - 1, get('day'), hour === 24 ? 0 : hour, get('minute')));
  } catch {
    return new Date(Math.floor(at.getTime() / 60_000) * 60_000);
  }
}

/* ---------------- календарь периодов ---------------- */

export interface BillingPeriod {
  /** Ключ периода: «2026-10», «2026-Q3», «2026» */
  key: string;
  /** Первый день периода */
  start: string;
  /** Последний день периода */
  end: string;
}

const MONTHS_RU = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_RU_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const pad = (n: number) => String(n).padStart(2, '0');
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const toDate = (d: string) => new Date(`${d}T00:00:00Z`);
const toIso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Период, в который попадает дата */
export function periodOf(periodicity: BillingPeriodicity, date: string): BillingPeriod {
  const d = toDate(date);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0..11
  if (periodicity === 'month') {
    return { key: `${y}-${pad(m + 1)}`, start: `${y}-${pad(m + 1)}-01`, end: `${y}-${pad(m + 1)}-${pad(daysInMonth(y, m + 1))}` };
  }
  if (periodicity === 'quarter') {
    const q = Math.floor(m / 3);
    const first = q * 3;
    const last = first + 2;
    return { key: `${y}-Q${q + 1}`, start: `${y}-${pad(first + 1)}-01`, end: `${y}-${pad(last + 1)}-${pad(daysInMonth(y, last + 1))}` };
  }
  return { key: `${y}`, start: `${y}-01-01`, end: `${y}-12-31` };
}

/** Период по ключу («2026-10», «2026-Q3», «2026») */
export function periodByKey(_periodicity: BillingPeriodicity, key: string): BillingPeriod {
  const m = /^(\d{4})(?:-(?:Q(\d)|(\d{2})))?$/.exec(key);
  if (!m) throw new Error(`Invalid period key "${key}"`);
  const y = Number(m[1]);
  if (m[2]) {
    const q = Number(m[2]);
    if (q < 1 || q > 4) throw new Error(`Invalid quarter in "${key}"`);
    const first = (q - 1) * 3;
    const last = first + 2;
    return { key: `${y}-Q${q}`, start: `${y}-${pad(first + 1)}-01`, end: `${y}-${pad(last + 1)}-${pad(daysInMonth(y, last + 1))}` };
  }
  if (m[3]) {
    const mo = Number(m[3]);
    if (mo < 1 || mo > 12) throw new Error(`Invalid month in "${key}"`);
    return { key: `${y}-${pad(mo)}`, start: `${y}-${pad(mo)}-01`, end: `${y}-${pad(mo)}-${pad(daysInMonth(y, mo))}` };
  }
  return { key: `${y}`, start: `${y}-01-01`, end: `${y}-12-31` };
}

/** Период, следующий за указанным (n может быть отрицательным) */
export function shiftPeriod(periodicity: BillingPeriodicity, period: BillingPeriod, n: number): BillingPeriod {
  const d = toDate(period.start);
  if (periodicity === 'month') {
    const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1);
    return periodOf('month', toIso(new Date(t)));
  }
  if (periodicity === 'quarter') {
    const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n * 3, 1);
    return periodOf('quarter', toIso(new Date(t)));
  }
  return periodOf('year', toIso(new Date(Date.UTC(d.getUTCFullYear() + n, 0, 1))));
}

/** Число дней в периоде (включительно) */
export function periodDays(period: BillingPeriod): number {
  return Math.round((toDate(period.end).getTime() - toDate(period.start).getTime()) / 86_400_000) + 1;
}

/** Подпись периода для строки счёта: «за октябрь 2026». Печатные формы русские — подпись тоже */
export function periodLabelRu(period: BillingPeriod): string {
  const d = toDate(period.start);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (/^\d{4}-\d{2}$/.test(period.key)) return `за ${MONTHS_RU[m]} ${y}`;
  if (/-Q\d$/.test(period.key)) return `за ${Number(period.key.slice(-1))} квартал ${y}`;
  return `за ${y} год`;
}

/** Подпись периода в родительном падеже (для заголовков: «услуги за сентябрь 2026») */
export function periodLabelRuGen(period: BillingPeriod): string {
  const d = toDate(period.start);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (/^\d{4}-\d{2}$/.test(period.key)) return `за ${MONTHS_RU_GEN[m]} ${y}`;
  if (/-Q\d$/.test(period.key)) return `за ${Number(period.key.slice(-1))} квартал ${y}`;
  return `за ${y} год`;
}

/* ---------------- пропорция по дням ---------------- */

export interface Coverage {
  /** Сколько дней договора попало в период */
  days: number;
  /** Доля периода, покрытая договором (0..1) */
  factor: Dec;
}

/** Сколько дней действия договора попадает в период: неполный первый и последний период считаются пропорционально.
    Договор без конца (validTo = null) действует бессрочно */
export function contractCoverage(validFrom: string, validTo: string | null, period: BillingPeriod): Coverage {
  const from = validFrom > period.start ? validFrom : period.start;
  const to = validTo ? (validTo < period.end ? validTo : period.end) : period.end;
  if (to < from) return { days: 0, factor: 0n };
  const days = Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000) + 1;
  const total = periodDays(period);
  const factor = roundDiv(dec(days) * 1_000_000n, dec(total));
  return { days, factor };
}

/** Количество с пропорцией по дням (округление до трёх знаков — как количество в документе) */
export function prorate(qty: string, coverage: Coverage): string {
  if (coverage.factor <= 0n) return '0.000';
  return fmt(roundDiv(dec(qty) * coverage.factor, 1_000_000n), 3);
}

/* ---------------- расчёт счёта периода ---------------- */

/** Строка тарифного плана */
export interface TariffPlanLine {
  id?: string;
  productId: string;
  qty: string;
  price: string;
  /** Включено в абонплату: выставляется каждый период по цене плана (предоплата) */
  isSubscription: boolean;
  /** Представление в счёте: в печатную форму попадает другая номенклатура */
  invoiceAsProductId?: string | null;
}

/** Первичный документ биллинга: заказ-наряд, запись времени или проведённая отгрузка */
export interface BillingFact {
  sourceKind: BillingSourceKind;
  sourceId: string;
  productId: string;
  qty: string;
  /** Цена первички; у учёта времени её нет — берётся цена прайса */
  price: string | null;
  date: string;
  name?: string;
}

/** Номенклатура каталога: название, единица, ставка НДС и цена прайса */
export interface BillingProduct {
  id: string;
  name: string;
  unitCode: string;
  vatRate: string;
  /** Цена прайса (по умолчанию) */
  price: string;
}

export interface BillingBreakdownRow {
  /** Источник строки: план, заказ-наряд, учёт времени, отгрузка */
  source: 'plan' | BillingSourceKind;
  sourceId: string | null;
  productId: string;
  name: string;
  qty: string;
  price: string;
  /** Сумма строки (количество × цена) */
  amount: string;
}

export interface BillingLine {
  /** Номенклатура строки счёта */
  productId: string;
  /** Название строки с периодом оказания услуг */
  name: string;
  unitCode: string;
  qty: string;
  price: string;
  vatRate: string;
  /** Представление в счёте (для группировки строк в печатной форме) */
  invoiceAsProductId: string | null;
  /** Расшифровка строки: откуда она взялась */
  breakdown: BillingBreakdownRow[];
}

/** Внутренняя строка расчёта: с меткой периода (для группировки по представлению в счёте) */
type RawLine = BillingLine & { label: string };

export interface BillingComputation {
  lines: BillingLine[];
  /** Предупреждения (внеплановые позиции при политике «предупредить») */
  warnings: string[];
  /** Первичные документы, попавшие в счёт: каждый ровно один раз */
  sources: { sourceKind: BillingSourceKind; sourceId: string }[];
}

export interface BillingInput {
  /** Строки тарифного плана договора */
  tariffLines: TariffPlanLine[];
  /** Первичные документы периода (уже отобранные по дате) */
  facts: BillingFact[];
  /** Номенклатура по id */
  products: Record<string, BillingProduct>;
  /** Период абонплаты (текущий) */
  subscriptionPeriod: BillingPeriod;
  /** Период фактических работ (прошедший) */
  factPeriod: BillingPeriod;
  /** Срок действия договора — для пропорции по дням */
  validFrom: string;
  validTo: string | null;
  /** Политика внеплановых позиций */
  extraProductPolicy?: ExtraProductPolicy;
}

const amount = (qty: string, price: string) => fmt(roundDiv(dec(qty) * dec(price), 1_000_000n), 2);

const productOf = (input: BillingInput, id: string): BillingProduct => input.products[id] ?? { id, name: id, unitCode: '796', vatRate: '20', price: '0' };

/** Строки счёта по договору обслуживания: абонплата за текущий период (с пропорцией по дням) + работы по факту за прошедший */
export function computeBilling(input: BillingInput): BillingComputation {
  const lines: RawLine[] = [];
  const warnings: string[] = [];
  const coverage = contractCoverage(input.validFrom, input.validTo, input.subscriptionPeriod);
  const planByProduct = new Map<string, TariffPlanLine>();
  for (const t of input.tariffLines) planByProduct.set(t.productId, t);

  // первичные документы: по номенклатуре и по наличию цены
  const factsByProduct = new Map<string, BillingFact[]>();
  for (const f of input.facts) {
    const arr = factsByProduct.get(f.productId) ?? [];
    arr.push(f);
    factsByProduct.set(f.productId, arr);
  }

  const usedSources = new Set<string>();
  const markUsed = (kind: BillingSourceKind, id: string) => usedSources.add(billingSourcesKey(kind, id));

  for (const plan of input.tariffLines) {
    const product = productOf(input, plan.productId);
    const facts = factsByProduct.get(plan.productId) ?? [];
    const label = periodLabelRu(plan.isSubscription ? input.subscriptionPeriod : input.factPeriod);

    if (plan.isSubscription) {
      // абонентская позиция. Абонплата выставляется авансом: в счёт периода — абонплата текущего периода по плану
      // (пропорция по дням), а работы прошедшего периода в пределах его абонплаты уже оплачены. Сверх неё — перерасход:
      // количество сверх плана по цене первичного документа (учёт времени без цены — по прайсу).
      // Решение пользователя 2026-10-22 (вместо замены плана первичкой из примера 3 справки 1С: та рассчитана на счёт по факту).
      if (coverage.factor > 0n) {
        lines.push(planLine(plan, product, label, coverage, [{ source: 'plan', sourceId: null, productId: plan.productId, name: product.name, qty: plan.qty, price: plan.price, amount: amount(prorate(plan.qty, coverage), plan.price) }]));
      }
      if (!facts.length) continue;
      let covered = dec(prorate(plan.qty, contractCoverage(input.validFrom, input.validTo, input.factPeriod)));
      const rows: BillingBreakdownRow[] = [];
      for (const f of [...facts].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
        markUsed(f.sourceKind, f.sourceId);
        const q = dec(f.qty);
        const inPlan = q < covered ? q : covered;
        covered -= inPlan;
        const over = q - inPlan;
        if (over <= 0n) continue;
        const price = f.price ?? product.price;
        rows.push({ source: f.sourceKind, sourceId: f.sourceId, productId: f.productId, name: f.name ?? product.name, qty: fmt(over, 3), price, amount: amount(fmt(over, 3), price) });
      }
      if (rows.length) lines.push(factLine(plan.productId, product, periodLabelRu(input.factPeriod), plan.invoiceAsProductId ?? null, rows));
      continue;
    }

    // не абонентская позиция плана: по факту
    if (!facts.length) continue;
    const listPrice = product.price;
    const rows: BillingBreakdownRow[] = [];
    for (const f of facts) {
      markUsed(f.sourceKind, f.sourceId);
      const price = f.price ?? listPrice;
      rows.push({ source: f.sourceKind, sourceId: f.sourceId, productId: f.productId, name: f.name ?? product.name, qty: fmt(dec(f.qty), 3), price, amount: amount(f.qty, price) });
    }
    const total = rows.reduce((s, r) => s + dec(r.amount), 0n);
    const qty = rows.reduce((s, r) => s + dec(r.qty), 0n);
    // цена строки — средневзвешенная по количеству: сумма строк сходится с суммой первичек
    const price = qty > 0n ? fmt(roundDiv(total * 1_000_000n, qty), 2) : '0.00';
    lines.push({
      productId: plan.productId,
      name: `${product.name} ${label}`,
      unitCode: product.unitCode,
      qty: fmt(qty, 3),
      price,
      vatRate: product.vatRate,
      invoiceAsProductId: plan.invoiceAsProductId ?? null,
      breakdown: rows,
      label,
    });
  }

  // внеплановые позиции: первички по номенклатуре, которой нет в плане
  for (const [productId, facts] of factsByProduct) {
    if (planByProduct.has(productId)) continue;
    const product = productOf(input, productId);
    const policy = input.extraProductPolicy ?? 'allow';
    if (policy === 'forbid') {
      warnings.push(`«${product.name}» не входит в тарифный план — продажа по договору запрещена`);
      continue;
    }
    if (policy === 'warn') warnings.push(`«${product.name}» не входит в тарифный план`);
    const rows: BillingBreakdownRow[] = [];
    for (const f of facts) {
      markUsed(f.sourceKind, f.sourceId);
      const price = f.price ?? product.price;
      rows.push({ source: f.sourceKind, sourceId: f.sourceId, productId, name: f.name ?? product.name, qty: fmt(dec(f.qty), 3), price, amount: amount(f.qty, price) });
    }
    const total = rows.reduce((s, r) => s + dec(r.amount), 0n);
    const qty = rows.reduce((s, r) => s + dec(r.qty), 0n);
    const price = qty > 0n ? fmt(roundDiv(total * 1_000_000n, qty), 2) : '0.00';
    lines.push({
      productId,
      name: `${product.name} ${periodLabelRu(input.factPeriod)}`,
      unitCode: product.unitCode,
      qty: fmt(qty, 3),
      price,
      vatRate: product.vatRate,
      invoiceAsProductId: null,
      breakdown: rows,
      label: periodLabelRu(input.factPeriod),
    });
  }

  // Представление в счёте: строки плана с одинаковым представителем сливаются в одну строку счёта,
  // исходные строки остаются в расшифровке
  const grouped: RawLine[] = [];
  const byRepresentative = new Map<string, RawLine>();
  for (const l of lines) {
    if (!l.invoiceAsProductId) {
      grouped.push(l);
      continue;
    }
    const key = `${l.invoiceAsProductId}|${l.label}`;
    const cur = byRepresentative.get(key);
    if (!cur) {
      const rep = productOf(input, l.invoiceAsProductId!);
      const merged: RawLine = { ...l, productId: l.invoiceAsProductId!, name: `${rep.name} ${l.label}`, unitCode: rep.unitCode, vatRate: rep.vatRate };
      byRepresentative.set(key, merged);
      grouped.push(merged);
      continue;
    }
    const qty = dec(cur.qty) + dec(l.qty);
    const total = mul(dec(cur.price), dec(cur.qty)) + mul(dec(l.price), dec(l.qty));
    cur.qty = fmt(qty, 3);
    cur.price = qty > 0n ? fmt(roundDiv(total * 1_000_000n, qty), 2) : cur.price;
    cur.breakdown = [...cur.breakdown, ...l.breakdown];
  }
  const sources = [...usedSources].map(k => {
    const [kind, ...rest] = k.split(':');
    return { sourceKind: kind as BillingSourceKind, sourceId: rest.join(':') };
  });
  return { lines: grouped.map(({ label: _label, ...l }) => l), warnings, sources };
}

/** Строка абонплаты: количество плана с пропорцией по дням, цена плана */
/** Строка по факту: количество — сумма строк расшифровки, цена — средневзвешенная (сумма сходится с первичками) */
function factLine(productId: string, product: BillingProduct, label: string, invoiceAsProductId: string | null, rows: BillingBreakdownRow[]): RawLine {
  const total = rows.reduce((s, r) => s + dec(r.amount), 0n);
  const qty = rows.reduce((s, r) => s + dec(r.qty), 0n);
  const price = qty > 0n ? fmt(roundDiv(total * 1_000_000n, qty), 2) : '0.00';
  return { productId, name: `${product.name} ${label}`, unitCode: product.unitCode, qty: fmt(qty, 3), price, vatRate: product.vatRate, invoiceAsProductId, breakdown: rows, label };
}

/**
 * Строки акта по счёту биллинга: только то, что ещё не продано. Заказ-наряд и отгрузка уже признали выручку и долг
 * клиента при своём проведении — повторно в акт они не идут; абонплата и учёт времени — идут.
 */
export function actLines(lines: BillingLine[]): BillingLine[] {
  const out: BillingLine[] = [];
  for (const l of lines) {
    const own = l.breakdown.filter(r => r.source === 'plan' || r.source === 'time_log');
    if (!own.length) continue;
    if (own.length === l.breakdown.length) {
      out.push(l);
      continue;
    }
    // в строке есть и проданное: в акт — сумма своей части одной позицией
    const sum = own.reduce((s, r) => s + dec(r.amount), 0n);
    out.push({ ...l, qty: '1.000', price: fmt(sum, 2), breakdown: own });
  }
  return out;
}

function planLine(plan: TariffPlanLine, product: BillingProduct, label: string, coverage: Coverage, breakdown: BillingBreakdownRow[]): RawLine {
  const qty = prorate(plan.qty, coverage);
  return {
    productId: plan.productId,
    name: `${product.name} ${label}`,
    unitCode: product.unitCode,
    qty,
    price: plan.price,
    vatRate: product.vatRate,
    invoiceAsProductId: plan.invoiceAsProductId ?? null,
    breakdown,
    label,
  };
}

/** Источники, которые попали в счёт (каждый — ровно один раз) */
export function billingSourcesKey(sourceKind: BillingSourceKind, sourceId: string): string {
  return `${sourceKind}:${sourceId}`;
}

/** Расшифровка биллинга счёта: хранится у счёта (вкладка «Billing breakdown») */
export interface BillingBreakdownPayload {
  /** Ключ периода запуска (текущий период) */
  period: string;
  /** Период абонплаты */
  subscriptionPeriod: string;
  /** Период фактических работ */
  factPeriod: string;
  lines: {
    productId: string;
    name: string;
    qty: string;
    price: string;
    vatRate: string;
    invoiceAsProductId: string | null;
    rows: BillingBreakdownRow[];
  }[];
  warnings: string[];
}
