/* Узлы автоматизаций согласования (задача 1199): триггеры по событиям и действие «Отправить на согласование» с подставным портом. */
import { describe, expect, test } from 'bun:test';
import { NODE_DEFS, disabledModulesOfNodes, eventAction } from '../src';

const ev = (type: string, payload: Record<string, unknown>) => ({ id: 'e', workspaceId: 'w', type, entity: 'approval', recordId: 'a1', actorId: null, payload });
const hint = (e: ReturnType<typeof ev>) => ({ entity: e.entity, action: eventAction(e), changes: {} });

describe('trigger.approval_completed', () => {
  const d = NODE_DEFS['trigger.approval_completed']!;
  const done = ev('approval.completed', { result: 'rejected', targetKind: 'document' });
  test('фильтр по итогу и виду объекта', () => {
    expect(d.match!(d.params.parse({}), done, hint(done))).toBe(true);
    expect(d.match!(d.params.parse({ result: 'rejected' }), done, hint(done))).toBe(true);
    expect(d.match!(d.params.parse({ result: 'approved' }), done, hint(done))).toBe(false);
    expect(d.match!(d.params.parse({ targetKind: 'contract' }), done, hint(done))).toBe(false);
  });
  test('отзыв и другие события не запускают', () => {
    const cancelled = ev('approval.cancelled', { result: 'cancelled' });
    expect(d.match!(d.params.parse({}), cancelled, hint(cancelled))).toBe(false);
    const started = ev('approval.started', {});
    expect(d.match!(d.params.parse({}), started, hint(started))).toBe(false);
    const other = { ...done, entity: 'document' };
    expect(d.match!(d.params.parse({}), other, hint(other))).toBe(false);
  });
});

describe('trigger.approval_step_overdue', () => {
  const d = NODE_DEFS['trigger.approval_step_overdue']!;
  const e = ev('approval.step_overdue', { targetKind: 'contract' });
  test('срабатывает на просрочку; фильтр по виду объекта', () => {
    expect(d.match!(d.params.parse({}), e, hint(e))).toBe(true);
    expect(d.match!(d.params.parse({ targetKind: 'contract' }), e, hint(e))).toBe(true);
    expect(d.match!(d.params.parse({ targetKind: 'document' }), e, hint(e))).toBe(false);
    const c = ev('approval.completed', { result: 'approved' });
    expect(d.match!(d.params.parse({}), c, hint(c))).toBe(false);
  });
});

describe('action.submit_approval', () => {
  const d = NODE_DEFS['action.submit_approval']!;
  test('вызывает порт submitApproval и возвращает id процесса', async () => {
    const calls: unknown[] = [];
    const rt = { submitApproval: async (a: unknown) => (calls.push(a), { approvalId: 'AP1' }) } as never;
    const r = await d.execute(d.params.parse({ objectId: ' 0190aaaa-0000-7000-8000-000000000001 ' }), rt);
    expect(calls).toEqual([{ targetKind: 'document', objectId: '0190aaaa-0000-7000-8000-000000000001' }]);
    expect(r.output).toMatchObject({ approvalId: 'AP1', targetKind: 'document' });
  });
  test('пустой ID — ошибка, ошибка порта пробрасывается', async () => {
    const rt = { submitApproval: async () => { throw new Error('route_not_found'); } } as never;
    await expect(d.execute(d.params.parse({ objectId: '  ' }), rt)).rejects.toThrow('empty');
    await expect(d.execute(d.params.parse({ objectId: 'x' }), rt)).rejects.toThrow('route_not_found');
  });
});

describe('каталог модуля docflow', () => {
  test('узлы согласования принадлежат docflow', () => {
    const types = ['trigger.approval_completed', 'trigger.approval_step_overdue', 'action.submit_approval'];
    expect(disabledModulesOfNodes(types, new Set(['core', 'automations']))).toEqual(['docflow']);
    expect(disabledModulesOfNodes(types, new Set(['core', 'automations', 'docflow']))).toEqual([]);
  });
});
