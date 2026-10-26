/* Распределение материалов по итогам смены (задача 1135): чистый расчёт без БД.
   Фактический расход материала делится между позициями выпусков смены:
   1) пропорционально нормативному количеству (норма × количество выпуска);
   2) материал вне норм у всех позиций — пропорционально плановой стоимости материалов позиции;
   3) без стоимости — по количеству выпуска.
   Остаток округления уходит на последнюю строку: сумма долей равна факту. */
import { roundDiv, type Dec } from './decimal';

/** Позиция выпуска, получающая материалы */
export interface ShiftTarget {
  /** Идентификатор позиции выпуска */
  id: string;
  /** Количество выпуска */
  qty: Dec;
  /** Норма материала на эту позицию (уже умноженная на количество); нет записи — материала нет в нормах позиции */
  norms: Map<string, Dec>;
  /** Плановая стоимость материалов позиции (для материала вне норм) */
  plannedCost: Dec;
}

/** Фактический расход материала */
export interface ShiftMaterial {
  /** Ключ материала (товар) */
  key: string;
  qty: Dec;
}

export interface ShiftShare {
  materialKey: string;
  targetId: string;
  qty: Dec;
}

/** Делит сумму по весам; остаток округления — на последнюю строку с положительным весом (сумма точно равна total) */
export function splitByWeights(total: Dec, weights: Dec[]): Dec[] {
  const sum = weights.reduce((a, b) => a + b, 0n);
  const out = weights.map(() => 0n);
  if (sum <= 0n || total === 0n) return out;
  let last = -1;
  weights.forEach((w, i) => {
    if (w > 0n) last = i;
  });
  let allocated = 0n;
  for (let i = 0; i < weights.length; i++) {
    if (i === last) break;
    out[i] = roundDiv(total * weights[i]!, sum);
    allocated += out[i]!;
  }
  out[last] = total - allocated;
  return out;
}

/** Распределение материалов смены по позициям выпусков. Возвращает доли количества по (материал, позиция), нулевые не включаются */
export function allocateShiftMaterials(materials: ShiftMaterial[], targets: ShiftTarget[]): ShiftShare[] {
  const out: ShiftShare[] = [];
  if (!targets.length) return out;
  for (const m of materials) {
    if (m.qty <= 0n) continue;
    const norms = targets.map(t => t.norms.get(m.key) ?? 0n);
    let weights: Dec[];
    if (norms.some(n => n > 0n)) weights = norms;
    else if (targets.some(t => t.plannedCost > 0n)) weights = targets.map(t => t.plannedCost);
    else weights = targets.map(t => t.qty);
    const parts = splitByWeights(m.qty, weights);
    parts.forEach((qty, i) => {
      if (qty !== 0n) out.push({ materialKey: m.key, targetId: targets[i]!.id, qty });
    });
  }
  return out;
}

/** Стоимость долей: полная стоимость материала делится пропорционально количеству долей (остаток округления — на последнюю долю),
    поэтому сумма стоимостей равна стоимости фактического списания */
export function costShares(shares: ShiftShare[], totalCost: (key: string) => Dec): { materialKey: string; targetId: string; qty: Dec; cost: Dec }[] {
  const byKey = new Map<string, number[]>();
  shares.forEach((s, i) => byKey.set(s.materialKey, [...(byKey.get(s.materialKey) ?? []), i]));
  const out = shares.map(s => ({ ...s, cost: 0n }));
  for (const [key, idx] of byKey) {
    const parts = splitByWeights(totalCost(key), idx.map(i => shares[i]!.qty));
    idx.forEach((i, n) => (out[i]!.cost = parts[n]!));
  }
  return out;
}
