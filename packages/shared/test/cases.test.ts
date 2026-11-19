import { describe, expect, test } from 'bun:test';
import { DEFAULT_CASE_SLA, NODE_DEFS, caseDueDates, caseNumberFromSubject, caseSlaState, canChangeCaseStatus, formatCaseNumber, withCaseNumber } from '../src';

const H = 3_600_000;
const created = new Date('2026-11-19T10:00:00Z');
const base = { status: 'new' as const, createdAt: created, firstRespondedAt: null, resolvedAt: null, ...caseDueDates(created, 'normal', DEFAULT_CASE_SLA) };

describe('SLA обращений', () => {
  test('сроки по умолчанию от создания', () => {
    const d = caseDueDates(created, 'urgent');
    expect(d.firstResponseDueAt.getTime() - created.getTime()).toBe(1 * H);
    expect(d.resolveDueAt.getTime() - created.getTime()).toBe(8 * H);
    expect(caseDueDates(created, 'low').resolveDueAt.getTime() - created.getTime()).toBe(168 * H);
  });

  test('метка: зелёная, жёлтая при остатке меньше 20 %, красная после срока', () => {
    expect(caseSlaState(base, new Date(created.getTime() + 2 * H)).level).toBe('ok');
    // срок первого ответа 8 ч: осталось 1 ч (12,5 %) — жёлтая
    const warn = caseSlaState(base, new Date(created.getTime() + 7 * H));
    expect(warn).toMatchObject({ level: 'warn', kind: 'first_response' });
    expect(caseSlaState(base, new Date(created.getTime() + 9 * H))).toMatchObject({ level: 'breached', kind: 'first_response' });
  });

  test('после первого ответа показывается срок решения; решённое и закрытое — без метки', () => {
    const answered = { ...base, firstRespondedAt: new Date(created.getTime() + H) };
    expect(caseSlaState(answered, new Date(created.getTime() + 9 * H))).toMatchObject({ level: 'ok', kind: 'resolve' });
    expect(caseSlaState(answered, new Date(created.getTime() + 80 * H)).level).toBe('breached');
    expect(caseSlaState({ ...answered, status: 'resolved' }, new Date(created.getTime() + 80 * H)).level).toBe('none');
    expect(caseSlaState({ ...answered, status: 'closed' }, new Date()).level).toBe('none');
  });

  test('номер в теме письма и статусные переходы', () => {
    const n = formatCaseNumber(2026, 7);
    expect(n).toBe('ОБ-2026-00007');
    expect(withCaseNumber('Re: вопрос', n)).toBe('Re: вопрос [ОБ-2026-00007]');
    expect(withCaseNumber('Re: вопрос [ОБ-2026-00007]', n)).toBe('Re: вопрос [ОБ-2026-00007]');
    expect(caseNumberFromSubject('Re: вопрос [ОБ-2026-00007]')).toBe(n);
    expect(caseNumberFromSubject('Без номера ОБ-2026-00007')).toBeNull();
    expect(canChangeCaseStatus('closed', 'in_progress')).toBe(false);
    expect(canChangeCaseStatus('resolved', 'in_progress')).toBe(true);
  });
});

describe('триггеры обращений', () => {
  const ev = (type: string, payload: Record<string, unknown> = {}) => ({ id: 'e', workspaceId: 'w', type, entity: 'case', recordId: 'r', actorId: null, payload });
  const h = (action: string, changes: Record<string, { from?: unknown; to?: unknown }> = {}) => ({ entity: 'case', action, changes });
  test('создано, смена статуса, нарушение срока', () => {
    expect(NODE_DEFS['trigger.case_created']!.match!({}, ev('case.created'), h('created'))).toBe(true);
    expect(NODE_DEFS['trigger.case_created']!.match!({}, ev('case.updated'), h('updated'))).toBe(false);
    const st = NODE_DEFS['trigger.case_status_changed']!;
    expect(st.match!({ status: 'waiting' } as never, ev('case.updated'), h('updated', { status: { from: 'new', to: 'waiting' } }))).toBe(true);
    expect(st.match!({ status: 'resolved' } as never, ev('case.updated'), h('updated', { status: { from: 'new', to: 'waiting' } }))).toBe(false);
    expect(st.match!({ status: '' } as never, ev('case.updated'), h('updated', { priority: { from: 'low', to: 'high' } }))).toBe(false);
    const br = NODE_DEFS['trigger.case_sla_breached']!;
    expect(br.match!({ kind: '' } as never, ev('case.sla_breached', { kind: 'resolve' }), h('sla_breached'))).toBe(true);
    expect(br.match!({ kind: 'first_response' } as never, ev('case.sla_breached', { kind: 'resolve' }), h('sla_breached'))).toBe(false);
  });
});
