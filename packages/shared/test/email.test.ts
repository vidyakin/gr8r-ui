/* Почта: разбор списка адресов, имя секрета пароля, узел «Отправить письмо» с подставными портами. */
import { describe, expect, test } from 'bun:test';
import { isEmailAddress, mailboxPasswordKey, NODE_DEFS, SECRET_KEY_RE, splitAddresses } from '../src';

describe('адреса', () => {
  test('список через запятую, точку с запятой и перенос, повторы и «Имя <адрес>»', () => {
    expect(splitAddresses('a@b.ru, C@d.ru;a@B.ru\nИван <ivan@x.ru>')).toEqual(['a@b.ru', 'C@d.ru', 'ivan@x.ru']);
    expect(splitAddresses('  ')).toEqual([]);
  });
  test('проверка адреса', () => {
    expect(isEmailAddress('a@b.ru')).toBe(true);
    for (const bad of ['', 'a@b', 'a b@c.ru', '@b.ru', 'a@@b.ru']) expect(isEmailAddress(bad)).toBe(false);
  });
  test('имя секрета пароля подходит под правила хранилища', () => {
    expect(SECRET_KEY_RE.test(mailboxPasswordKey('0196a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'))).toBe(true);
  });
});

describe('узел action.email_send', () => {
  const node = NODE_DEFS['action.email_send']!;
  const rt = (record: Record<string, unknown>, calls: unknown[]) =>
    ({
      ctx: { trigger: { kind: 'event', entity: 'lead', recordId: 'L1', record, firedAt: '' } },
      sendEmail: async (a: unknown) => {
        calls.push(a);
        return { id: 'E1', mailboxId: 'M1' };
      },
    }) as never;

  test('получатели разбираются, письмо привязывается к записи триггера, владелец передаётся для выбора ящика', async () => {
    const calls: any[] = [];
    const p = node.params.parse({ mailbox: 'owner', to: 'a@b.ru; c@d.ru', subject: 'Тема', text: 'Текст' });
    const r = await node.execute(p, rt({ ownerId: 'O1' }, calls));
    expect(r.output).toMatchObject({ emailId: 'E1', mailboxId: 'M1' });
    expect(calls[0]).toMatchObject({ mailbox: 'owner', ownerId: 'O1', to: ['a@b.ru', 'c@d.ru'], link: { leadId: 'L1' } });
  });
  test('без привязки и с плохими данными', async () => {
    const calls: any[] = [];
    await node.execute(node.params.parse({ to: 'a@b.ru', subject: 'T', text: 'x', link: false }), rt({}, calls));
    expect(calls[0].link).toBeUndefined();
    await expect(node.execute(node.params.parse({ to: 'не адрес', subject: 'T', text: 'x' }), rt({}, []))).rejects.toThrow('Invalid email');
    await expect(node.execute(node.params.parse({ to: ' ; ', subject: 'T', text: 'x' }), rt({}, []))).rejects.toThrow('Recipient');
  });
});
