/* Входящие рендерятся с реальными полями письма; чужая разметка в теме остаётся текстом. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadLocale, setLocale } from '@/i18n';
import { IncomingEmailContent, IncomingEmailRow, isEmailLinked } from './EmailPage';
import type { IncomingEmail } from './data';

const incoming = (over: Partial<IncomingEmail> = {}): IncomingEmail => ({
  id: 'in-1', mailboxId: 'box-1', direction: 'in', status: 'received', fromEmail: 'buyer@example.org', fromName: 'Покупатель', to: ['sales@example.org'], cc: [], subject: 'Ответ на счёт', lastError: null, sentAt: null, createdBy: null,
  bodyText: 'Спасибо, оплатили', bodyHtml: null, receivedAt: '2026-11-19T10:00:00Z', leadId: null, contactId: null, companyId: null, dealId: null, documentId: null, attachmentIds: [], ...over,
});
const render = (email: IncomingEmail, canWrite = true) => renderToStaticMarkup(<IncomingEmailRow email={email} mailbox="sales@example.org" canWrite={canWrite} onOpen={() => {}} onLink={() => {}} />);
beforeAll(async () => { await loadLocale('ru'); setLocale('ru'); });

describe('IncomingEmailRow', () => {
  test('показывает тему, отправителя, ящик и действие для письма без привязки', () => {
    const html = render(incoming());
    expect(html).toContain('Ответ на счёт');
    expect(html).toContain('Покупатель');
    expect(html).toContain('buyer@example.org');
    expect(html).toContain('sales@example.org');
    expect(html).toContain('Без привязки');
    expect(html).toContain('Привязать к контакту или лиду');
  });
  test('связанное письмо и гость не предлагают привязку', () => {
    expect(render(incoming({ contactId: 'contact-1' }))).toContain('Привязано к CRM');
    expect(render(incoming({ leadId: 'lead-1' }))).not.toContain('Привязать к контакту или лиду');
    expect(render(incoming(), false)).not.toContain('Привязать к контакту или лиду');
    expect(isEmailLinked(incoming({ documentId: 'doc-1' }))).toBe(true);
  });
  test('показывает ограничение приёма и безопасный текст письма', () => {
    const html = renderToStaticMarkup(<IncomingEmailContent email={incoming({ lastError: 'Attachment skipped: too large', bodyText: '<img src=x onerror=alert(1)>' })} />);
    expect(html).toContain('Письмо получено с ограничениями');
    expect(html).toContain('Attachment skipped: too large');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(renderToStaticMarkup(<IncomingEmailContent email={incoming()} />)).not.toContain('Письмо получено с ограничениями');
  });
  test('пустая тема получает подпись, HTML экранируется', () => {
    expect(render(incoming({ subject: '' }))).toContain('Без темы');
    const html = render(incoming({ subject: '<script>alert(1)</script>' }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
