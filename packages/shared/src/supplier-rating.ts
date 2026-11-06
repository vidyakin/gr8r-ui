/** Рейтинг поставщика: чистый расчёт итога и уровня (задача 1276). */

export interface SupplierRatingWeights {
  onTime: number;
  completeness: number;
  quality: number;
}

export const DEFAULT_SUPPLIER_RATING_WEIGHTS: SupplierRatingWeights = {
  onTime: 40,
  completeness: 30,
  quality: 30,
};

export type SupplierRatingLevel = 'A' | 'B' | 'C' | 'D';

export function supplierRatingLevel(score: number): SupplierRatingLevel {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  return 'D';
}

export interface SupplierRatingInput {
  onTime: number | null;
  completeness: number | null;
  quality: number | null;
  weights?: SupplierRatingWeights;
}

export interface SupplierRatingResult {
  score: number | null;
  level: SupplierRatingLevel | null;
}

function clamp(v: number): number {
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}

export function computeSupplierRating(input: SupplierRatingInput): SupplierRatingResult {
  const w = input.weights ?? DEFAULT_SUPPLIER_RATING_WEIGHTS;
  const pairs: { value: number; weight: number }[] = [];
  if (input.onTime !== null && input.onTime !== undefined) pairs.push({ value: clamp(input.onTime), weight: w.onTime });
  if (input.completeness !== null && input.completeness !== undefined) pairs.push({ value: clamp(input.completeness), weight: w.completeness });
  if (input.quality !== null && input.quality !== undefined) pairs.push({ value: clamp(input.quality), weight: w.quality });
  if (!pairs.length) return { score: null, level: null };
  const totalWeight = pairs.reduce((s, p) => s + p.weight, 0);
  if (totalWeight <= 0) return { score: null, level: null };
  const score = pairs.reduce((s, p) => s + p.value * p.weight, 0) / totalWeight;
  const rounded = Math.round(score * 100) / 100;
  return { score: rounded, level: supplierRatingLevel(rounded) };
}

// Алиасы для совместимости с возможными именами в тестах
export const calculateSupplierRating = computeSupplierRating;
export const supplierRatingScore = computeSupplierRating;
export function computeSupplierRatingScore(input: SupplierRatingInput): number | null {
  return computeSupplierRating(input).score;
}
export function supplierRatingGrade(score: number | null): SupplierRatingLevel | null {
  return score === null ? null : supplierRatingLevel(score);
}
