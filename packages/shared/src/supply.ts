/* Обеспечение материалов заказа на производство: чистая функция покрытия строки материала.
   Одна и та же функция считает сервер (карточка заказа, экран потребностей) и интерфейс (цвет обеспечения). */
import { dec, fmt, pctOf, type Dec } from './decimal';

/** Статус обеспечения строки материала: полностью, частично или совсем не обеспечено */
export type CoverageStatus = 'full' | 'partial' | 'none';

/** Данные строки материала для расчёта обеспечения */
export interface MaterialCoverageInput {
  /** Нужно по заказу (норма состава заказа) */
  need: string;
  /** Списано выпусками */
  written: string;
  /** Зарезервировано под заказ */
  reserved: string;
  /** Размещено: заказано поставщикам и дочерними заказами на производство */
  placed: string;
  /** К поступлению: свободные заказы поставщикам по этому товару */
  incoming: string;
  /** Остаток на складах (всего) */
  onHand: string;
  /** Все резервы товара на складах (свои и чужие) */
  reservedTotal: string;
  /** Передано перемещениями под заказ (проведённые, со ссылкой на строку состава); пусто — 0 */
  transferred?: string;
  /** Допуск передачи сверх нормы, % (участок или воркспейс); пусто — 0 */
  overtransferPct?: string;
}

/** Покрытие строки материала */
export interface MaterialCoverage {
  /** Нужно по заказу */
  need: string;
  /** Списано выпусками */
  written: string;
  /** Осталось обеспечить (нужно − списано) */
  required: string;
  /** Зарезервировано под заказ */
  reserved: string;
  /** Размещено (заказано поставщикам и дочерними заказами) */
  placed: string;
  /** К поступлению (свободные заказы поставщикам) */
  incoming: string;
  /** Не обеспечено: не зарезервировано и не заказано */
  notEnsured: string;
  /** Свободно (всего): остаток минус резерв других заказов */
  free: string;
  /** Статус обеспечения */
  status: CoverageStatus;
  /** Передано перемещениями под заказ */
  transferred: string;
  /** Передано сверх нормы: max(передано − нужно, 0) */
  overTransferred: string;
  /** Предел передачи: нужно × (1 + допуск, %) */
  transferLimit: string;
}

const nonNeg = (v: Dec): Dec => (v > 0n ? v : 0n);

/** Предел передачи материала: норма × (1 + допуск, %/100). Допуск меньше нуля считается нулём */
export function overTransferLimit(need: Dec, pct: Dec): Dec {
  const n = nonNeg(need);
  return n + pctOf(n, nonNeg(pct));
}

/** Обеспечение строки материала: нужно, списано, зарезервировано, размещено, не обеспечено, свободно, к поступлению, статус.
    Обеспеченным считается резерв плюс размещение: заказанное поставщикам количество товар тоже обеспечивает */
export function materialCoverage(input: MaterialCoverageInput): MaterialCoverage {
  const need = nonNeg(dec(input.need));
  const written = nonNeg(dec(input.written));
  const required = nonNeg(need - written);
  const reserved = nonNeg(dec(input.reserved));
  const placed = nonNeg(dec(input.placed));
  const ensured = reserved + placed;
  const notEnsured = nonNeg(required - ensured);
  // свободно не бывает меньше нуля: перерезерв заказов покупателей не создаёт «отрицательного» остатка
  const transferred = nonNeg(dec(input.transferred));
  const free = nonNeg(dec(input.onHand) - dec(input.reservedTotal));
  const status: CoverageStatus = required <= 0n ? 'full' : ensured >= required ? 'full' : ensured > 0n ? 'partial' : 'none';
  return {
    need: fmt(need, 3),
    written: fmt(written, 3),
    required: fmt(required, 3),
    reserved: fmt(reserved, 3),
    placed: fmt(placed, 3),
    incoming: fmt(nonNeg(dec(input.incoming)), 3),
    notEnsured: fmt(notEnsured, 3),
    free: fmt(free, 3),
    status,
    transferred: fmt(transferred, 3),
    overTransferred: fmt(nonNeg(transferred - need), 3),
    transferLimit: fmt(overTransferLimit(need, dec(input.overtransferPct)), 3),
  };
}
