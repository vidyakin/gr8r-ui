import { describe, expect, test } from 'bun:test';
import { NODE_DEFS, nextRoundRobin, normalizeEmail, normalizePhone, phoneKey, pickUtm, leadConvert, leadWebhookBody } from '../src';

describe('нормализация лидов', () => {
  test('телефон приводится к E.164', () => {
    expect(normalizePhone('8 (916) 111-22-33')).toBe('+79161112233');
    expect(normalizePhone('+7 916 111 22 33')).toBe('+79161112233');
    expect(normalizePhone('9161112233')).toBe('+79161112233');
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
    expect(normalizePhone('12345')).toBe('');
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone(null)).toBe('');
  });
  test('ключ сравнения телефонов — последние 10 цифр', () => {
    expect(phoneKey('8 916 111-22-33')).toBe(phoneKey('+7(916)1112233'));
    expect(phoneKey('123')).toBe('');
  });
  test('email', () => {
    expect(normalizeEmail('  Ivan@Example.COM ')).toBe('ivan@example.com');
    expect(normalizeEmail('not-an-email')).toBe('');
  });
  test('по кругу', () => {
    expect(nextRoundRobin([], null)).toBeNull();
    expect(nextRoundRobin(['b', 'a', 'c'], null)).toBe('a');
    expect(nextRoundRobin(['b', 'a', 'c'], 'a')).toBe('b');
    expect(nextRoundRobin(['b', 'a', 'c'], 'c')).toBe('a');
    expect(nextRoundRobin(['b', 'a'], 'zzz')).toBe('a');
  });
  test('utm', () => {
    expect(pickUtm({ utm_source: 'g', UTM_medium: 'cpc', name: 'x', utm_empty: '' })).toEqual({ utm_source: 'g', utm_medium: 'cpc' });
  });
});

describe('схемы', () => {
  test('конвертация: по умолчанию ничего не создаётся', () => {
    const r = leadConvert.parse({});
    expect(r.company).toEqual({ mode: 'none' });
    expect(r.deal ?? null).toBeNull();
  });
  test('вебхук пропускает лишние поля', () => {
    const r = leadWebhookBody.parse({ name: 'A', utm_source: 'x', foo: 1 }) as Record<string, unknown>;
    expect(r.phone).toBe('');
    expect(r.utm_source).toBe('x');
  });
});

describe('узлы лидов', () => {
  const h = (entity: string, action: string, changes: Record<string, { from?: unknown; to?: unknown }> = {}) => ({ entity, action, changes });
  const ev = {} as never;
  test('триггер «лид создан»', () => {
    const d = NODE_DEFS['trigger.lead_created']!;
    expect(d.match!({}, ev, h('lead', 'created'))).toBe(true);
    expect(d.match!({}, ev, h('deal', 'created'))).toBe(false);
    expect(d.match!({}, ev, h('lead', 'updated'))).toBe(false);
  });
  test('триггер «статус изменён»: любой и конкретный', () => {
    const d = NODE_DEFS['trigger.lead_status_changed']!;
    expect(d.match!({ statusId: '' }, ev, h('lead', 'updated', { statusId: { from: 'a', to: 'b' } }))).toBe(true);
    expect(d.match!({ statusId: 'b' }, ev, h('lead', 'updated', { statusId: { from: 'a', to: 'b' } }))).toBe(true);
    expect(d.match!({ statusId: 'c' }, ev, h('lead', 'updated', { statusId: { from: 'a', to: 'b' } }))).toBe(false);
    expect(d.match!({ statusId: '' }, ev, h('lead', 'updated', { ownerId: { from: 'a', to: 'b' } }))).toBe(false);
  });
  test('действия вызывают порты', async () => {
    const calls: unknown[] = [];
    const rt = {
      createLead: async (a: unknown) => (calls.push(['create', a]), { id: 'L1' }),
      assignLead: async (a: unknown) => (calls.push(['assign', a]), { ownerId: 'M1', changed: true }),
    } as never;
    const c = NODE_DEFS['action.create_lead']!;
    const out = await c.execute(c.params.parse({ name: ' Ivan ', phone: '+7 900 000-00-00' }), rt);
    expect(out.output).toEqual({ leadId: 'L1' });
    const a = NODE_DEFS['action.assign_lead']!;
    const r = await a.execute(a.params.parse({ leadId: 'L1' }), rt);
    expect(r.output).toEqual({ leadId: 'L1', ownerId: 'M1', changed: true });
    expect((calls[1] as unknown[])[1]).toMatchObject({ mode: 'round_robin' });
    await expect(a.execute(a.params.parse({ leadId: 'L1', mode: 'manual' }), rt)).rejects.toThrow();
  });
});
