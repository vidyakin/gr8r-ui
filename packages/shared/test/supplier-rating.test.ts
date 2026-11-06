import { describe, expect, test } from 'bun:test';
import { computeSupplierRating, supplierRatingLevel } from '../src/supplier-rating';

describe('supplier rating score', () => {
  test('no data -> null', () => {
    expect(computeSupplierRating({ onTime: null, completeness: null, quality: null }).score).toBeNull();
  });
  test('single indicator uses its weight redistributed? all weights among present', () => {
    // only quality present: weight 30, score = quality
    expect(computeSupplierRating({ onTime: null, completeness: null, quality: 80 }).score).toBe(80);
  });
  test('weighted average default', () => {
    const r = computeSupplierRating({ onTime: 100, completeness: 100, quality: 0 });
    expect(r.score).toBe(70);
    expect(r.level).toBe('B');
  });
  test('level thresholds', () => {
    expect(supplierRatingLevel(85)).toBe('A');
    expect(supplierRatingLevel(70)).toBe('B');
    expect(supplierRatingLevel(50)).toBe('C');
    expect(supplierRatingLevel(49)).toBe('D');
  });
});
