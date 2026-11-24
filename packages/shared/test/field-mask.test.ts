import { describe, expect, test } from 'bun:test';
import { assertNoHiddenFieldWrite, maskEventFields, maskFields, maskRows } from '../src';

describe('field masking', () => {
  test('omits system fields and custom values without mutating the record', () => {
    const row = { id: 'a', amount: '15', probability: 50, custom: { secret: 'x', public: 'y' } };
    expect(maskFields('deal', row, ['deal.amount', 'custom:deal.secret', 'lead.probability']) as unknown)
      .toEqual({ id: 'a', probability: 50, custom: { public: 'y' } });
    expect(row.amount).toBe('15');
    expect(row.custom.secret).toBe('x');
  });

  test('masks rows and aliases of protected fields', () => {
    expect(maskRows('lead', [{ name: 'A', phone: '123', phoneNorm: '123', email: 'a@b.test' }], ['lead.phone']) as unknown)
      .toEqual([{ name: 'A', email: 'a@b.test' }]);
    expect(maskFields('company', { name: 'A', inn: '123', bankAccounts: [1] }, ['company.requisites', 'company.bankAccounts']) as unknown)
      .toEqual({ name: 'A' });
  });

  test('masks derived money fields alongside document totals', () => {
    const row = { id: 'a', total: '12', amountNet: '10', lines: [{ qty: '1', price: '10', total: '12' }], basedOn: { id: 'b', total: '12' } };
    expect(maskFields('document', row, ['document.total']) as unknown).toEqual({ id: 'a', lines: [{ qty: '1' }], basedOn: { id: 'b' } });
  });

  test('masks field values in event snapshots and diffs', () => {
    const payload = {
      record: { amount: '15', custom: { secret: 'x', note: 'y' } },
      changes: {
        amount: { from: '10', to: '15' },
        custom: { from: { secret: 'old' }, to: { secret: 'x', note: 'y' } },
      },
    };
    expect(maskEventFields('deal', payload, ['deal.amount', 'custom:deal.secret'])).toEqual({
      record: { custom: { note: 'y' } },
      changes: { custom: { from: {}, to: { note: 'y' } } },
    });
  });

  test('reports explicit writes, including clearing a value', () => {
    expect(assertNoHiddenFieldWrite('contact', { phone: '', custom: { secret: null, visible: 1 } }, ['contact.phone', 'contact.email', 'custom:contact.secret']))
      .toEqual(['contact.phone', 'custom:contact.secret']);
    expect(assertNoHiddenFieldWrite('company', { inn: '' }, ['company.requisites'])).toEqual(['company.requisites']);
    expect(assertNoHiddenFieldWrite('custom_entity', { data: { secret: false } }, ['custom:custom_entity.secret'])).toEqual(['custom:custom_entity.secret']);
    expect(assertNoHiddenFieldWrite('document', { lines: [{ qty: '1', price: '5' }] }, ['document.total'])).toEqual(['document.total']);
    expect(assertNoHiddenFieldWrite('document', { lines: [] }, ['document.total'])).toEqual(['document.total']);
    expect(assertNoHiddenFieldWrite('document', { comment: 'Updated' }, ['document.total'])).toEqual([]);
  });
});
