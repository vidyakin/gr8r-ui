import { describe, expect, test } from 'bun:test';
import { apportionKop, dec, detectKitCycle, distributeKitLine } from '../src';

describe('product kits distribution', () => {
  test('apportionKop distributes pennies strictly to target total', () => {
    expect(apportionKop(10000n, [1n, 1n, 1n])).toEqual([3334n, 3333n, 3333n]);
    expect(apportionKop(101n, [1n, 1n, 0n])).toEqual([51n, 50n, 0n]);
    expect(apportionKop(0n, [1n, 2n])).toEqual([0n, 0n]);
    expect(apportionKop(1000n, [0n, 0n])).toEqual([0n, 0n]);
  });

  test('distributeKitLine uses explicit priceShare first, with penny-exact net/vat/total', () => {
    const out = distributeKitLine({
      lineQty: '2.000',
      lineNet: '83.33',
      lineVat: '16.67',
      lineTotal: '100.00',
      priceIncludesVat: true,
      components: [
        { productId: 'p1', qty: '1', priceShare: '70', catalogPrice: '10' },
        { productId: 'p2', qty: '2', priceShare: '30', catalogPrice: '999' },
        { productId: 'p3', qty: '1', priceShare: '0', catalogPrice: '50' },
      ],
    });
    expect(out.map(x => x.total)).toEqual(['70.00', '30.00', '0.00']);
    expect(out.map(x => x.totalQty)).toEqual(['2.000', '4.000', '2.000']);
    const sumNet = out.reduce((s, x) => s + dec(x.net), 0n);
    const sumVat = out.reduce((s, x) => s + dec(x.vatAmount), 0n);
    const sumTot = out.reduce((s, x) => s + dec(x.total), 0n);
    expect(sumNet).toBe(dec('83.33'));
    expect(sumVat).toBe(dec('16.67'));
    expect(sumTot).toBe(dec('100.00'));
    for (const x of out) expect(dec(x.net) + dec(x.vatAmount)).toBe(dec(x.total));
  });

  test('distributeKitLine falls back to catalog prices (qty × price), then qty split', () => {
    // By catalog prices: p1 = 1*600 = 600, p2 = 2*200 = 400 -> 60% / 40%
    const byCatalog = distributeKitLine({
      lineQty: '1',
      lineNet: '1000.00',
      lineVat: '0.00',
      lineTotal: '1000.00',
      priceIncludesVat: false,
      components: [
        { productId: 'p1', qty: '1', catalogPrice: '600.00' },
        { productId: 'p2', qty: '2', catalogPrice: '200.00' },
      ],
    });
    expect(byCatalog.map(x => x.total)).toEqual(['600.00', '400.00']);
    expect(byCatalog.map(x => x.unitPrice)).toEqual(['600.00', '200.00']);

    // By qty fallback when catalog prices are 0: 1:1:1 on 100.00 -> 33.34 + 33.33 + 33.33
    const byQty = distributeKitLine({
      lineQty: '1',
      lineNet: '83.33',
      lineVat: '16.67',
      lineTotal: '100.00',
      priceIncludesVat: true,
      components: [
        { productId: 'p1', qty: '1', catalogPrice: '0.00' },
        { productId: 'p2', qty: '1', catalogPrice: '0.00' },
        { productId: 'p3', qty: '1', catalogPrice: '0.00' },
      ],
    });
    expect(byQty.map(x => x.total)).toEqual(['33.34', '33.33', '33.33']);
    expect(byQty.reduce((s, x) => s + dec(x.net), 0n)).toBe(dec('83.33'));
    expect(byQty.reduce((s, x) => s + dec(x.vatAmount), 0n)).toBe(dec('16.67'));
  });

  test('detectKitCycle detects self-reference and multi-hop cycles', () => {
    const edges = new Map<string, string[]>([
      ['B', ['C']],
      ['C', ['D']],
    ]);
    expect(detectKitCycle('A', edges, ['A'])).toBe(true);
    expect(detectKitCycle('A', edges, ['B'])).toBe(false);
    expect(detectKitCycle('D', edges, ['B'])).toBe(true);
  });
});
