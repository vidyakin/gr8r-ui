import { describe, expect, test } from 'bun:test';
import { allocateFifo, dec, defaultCashFlowKey, obligation, operationSettlement, overdueBucket, overdueDays, paymentState, planOffset, splitPayment } from '../src';

describe('взаиморасчёты: чистые расчёты', () => {
  test('оплата сверх долга — аванс', () => {
    const r = splitPayment(dec('100'), dec('130'));
    expect(r.toDocument).toBe(dec('100'));
    expect(r.advance).toBe(dec('30'));
    expect(splitPayment(dec('-5'), dec('10')).advance).toBe(dec('10'));
    expect(splitPayment(dec('100'), dec('40')).advance).toBe(0n);
  });

  test('FIFO по датам: старый документ закрывается первым', () => {
    const { paid, advance } = allocateFifo(
      [
        { id: 'b', date: '2026-02-01', amount: dec('50') },
        { id: 'a', date: '2026-01-01', amount: dec('100') },
      ],
      dec('120'),
    );
    expect(paid.get('a')).toBe(dec('100'));
    expect(paid.get('b')).toBe(dec('20'));
    expect(advance).toBe(0n);
    expect(allocateFifo([{ id: 'a', date: '2026-01-01', amount: dec('10') }], dec('25')).advance).toBe(dec('15'));
  });

  test('зачёт аванса: старший источник первым', () => {
    const plan = planOffset(dec('150'), [
      { key: 'new', date: '2026-03-01', remaining: dec('100') },
      { key: 'old', date: '2026-01-01', remaining: dec('80') },
    ]);
    expect(plan).toEqual([
      { key: 'old', amount: dec('80') },
      { key: 'new', amount: dec('70') },
    ]);
  });

  test('обязательство: заказ не меньше своей суммы, реализация — начисленное', () => {
    expect(obligation(true, '100.00', '60.00')).toBe(dec('100'));
    expect(obligation(true, '100.00', '120.00')).toBe(dec('120'));
    expect(obligation(false, '100.00', '60.00')).toBe(dec('60'));
  });

  test('состояние оплаты, просрочка, операции', () => {
    expect(paymentState(dec('100'), 0n)).toBe('unpaid');
    expect(paymentState(dec('100'), dec('40'))).toBe('partial');
    expect(paymentState(dec('100'), dec('100'))).toBe('paid');
    expect(overdueDays('2026-01-10', '2026-01-20')).toBe(10);
    expect(overdueDays(null, '2026-01-20')).toBe(0);
    expect(overdueBucket(45)).toBe('d31_60');
    expect(operationSettlement('from_customer')).toEqual({ side: 'customer', mode: 'pay' });
    expect(operationSettlement('other_income')).toBeNull();
    expect(defaultCashFlowKey('to_supplier')).toBe('suppliers_payment');
  });
});
