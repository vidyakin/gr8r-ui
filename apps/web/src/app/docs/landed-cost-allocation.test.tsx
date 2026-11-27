/* Таблица распределения доп. расходов рендерится с данными (задача 1385): доли по строкам, проценты, поля ручного
   ввода и удаление строки. Суммы приходят из allocateLandedCost — той же функции, что считает сервер. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { TooltipProvider } from '@/components/ui/tooltip';
import { loadLocale, setLocale } from '@/i18n';
import { LandedCostAllocationTable } from './landed-cost-allocation';
import type { LandedCostLineDraft } from './landed-costs-data';

const line = (id: string, productName: string, sku: string, qty: string, baseAmount: string, amount = '0'): LandedCostLineDraft => ({
  id,
  baseDocumentId: 'doc-1',
  baseDocumentNumber: 'ПТ-2026-00001',
  baseDocumentLineId: `l-${id}`,
  productId: `p-${id}`,
  productName,
  sku,
  qty,
  baseAmount,
  weight: '20.000',
  amount,
});

const lines = [line('a', 'Болт', 'BLT-1', '10.000', '1000.00'), line('b', 'Кабель', 'CBL-2', '5.000', '1000.00')];

/** Подсказки кнопок (IconButton) — Radix, без провайдера рендер падает */
const table = (props: Parameters<typeof LandedCostAllocationTable>[0]) =>
  renderToStaticMarkup(
    <TooltipProvider>
      <LandedCostAllocationTable {...props} />
    </TooltipProvider>,
  );
/** Доли так, как их отдаёт allocateLandedCost: 300.00 поровну на две строки по 1000.00 */
const shares = new Map(lines.map(l => [l.id, { lineId: l.id, amount: '150.00', weight: l.weight, sharePct: '50.00' }]));

beforeAll(async () => {
  await loadLocale('ru');
  setLocale('ru');
});

describe('allocated lines table', () => {
  test('auto allocation shows the share of every line and its percentage', () => {
    const html = table({ lines, method: 'by_amount', editable: true, shares, onAmount: () => {}, onRemove: () => {} });
    // по 150,00 на строку и по 50,00 % — доли видны, а не пустые ячейки
    expect(html).toContain('150,00');
    expect(html).toContain('50.00%');
    // товар, артикул и документ-основание в строке
    expect(html).toContain('Болт');
    expect(html).toContain('BLT-1');
    expect(html).toContain('ПТ-2026-00001');
    expect(html).toContain('10');
    // пустых ячеек-сумм нет
    expect(html).not.toContain('<span class="num"></span>');
  });

  test('manual mode renders editable amount fields with the entered amounts', () => {
    const manualLines = [line('a', 'Болт', 'BLT-1', '10.000', '1000.00', '10.10'), line('b', 'Кабель', 'CBL-2', '5.000', '1000.00', '20.20')];
    // 10.10 из 10.15 — 9951 из 10000 сотых процента, 20.20 из 10.15 — 49; вместе ровно 100.00
    const manualShares = new Map<string, { lineId: string; amount: string; weight: string; sharePct: string }>([
      ['a', { lineId: 'a', amount: '10.10', weight: '20.000', sharePct: '99.51' }],
      ['b', { lineId: 'b', amount: '20.20', weight: '20.000', sharePct: '0.49' }],
    ]);
    const html = table({ lines: manualLines, method: 'manual', editable: true, shares: manualShares, onAmount: () => {}, onRemove: () => {} });
    expect(html).toContain('value="10.10"');
    expect(html).toContain('value="20.20"');
    expect(html).toContain('99.51%');
    expect(html).toContain('0.49%');
  });

  test('posted document renders read-only rows without remove buttons', () => {
    const html = table({ lines, method: 'by_qty', editable: false, shares, onAmount: () => {}, onRemove: () => {} });
    expect(html).toContain('150,00');
    // кнопки удаления нет: у проведённого документа строки не меняются
    expect(html).not.toContain('aria-label="Убрать строку"');
  });
});
