/* Почта (задача 1092, docs/architecture/email.md): имя секрета с паролем ящика, пресеты серверов, разбор списка адресов.
   Чистые функции без Node-API: работает и в браузере. */

/** Секрет с паролем ящика (хранилище секретов, docs/architecture/secrets.md). Пароля нет ни в таблице ящиков, ни в ответах API */
export const mailboxPasswordKey = (mailboxId: string) => `mailbox.${mailboxId}.password`;
export const MAILBOX_SECRET_PREFIX = 'mailbox.';

export type MailSecurity = 'ssl' | 'starttls' | 'none';

export interface MailPreset {
  id: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: MailSecurity;
  imapHost: string;
  imapPort: number;
  imapSecure: MailSecurity;
}

/** Пресеты популярных сервисов (подставляются в форму ящика; пароль — пароль приложения) */
export const MAIL_PRESETS: readonly MailPreset[] = [
  { id: 'yandex360', smtpHost: 'smtp.yandex.ru', smtpPort: 465, smtpSecure: 'ssl', imapHost: 'imap.yandex.ru', imapPort: 993, imapSecure: 'ssl' },
  { id: 'mailru', smtpHost: 'smtp.mail.ru', smtpPort: 465, smtpSecure: 'ssl', imapHost: 'imap.mail.ru', imapPort: 993, imapSecure: 'ssl' },
  { id: 'gmail', smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecure: 'ssl', imapHost: 'imap.gmail.com', imapPort: 993, imapSecure: 'ssl' },
];

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;
export const isEmailAddress = (s: string) => s.length <= 254 && EMAIL_RE.test(s);

/** Список адресов из строки: разделители запятая, точка с запятой, пробел и перенос; повторы убираются без учёта регистра.
    Формат «Имя <a@b.ru>» понимается (берётся адрес в скобках) */
export function splitAddresses(input: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.split(/[,;\n\r]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = /<([^>]+)>/.exec(part);
    for (const a of (m ? m[1]! : part).split(/\s+/)) {
      const addr = a.trim();
      if (!addr) continue;
      const k = addr.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(addr);
    }
  }
  return out;
}

/** Ограничения письма */
export const EMAIL_MAX_RECIPIENTS = 50;
export const EMAIL_MAX_ATTACH_BYTES = 20 * 1024 * 1024;
