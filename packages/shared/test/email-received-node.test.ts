import { describe, expect, test } from 'bun:test';
import { NODE_DEFS, disabledModulesOfNodes, type FlowEvent } from '../src';

const mailboxId = '01900000-0000-7000-8000-000000000001';
const event: FlowEvent = { id: 'ev', workspaceId: 'ws', entity: 'email', type: 'email.received', recordId: 'm', actorId: null, payload: { mailboxId, fromEmail: 'sender@example.com' } };
const hints = { entity: 'email', action: 'received', changes: {} };
const node = NODE_DEFS['trigger.email_received']!;

describe('trigger.email_received', () => {
  test('все ящики или выбранный ящик, только входящие письма', () => {
    expect(node.match!(node.params.parse({}), event, hints)).toBe(true);
    expect(node.match!(node.params.parse({ mailboxId }), event, hints)).toBe(true);
    expect(node.match!(node.params.parse({ mailboxId: '01900000-0000-7000-8000-000000000002' }), event, hints)).toBe(false);
    expect(node.match!(node.params.parse({}), { ...event, type: 'email.sent' }, hints)).toBe(false);
    expect(node.match!(node.params.parse({}), { ...event, entity: 'contact' }, hints)).toBe(false);
  });

  test('передаёт запись, отправителя и ящик в результат узла', async () => {
    const result = await node.execute(node.params.parse({}), { ctx: { trigger: { entity: 'contact', recordId: 'contact', email: { id: 'm', mailboxId, fromEmail: 'sender@example.com' } } } } as never);
    expect(result.output).toEqual({ entity: 'contact', recordId: 'contact', emailId: 'm', mailboxId, fromEmail: 'sender@example.com' });
  });

  test('узел доступен в модуле автоматизаций', () => {
    expect(disabledModulesOfNodes(['trigger.email_received'], new Set(['core', 'automations']))).toEqual([]);
    expect(node.params.safeParse({ mailboxId: 'bad-id' }).success).toBe(false);
  });
});
