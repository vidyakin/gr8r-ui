/* Скидки и лояльность (задача 1179): чистые расчёты — выбор скидки из подходящих правил (с учётом «суммировать»),
   распределение списания баллов по строкам документа, процент накопительной карты по шкале. Деньги — строки
   и decimal.ts, без float. Правила — docs/architecture/pricing.md. */
import { dec, fmt, pctOf, roundDiv, type Dec } from './decimal';
import { toKop, fmtKop } from './documents';

export const LOYALTY_CARD_KINDS = ['discount', 'bonus', 'cumulative'] as const;
export type LoyaltyCardKind = (typeof LOYALTY_CARD_KINDS)[number];

export const LOYALTY_TX_KINDS = ['accrual', 'redemption', 'expiration', 'reversal'] as const;
export type LoyaltyTxKind = (typeof LOYALTY_TX_KINDS)[number];

export const DISCOUNT_SOURCES = ['manual', 'rule', 'card'] as const;
export type DiscountSource = (typeof DISCOUNT_SOURCES)[number];

/** Скидка-кандидат на применение (уже отфильтрована по условиям в БД — дата, время, сумма, клиент, вид цен, товар,
    промокод). source различает происхождение: правило `discount_rules` или скидка карты лояльности (дисконтной —
    постоянный процент, накопительной — процент по текущей шкале). Карта лояльности участвует в выборе наибольшей
    наравне с правилами, но сама не суммируется (stackable у карты — не предусмотрено 1С). */
export interface DiscountCandidate {
  /** id правила или карты — в зависимости от source */
  ruleId: string;
  discountPct: string;
  stackable: boolean;
  source?: 'rule' | 'card';
}

/** Из подходящих правил и карты: берём наибольший процент среди несуммируемых (или среди всех, если все суммируемые — тогда
    «наибольший» это первый кандидат для совместимости отображения «от какого правила» строки), затем добавляем
    сумму процентов суммируемых правил, отличных от уже выбранного. Ручная скидка сюда не передаётся — она не замещается. */
export interface ResolvedDiscount {
  /** Итоговый процент скидки строки/документа */
  pct: string;
  /** id правила или карты, давшей наибольший (несуммируемый) процент — для отображения «от какого правила» (null, если скидки нет) */
  primaryRuleId: string | null;
  /** Источник primaryRuleId: 'rule' | 'card' | null (нет скидки) */
  primarySource: 'rule' | 'card' | null;
}

export function resolveDiscountPct(candidates: DiscountCandidate[]): ResolvedDiscount {
  if (candidates.length === 0) return { pct: '0.00', primaryRuleId: null, primarySource: null };
  const sole = candidates.filter(c => !c.stackable);
  const stackable = candidates.filter(c => c.stackable);
  // наибольшая несуммируемая скидка (правило или карта); если несуммируемых нет — наибольшая среди суммируемых становится базовой
  const base = (sole.length > 0 ? sole : stackable).reduce((best, c) => (dec(c.discountPct) > dec(best.discountPct) ? c : best));
  let total = dec(base.discountPct);
  for (const c of stackable) {
    if (c.ruleId === base.ruleId && c.source === base.source) continue;
    total += dec(c.discountPct);
  }
  if (total > dec('100')) total = dec('100');
  return { pct: fmt(total, 2), primaryRuleId: base.ruleId, primarySource: base.source ?? 'rule' };
}

export interface DocLineForRedemption {
  id: string;
  /** Сумма строки с НДС после скидки (total из computeLine) */
  total: string;
}

export interface LineRedemption {
  lineId: string;
  /** Баллы (= рубли), списанные с этой строки */
  points: string;
}

/** Распределение списания баллов по строкам пропорционально их сумме (total, с НДС); 1 балл = 1 ₽.
    Остаток от округления — на строку с наибольшей суммой (последнюю при равенстве), как и другие распределения в проекте.
    points не может превышать сумму строк — вызывающая сторона должна это проверить (лимит программы) до вызова. */
