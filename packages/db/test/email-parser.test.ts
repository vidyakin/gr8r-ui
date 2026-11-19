/* Разбор MIME и очистка HTML без IMAP и БД. */
import { expect, test } from 'bun:test';
import { parseInboundEmail } from '../src/email-sync';
const parse = (headers: string[], body: string) => parseInboundEmail(Buffer.from([...headers, '', body].join('\r\n')));

test('адреса и заголовки ответа, Unicode, дата', async () => {
  const m = await parse(['From: Sender <SENDER@example.com>', 'To: one@example.com, Two <two@example.com>', 'Cc: copy@example.com', 'Subject: =?UTF-8?B?0J/RgNC40LLQtdGC?=', 'Message-ID: <incoming@example.com>', 'In-Reply-To: <sent@example.com>', 'References: <old@example.com> <sent@example.com>', 'Date: Thu, 19 Nov 2026 10:00:00 +0300', 'Content-Type: text/plain; charset=utf-8'], 'Ответ');
  expect(m.fromEmail).toBe('sender@example.com');
  expect(m.to).toEqual(['one@example.com', 'two@example.com']);
  expect(m.cc).toEqual(['copy@example.com']);
  expect(m.subject).toBe('Привет');
  expect(m.bodyText.trim()).toBe('Ответ');
  expect(m.inReplyTo).toBe('<sent@example.com>');
  expect(m.references).toBe('<old@example.com> <sent@example.com>');
  expect(m.receivedAt.toISOString()).toBe('2026-11-19T07:00:00.000Z');
});

test('HTML очищается как комментарии; текст доступен без HTML', async () => {
  const m = await parse(['From: sender@example.com', 'Content-Type: text/html; charset=utf-8'], '<p>Hello <b>world</b></p><script>alert(1)</script><img src="https://tracker.example/a" onerror="alert(2)"><a href="javascript:alert(3)">link</a>');
  expect(m.bodyHtml).toContain('<b>world</b>');
  expect(m.bodyHtml).not.toMatch(/script|onerror|<img|javascript:/);
  expect(m.bodyText).toContain('Hello');
});

test('MIME-вложение сохраняет имя, тип и байты', async () => {
  const m = await parse(['From: sender@example.com', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="parts"'], ['--parts', 'Content-Type: text/plain', '', 'Message', '--parts', 'Content-Type: application/octet-stream; name="answer.bin"', 'Content-Disposition: attachment; filename="answer.bin"', 'Content-Transfer-Encoding: base64', '', 'AAEC/w==', '--parts--'].join('\r\n'));
  expect(m.attachments).toHaveLength(1);
  expect(m.attachments[0]!.name).toBe('answer.bin');
  expect(m.attachments[0]!.mime).toBe('application/octet-stream');
  expect([...m.attachments[0]!.data]).toEqual([0, 1, 2, 255]);
});

test('отсутствующие поля и некорректная дата получают безопасные значения', async () => {
  const m = await parse(['Date: invalid'], 'Text');
  expect(m.fromEmail).toBe('');
  expect(m.to).toEqual([]);
  expect(m.bodyHtml).toBeNull();
  expect(m.messageId).toBeNull();
  expect(Number.isFinite(m.receivedAt.getTime())).toBe(true);
});
