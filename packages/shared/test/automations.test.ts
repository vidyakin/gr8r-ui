/* Автоматизации (общий код): подстановки, cron, защита от SSRF, события, реестр узлов, проверка графа. */
import { describe, expect, test } from 'bun:test';
import {
  compareValues,
  cronMatches,
  defaultParams,
  eventAction,
  eventChanges,
  eventEntity,
  isPrivateAddress,
  NODE_DEFS,
  nodeOutputs,
  nodeParamsJsonSchema,
  parseCron,
  parseHeaders,
  renderTemplate,
  resolveTemplates,
  validateGraph,
  type FlowGraph,
} from '../src';

describe('templates', () => {
  const ctx = { trigger: { record: { title: 'Fix', priority: 10, tags: ['a', 'b'], nested: { x: null } } }, n: 0 };
  test('substitutes paths, stringifies, tolerates gaps', () => {
    expect(renderTemplate('Task {{trigger.record.title}} p={{ trigger.record.priority }}', ctx)).toBe('Task Fix p=10');
    expect(renderTemplate('{{trigger.record.tags.1}}/{{trigger.record.nested}}/{{trigger.nope.deep}}/{{n}}', ctx)).toBe('b/{"x":null}//0');
    expect(renderTemplate('no placeholders', ctx)).toBe('no placeholders');
  });
  test('is not an expression language: no calls, no operators, no prototype access', () => {
    expect(renderTemplate('{{1+1}}|{{trigger.record.title.length}}|{{process.exit()}}', ctx)).toBe('{{1+1}}||{{process.exit()}}');
    expect(renderTemplate('{{constructor}}{{__proto__}}{{trigger.constructor.name}}{{trigger.record.toString}}', ctx)).toBe('');
    expect(renderTemplate('{{trigger.record.tags.length}}', ctx)).toBe('');
    expect(renderTemplate('{{x}}', Object.create({ x: 'inherited' }))).toBe('');
  });
  test('resolves nested structures', () => {
    expect(resolveTemplates({ a: ['{{n}}', 5], b: { c: '{{trigger.record.title}}' } }, ctx)).toEqual({ a: ['0', 5], b: { c: 'Fix' } });
  });
});

describe('cron', () => {
  const at = (s: string) => new Date(s);
  test('fields, ranges, steps, lists', () => {
    const weekdays9 = parseCron('0 9 * * 1-5')!;
    expect(cronMatches(weekdays9, at('2026-01-05T09:00:00Z'))).toBe(true); // понедельник
    expect(cronMatches(weekdays9, at('2026-01-04T09:00:00Z'))).toBe(false); // воскресенье
    expect(cronMatches(weekdays9, at('2026-01-05T09:01:00Z'))).toBe(false);
    const every15 = parseCron('*/15 8-9 * * *')!;
    expect([0, 15, 30, 45].every(m => cronMatches(every15, at(`2026-01-05T08:${String(m).padStart(2, '0')}:00Z`)))).toBe(true);
    expect(cronMatches(every15, at('2026-01-05T10:00:00Z'))).toBe(false);
    expect(cronMatches(parseCron('0 0 1,15 * *')!, at('2026-02-15T00:00:00Z'))).toBe(true);
    expect(cronMatches(parseCron('0 0 * * 7')!, at('2026-01-04T00:00:00Z'))).toBe(true); // 7 = воскресенье
  });
  test('rejects malformed expressions', () => {
    for (const bad of ['', '* * * *', '60 * * * *', '* 24 * * *', '*/0 * * * *', 'a b c d e', '5-1 * * * *', '* * 0 * *']) expect(parseCron(bad)).toBeNull();
  });
});

describe('SSRF address check', () => {
  test('blocks private, loopback, link-local and mapped addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', 'ff02::1', 'not-an-ip']) {
      expect([ip, isPrivateAddress(ip)]).toEqual([ip, true]);
    }
  });
  test('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '93.184.216.34', '2606:4700:4700::1111', '::ffff:8.8.8.8']) expect([ip, isPrivateAddress(ip)]).toEqual([ip, false]);
  });
});

describe('events', () => {
  test('entity and action of record and document events', () => {
    expect(eventEntity({ entity: 'record', payload: { entityKey: 'supplier' } })).toBe('supplier');
    expect(eventEntity({ entity: 'task', payload: {} })).toBe('task');
    expect(eventAction({ type: 'document.posted', entity: 'document' })).toBe('updated');
    expect(eventAction({ type: 'task.created', entity: 'task' })).toBe('created');
  });
  test('changes are normalized: from/to, patches, custom fields, document status', () => {
    expect(eventChanges({ type: 'task.updated', entity: 'task', payload: { changes: { status: { from: 'todo', to: 'review' }, custom: { from: { sp: 1, x: 1 }, to: { sp: 2, x: 1 } } } } })).toEqual({
      status: { from: 'todo', to: 'review' },
      sp: { from: 1, to: 2 },
    });
    expect(eventChanges({ type: 'record.updated', entity: 'record', payload: { entityKey: 's', changes: { name: 'N', score: null } } })).toEqual({ name: { to: 'N' }, score: { to: null } });
    expect(eventChanges({ type: 'document.posted', entity: 'document', payload: { documentType: 'invoice' } })).toEqual({ status: { to: 'posted' } });
  });
});