export function distributeRedemption(lines: DocLineForRedemption[], points: string): LineRedemption[] {
  const pointsKop = toKop(points);
  if (pointsKop <= 0n || lines.length === 0) return lines.map(l => ({ lineId: l.id, points: '0.00' }));
  const totalsKop = lines.map(l => toKop(l.total));
  const docTotalKop = totalsKop.reduce((a, b) => a + b, 0n);
  if (docTotalKop <= 0n) return lines.map(l => ({ lineId: l.id, points: '0.00' }));
  const capped = pointsKop > docTotalKop ? docTotalKop : pointsKop;
  const shares = totalsKop.map(t => roundDiv(t * capped, docTotalKop));
  const distributed = shares.reduce((a, b) => a + b, 0n);
  const remainder = capped - distributed;
  // остаток (или излишек) округления — на строку с наибольшей суммой (последнюю при равенстве)
  if (remainder !== 0n) {
    let maxIdx = 0;
    for (let i = 1; i < totalsKop.length; i++) if (totalsKop[i]! >= totalsKop[maxIdx]!) maxIdx = i;
    shares[maxIdx] = shares[maxIdx]! + remainder;
  }
  return lines.map((l, i) => ({ lineId: l.id, points: fmtKop(shares[i]!) }));
}

export interface CumulativeScaleStep {
  fromAmount: string;
  pct: string;
}

/** Процент накопительной карты по шкале: наибольший порог fromAmount, не превышающий общую сумму покупок клиента.
    Шкала должна быть по возрастанию fromAmount; пустая шкала или сумма ниже первого порога — 0 % */
export function cumulativePctByScale(totalPurchases: string, scale: CumulativeScaleStep[]): string {
  const amount = dec(totalPurchases);
  let pct: Dec = 0n;
  for (const step of [...scale].sort((a, b) => Number(dec(a.fromAmount) - dec(b.fromAmount)))) {
    if (amount >= dec(step.fromAmount)) pct = dec(step.pct);
  }
  return fmt(pct, 2);
}

/** Начисление баллов при проведении: процент программы от суммы документа за вычетом списанных баллов на нём.
    База — total документа (с НДС) минус списанные баллы (1 балл = 1 ₽) */
export function accrualPoints(documentTotal: string, pointsRedeemed: string, accrualPct: string): string {
  const base = dec(documentTotal) - dec(pointsRedeemed);
  if (base <= 0n) return '0.00';
  return fmt(pctOf(base, dec(accrualPct)), 2);
}

/** Предел списания баллов на документе: % от суммы документа, 1 балл = 1 ₽. Фактическое списание — min(запрошено, лимит, остаток карты) */
export function redemptionLimit(documentTotal: string, limitPct: string): string {
  return fmt(pctOf(dec(documentTotal), dec(limitPct)), 2);
}

/** Сторно баллов при возврате (customer_return): пропорционально доле возвращаемой суммы от суммы исходного документа */
export function reversalPointsForReturn(originalAccrual: string, originalDocTotal: string, returnedAmount: string): string {
  const docTotal = dec(originalDocTotal);
  if (docTotal <= 0n) return '0.00';
  const share = (dec(returnedAmount) * dec(originalAccrual)) / docTotal;
  return fmt(share, 2);
}

/** Одно начисление баллов (лот) с сроком годности, для расчёта сгорания FIFO */
export interface AccrualLot {
  id: string;
  /** Надо сохранять порядок создания (FIFO: раньше начисленный лот сгорает/расходуется раньше) */
  createdAt: Date;
  points: string;
  expiresAt: Date | null;
}

/** Частичное/полное сгорание одного лота */
export interface ExpiredLot {
  lotId: string;
  points: string;
}

/** FIFO-сгорание баллов карты на момент now: лоты (начисления) расходуются расходными движениями
    (списание/сгорание/отрицательное сторно) в хронологии от самого раннего лота: каждый расход
    гасит непогашенный остаток лотов, надвигаются с начала списка (самый старый лот тратится первым).
    После расходов остатки лотов с истёкшим сроком (expiresAt <= now) сгорают полностью.
    spentPoints — абсолютная сумма всех расходных движений по карте (redemption + предыдущие expiration + отрицательные reversal, все как позитивные суммы),
    которые ещё не сопоставлены лотам (они не привязаны к лоту напрямую). Лоты должны быть переданы в порядке createdAt возрастания. */
export function fifoExpiredPoints(lots: AccrualLot[], spentPoints: string, now: Date): ExpiredLot[] {
  let remainingSpend = dec(spentPoints);
  const out: ExpiredLot[] = [];
  for (const lot of lots) {
    let lotRemaining = dec(lot.points);
    if (remainingSpend > 0n) {
      const consumed = remainingSpend < lotRemaining ? remainingSpend : lotRemaining;
      lotRemaining -= consumed;
      remainingSpend -= consumed;
    }
    if (lotRemaining > 0n && lot.expiresAt && lot.expiresAt <= now) out.push({ lotId: lot.id, points: fmt(lotRemaining, 2) });
  }
  return out;
}
