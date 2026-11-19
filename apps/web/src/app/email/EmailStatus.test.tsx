/* Статус письма в ленте касаний рендерится с данными: подпись статуса, получатели, причина ошибки и «Повторить» только у failed. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadLocale, setLocale } from '@/i18n';
import type { EmailMessage } from './data';
import { EmailStatusView } from './EmailStatus';

const mail = (over: Partial<EmailMessage>): EmailMessage => ({ id: 'e1', mailboxId: 'm1', direction: 'out', status: 'queued', fromEmail: 'a@x.ru', to: ['buyer@client.ru'], cc: [], subject: 'КП', lastError: null, sentAt: null, createdBy: null, ...over });
const render = (e: EmailMessage | undefined) => renderToStaticMarkup(<EmailStatusView email={e} onRetry={() => {}} />);

beforeAll(async () => {
  await loadLocale('ru');
  setLocale('ru');
});

describe('EmailStatusView', () => {
  test('в очереди и отправлено: статус и получатель, без кнопки повтора', () => {
    const q = render(mail({}));
    expect(q).toContain('В очереди');
    expect(q).toContain('buyer@client.ru');
    expect(q).not.toContain('Повторить');
    expect(render(mail({ status: 'sent', lastError: 'старая ошибка' }))).not.toContain('старая ошибка');
  });
  test('ошибка: причина и «Повторить»', () => {
    const f = render(mail({ status: 'failed', lastError: '550 no such user' }));
    expect(f).toContain('Ошибка');
    expect(f).toContain('550 no such user');
    expect(f).toContain('Повторить');
  });
  test('письма нет — пусто', () => {
    expect(render(undefined)).toBe('');
  });
});