describe('node registry', () => {
  test('every node has a JSON schema with defaults, outputs and UI hints', () => {
    expect(Object.keys(NODE_DEFS).length).toBeGreaterThanOrEqual(13);
    for (const def of Object.values(NODE_DEFS)) {
      const s = nodeParamsJsonSchema(def) as { type: string; properties: Record<string, { ui?: string }> };
      expect(s.type).toBe('object');
      expect(nodeOutputs(def, defaultParams(def)).length).toBeGreaterThan(0);
    }
    const upd = nodeParamsJsonSchema(NODE_DEFS['action.update_field']!) as any;
    expect(upd.properties.entity).toMatchObject({ ui: 'entity', default: 'task' });
    expect(upd.properties.field).toMatchObject({ ui: 'field', dependsOn: 'entity', writableOnly: true });
    expect(upd.required).toContain('field');
  });
  test('dynamic outputs of the branch node follow its params', () => {
    expect(nodeOutputs(NODE_DEFS['flow.branch']!, { value: 'x', cases: 'a\n\n b \nc' }).map(o => o.id)).toEqual(['case_0', 'case_1', 'case_2', 'else']);
    expect(nodeOutputs(NODE_DEFS['logic.condition']!, {}).map(o => o.id)).toEqual(['true', 'false']);
  });
  test('condition comparison: numbers as numbers, text case-insensitively', () => {
    expect(compareValues('lt', '9', '10')).toBe(true); // не строковое сравнение
    expect(compareValues('eq', 'Review', 'review')).toBe(true);
    expect(compareValues('contains', 'Big Deal', 'deal')).toBe(true);
    expect(compareValues('empty', '  ', '')).toBe(true);
    expect(compareValues('gt', 'b', 'a')).toBe(true);
  });
  test('headers parsing', () => {
    expect(parseHeaders('Content-Type: application/json\n\nbad line\nX-Key:  v:1 ')).toEqual({ 'Content-Type': 'application/json', 'X-Key': 'v:1' });
  });
});

describe('graph validation', () => {
  const node = (id: string, type: string, params: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, params });
  const edge = (source: string, target: string, sourceHandle?: string) => ({ id: `${source}-${target}`, source, target, sourceHandle });
  const ok: FlowGraph = { nodes: [node('t', 'trigger.manual'), node('n', 'action.notify', { recipientId: 'x', text: 'hi' })], edges: [edge('t', 'n')] };
  const messages = (g: FlowGraph) => validateGraph(g).map(i => i.message);

  test('a valid graph has no issues', () => expect(validateGraph(ok)).toEqual([]));
  test('needs exactly one trigger and at least one step', () => {
    expect(messages({ nodes: [], edges: [] })).toContain('The flow needs a trigger');
    expect(messages({ nodes: [node('t', 'trigger.manual')], edges: [] })).toContain('Add at least one step after the trigger');
    expect(messages({ nodes: [...ok.nodes, node('t2', 'trigger.manual')], edges: ok.edges })).toContain('Only one trigger is allowed per flow');
  });
  test('dangling nodes, dead edges, merges, cycles and bad handles are reported', () => {
    expect(messages({ nodes: [...ok.nodes, node('x', 'action.notify', { recipientId: 'x', text: 'y' })], edges: ok.edges }).join()).toContain('is not connected to the trigger');
    expect(messages({ nodes: ok.nodes, edges: [...ok.edges, edge('n', 'ghost')] }).join()).toContain('missing node');
    const merge: FlowGraph = { nodes: [node('t', 'trigger.manual'), node('a', 'action.notify', { recipientId: 'x', text: 'a' }), node('b', 'action.notify', { recipientId: 'x', text: 'b' }), node('m', 'action.notify', { recipientId: 'x', text: 'm' })], edges: [edge('t', 'a'), edge('t', 'b'), edge('a', 'm'), edge('b', 'm')] };
    expect(messages(merge).join()).toContain('only one incoming');
    const cyc: FlowGraph = { nodes: [node('t', 'trigger.manual'), node('a', 'action.notify', { recipientId: 'x', text: 'a' }), node('b', 'action.notify', { recipientId: 'x', text: 'b' })], edges: [edge('t', 'a'), edge('a', 'b'), edge('b', 'a')] };
    expect(messages(cyc).join()).toContain('only one incoming');
    expect(messages({ nodes: [node('t', 'trigger.manual'), node('c', 'logic.condition'), node('n', 'action.notify', { recipientId: 'x', text: 'a' })], edges: [edge('t', 'c'), edge('c', 'n', 'maybe')] }).join()).toContain('output "maybe" does not exist');
    expect(messages({ nodes: [node('t', 'trigger.manual'), node('z', 'no.such.node')], edges: [edge('t', 'z')] }).join()).toContain('Unknown node type');
  });
  test('parameters are checked by each node schema', () => {
    const bad: FlowGraph = { nodes: [node('t', 'trigger.schedule', { cron: 'every day' }), node('d', 'flow.delay', { amount: 100_000, unit: 'days' }), node('u', 'action.update_field', { entity: 'task' })], edges: [edge('t', 'd'), edge('d', 'u')] };
    const m = messages(bad).join('\n');
    expect(m).toContain('5 cron fields');
    expect(m).toContain('cannot exceed 30 days');
    expect(m).toContain('field');
  });
});
