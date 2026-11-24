import { describe, expect, test } from 'bun:test';
import { allocateEan13, ean13CheckDigit, ean13Svg, internalEan13, isEan13, renderLabels, type LabelFormat } from '../src';

describe('EAN-13 barcode helpers', () => {
  test('ean13CheckDigit computes standard EAN-13 check digits', () => {
    expect(ean13CheckDigit('400638133393')).toBe('1');
    expect(ean13CheckDigit('590123412345')).toBe('7');
    expect(ean13CheckDigit('200000000001')).toBe('5');
    expect(ean13CheckDigit('200000000000')).toBe('8');
  });

  test('ean13CheckDigit rejects non-12-digit inputs', () => {
    expect(() => ean13CheckDigit('12345')).toThrow();
    expect(() => ean13CheckDigit('1234567890123')).toThrow();
    expect(() => ean13CheckDigit('12345678901a')).toThrow();
  });

  test('isEan13 validates format and check digit', () => {
    expect(isEan13('4006381333931')).toBe(true);
    expect(isEan13('5901234123457')).toBe(true);
    expect(isEan13('4006381333932')).toBe(false);
    expect(isEan13('400638133393')).toBe(false);
    expect(isEan13('40063813339310')).toBe(false);
    expect(isEan13('400638133393x')).toBe(false);
  });

  test('internalEan13 generates valid 200-299 internal EAN-13 codes', () => {
    const first = internalEan13(0);
    expect(first).toBe('2000000000008');
    expect(isEan13(first)).toBe(true);

    const last = internalEan13(99_999_999_999);
    expect(last.startsWith('299999999999')).toBe(true);
    expect(isEan13(last)).toBe(true);

    expect(() => internalEan13(-1)).toThrow();
    expect(() => internalEan13(1.5)).toThrow();
    expect(() => internalEan13(100_000_000_000)).toThrow();
  });

  test('allocateEan13 skips collisions and tracks used codes', () => {
    const used = new Set<string>([internalEan13(1), internalEan13(2)]);
    const seq = [1, 2, 3, 3, 4];
    let idx = 0;
    const next = () => seq[idx++]!;

    const a = allocateEan13(used, next);
    expect(a).toBe(internalEan13(3));
    expect(used.has(a)).toBe(true);

    const b = allocateEan13(used, next);
    expect(b).toBe(internalEan13(4));
    expect(used.has(b)).toBe(true);
  });

  test('allocateEan13 throws when unable to find free code', () => {
    const used = new Set<string>([internalEan13(7)]);
    expect(() => allocateEan13(used, () => 7)).toThrow('Unable to allocate barcode');
  });
});

describe('EAN-13 SVG and label/price-tag HTML rendering', () => {
  const sampleCode = internalEan13(123456);

  test('ean13Svg renders valid SVG with guard bars and digits', () => {
    const svg = ean13Svg(sampleCode);
    expect(svg).toContain('<svg ');
    expect(svg).toContain(`aria-label="${sampleCode}"`);
    expect(svg).toContain(`>${sampleCode}</text>`);
    expect(svg).toContain('<rect x="11" y="0" width="1" height="50"/>');
    expect(() => ean13Svg('12345')).toThrow('Invalid EAN-13');
  });

  test('renderLabels supports 58x40, 43x25, a6, and a4 formats', () => {
    const expectedPage: Record<LabelFormat, string> = {
      '58x40': 'size:58mm 40mm',
      '43x25': 'size:43mm 25mm',
      a6: 'size:105mm 148mm',
      a4: 'size:A4',
    };
    for (const format of Object.keys(expectedPage) as LabelFormat[]) {
      const html = renderLabels(
        [{ name: 'Coffee Beans', sku: 'CB-01', barcode: sampleCode, price: '490.00', copies: 2 }],
        format,
      );
      expect(html).toContain('<!doctype html>');
      expect(html).toContain(expectedPage[format]);
      expect(html.match(/<article>/g)?.length).toBe(2);
      expect(html).toContain(sampleCode);
      expect(html).toContain('490.00');
    }
  });

  test('renderLabels excludes zero-copy items and escapes HTML special characters', () => {
    const html = renderLabels(
      [
        { name: 'Excluded', sku: 'EX', barcode: sampleCode, price: '10', copies: 0 },
        { name: '<script>alert("x")</script>', sku: 'A&B', barcode: sampleCode, price: '100 ₽', copies: 1 },
      ],
      '58x40',
    );
    expect(html.match(/<article>/g)?.length).toBe(1);
    expect(html).not.toContain('Excluded');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('A&amp;B');
  });
});
