import { describe, expect, test } from 'bun:test';
import {
  RECORD_SCOPES,
  SENSITIVE_FIELD_KEYS,
  effectiveHiddenFields,
  effectiveRecordScope,
  positionSave,
  positionUpdate,
  widestRecordScope,
} from '../src';

describe('record access constants and helpers', () => {
  test('RECORD_SCOPES has exact 3 levels', () => {
    expect([...RECORD_SCOPES]).toEqual(['all', 'department', 'own']);
  });

  test('SENSITIVE_FIELD_KEYS contains all expected sensitive fields', () => {
    expect([...SENSITIVE_FIELD_KEYS]).toEqual([
      'deal.amount',
      'deal.probability',
      'contact.phone',
      'contact.email',
      'lead.phone',
      'lead.email',
      'company.requisites',
      'company.bankAccounts',
      'document.total',
    ]);
  });

  test('widestRecordScope picks widest: all > department > own', () => {
    expect(widestRecordScope([])).toBe('all');
    expect(widestRecordScope(['own'])).toBe('own');
    expect(widestRecordScope(['own', 'department'])).toBe('department');
    expect(widestRecordScope(['department', 'own'])).toBe('department');
    expect(widestRecordScope(['own', 'all'])).toBe('all');
    expect(widestRecordScope(['department', 'all', 'own'])).toBe('all');
  });

  test('effectiveRecordScope grants all to owner/admin and members without positions', () => {
    expect(effectiveRecordScope('owner', [{ recordScope: 'own' }])).toBe('all');
    expect(effectiveRecordScope('admin', [{ recordScope: 'own' }])).toBe('all');
    expect(effectiveRecordScope('member', [])).toBe('all');
    expect(effectiveRecordScope('member', [{ recordScope: 'own' }])).toBe('own');
    expect(effectiveRecordScope('member', [{ recordScope: 'own' }, { recordScope: 'department' }])).toBe('department');
    expect(effectiveRecordScope('member', [{ recordScope: 'own' }, { recordScope: 'all' }])).toBe('all');
  });

  test('effectiveHiddenFields returns empty for owner/admin/no positions and intersection across multiple positions', () => {
    expect(effectiveHiddenFields('owner', [{ hiddenFields: ['deal.amount'] }])).toEqual([]);
    expect(effectiveHiddenFields('admin', [{ hiddenFields: ['deal.amount'] }])).toEqual([]);
    expect(effectiveHiddenFields('member', [])).toEqual([]);
    expect(effectiveHiddenFields('member', [{ hiddenFields: ['deal.amount', 'contact.phone'] }])).toEqual(['deal.amount', 'contact.phone']);
    expect(
      effectiveHiddenFields('member', [
        { hiddenFields: ['deal.amount', 'contact.phone'] },
        { hiddenFields: ['contact.phone', 'document.total'] },
      ]),
    ).toEqual(['contact.phone']);
    expect(effectiveHiddenFields('member', [{ hiddenFields: ['deal.amount'] }, { hiddenFields: [] }])).toEqual([]);
  });
});

describe('positionSave / positionUpdate schemas', () => {
  test('positionSave defaults recordScope to all and hiddenFields to []', () => {
    const parsed = positionSave.parse({ name: 'Sales Manager' });
    expect(parsed.recordScope).toBe('all');
    expect(parsed.hiddenFields).toEqual([]);
  });

  test('positionSave accepts valid recordScope and hiddenFields', () => {
    const parsed = positionSave.parse({
      name: 'Junior Sales',
      recordScope: 'own',
      hiddenFields: ['deal.amount', 'contact.phone', 'custom:deal.margin'],
    });
    expect(parsed.recordScope).toBe('own');
    expect(parsed.hiddenFields).toEqual(['deal.amount', 'contact.phone', 'custom:deal.margin']);
  });

  test('positionSave rejects invalid recordScope', () => {
    const res = positionSave.safeParse({ name: 'Bad', recordScope: 'team' });
    expect(res.success).toBe(false);
  });

  test('positionUpdate keeps recordScope and hiddenFields optional', () => {
    const empty = positionUpdate.parse({});
    expect(empty.recordScope).toBeUndefined();
    expect(empty.hiddenFields).toBeUndefined();

    const partial = positionUpdate.parse({ recordScope: 'department', hiddenFields: ['document.total'] });
    expect(partial.recordScope).toBe('department');
    expect(partial.hiddenFields).toEqual(['document.total']);
  });
});
