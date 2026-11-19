/* SMTP-транспорт почты (задача 1092, docs/architecture/email.md): nodemailer с защитой от SSRF и таймаутами.
   Адрес сервера проверяется по DNS так же, как у узла «HTTP-запрос» (shared/automations/net.ts): частные и служебные адреса
   запрещены, подключение идёт к уже проверенному IP (имя сервера остаётся для TLS). Тесты подменяют `emailRuntime.transportFor`
   фейковым транспортом — сети нет. Пароль в тексты ошибок не попадает. */
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { isForbiddenHostname, isIpLiteral, isPrivateAddress, type MailSecurity } from '@erp/shared';
import { DomainError } from './errors';

export interface MailServer {
  host: string;
  port: number;
  secure: MailSecurity;
  user: string;
  password: string;
}

export interface OutMail {
  from: { name: string; address: string };
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  html?: string | null;
  messageId: string;
  inReplyTo?: string | null;
  references?: string | null;
  attachments: { filename: string; content: Uint8Array; contentType?: string }[];
}

export interface MailTransport {
  sendMail(m: OutMail): Promise<{ messageId?: string }>;
  verify(): Promise<unknown>;
  close(): void;
}

/** Ошибка отправки: transient — временная (сеть, 4xx, таймаут), повторить; иначе окончательная (пароль, адрес, 5xx) */
export class MailError extends Error {
  override name = 'MailError';
  constructor(message: string, readonly transient: boolean, readonly kind: 'auth' | 'other' = 'other') {
    super(message);
  }
}

export const emailRuntime: {
  allowPrivate: () => boolean;
  resolve: (host: string) => Promise<string[]>;
  /** Подмена транспорта (тесты); без неё — настоящий nodemailer */
  transportFor?: (s: MailServer) => MailTransport | Promise<MailTransport>;
  imapFor?: (s: MailServer) => ImapTransport | Promise<ImapTransport>;
  /** Подмена проверки IMAP (тесты) */
  imapProbe?: (s: { host: string; port: number; secure: MailSecurity }) => Promise<void>;
} = {
  allowPrivate: () => process.env.EMAIL_ALLOW_PRIVATE === '1' || process.env.FLOW_HTTP_ALLOW_PRIVATE === '1',
  resolve: async host => (await lookup(host, { all: true })).map(a => a.address),
};

/** Быстрая проверка адреса при сохранении ящика (без DNS) */
export function assertMailHostShape(host: string): void {
  if (emailRuntime.allowPrivate()) return;
  const h = host.replace(/^\[|\]$/g, '');
  if (/[\s/@]/.test(h)) throw new DomainError(422, 'mail_host_invalid', 'Invalid mail server host');
  if (isIpLiteral(h) ? isPrivateAddress(h) : isForbiddenHostname(h)) throw new DomainError(422, 'mail_host_forbidden', 'Mail server on a private or local address is not allowed');
}

/** Проверенный IP сервера (null — разрешены любые адреса или host уже IP-литерал, подключение по имени) */
export async function resolveMailHost(host: string): Promise<string | null> {
  if (emailRuntime.allowPrivate()) return null;
  const h = host.replace(/^\[|\]$/g, '');
  if (isIpLiteral(h)) {
    if (isPrivateAddress(h)) throw new MailError('Mail server on a private or local address is not allowed', false);
    return null;
  }
  if (isForbiddenHostname(h)) throw new MailError('Mail server on a private or local address is not allowed', false);
  let addrs: string[];
  try {
    addrs = await emailRuntime.resolve(h);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'ENOTFOUND' || code === 'ENODATA') throw new MailError(`Mail server host not found: ${h}`, false);
    throw new MailError(`DNS lookup failed for ${h}`, true);
  }
  if (!addrs.length) throw new MailError(`Mail server host not found: ${h}`, false);
  if (addrs.some(isPrivateAddress)) throw new MailError('Mail server on a private or local address is not allowed', false);
  return addrs[0]!;
}

const mask = (s: string, secret: string) => (secret ? s.split(secret).join('***') : s);

/** Временная ли ошибка nodemailer: сеть и таймауты, SMTP 4xx; пароль, адрес, 5xx — окончательные */
export function classifyMailError(e: unknown, password = ''): MailError {
  if (e instanceof MailError) return e;
  const err = e as { code?: string; responseCode?: number; message?: string };
  const msg = mask(String(err?.message ?? e), password).slice(0, 500);
  if (err.code === 'EAUTH' || err.responseCode === 535 || err.responseCode === 534) return new MailError(msg, false, 'auth');
  if (typeof err.responseCode === 'number') return new MailError(msg, err.responseCode >= 400 && err.responseCode < 500);
  const network = ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNRESET', 'ECONNREFUSED', 'EDNS', 'ESOCKETTIMEDOUT', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH', 'ETLS'].includes(err.code ?? '');
  return new MailError(msg, network);
}

/** Транспорт для сервера: проверка адреса и подключение к закреплённому IP */
export async function openTransport(s: MailServer): Promise<MailTransport> {
  if (emailRuntime.transportFor) return emailRuntime.transportFor(s);
  const address = await resolveMailHost(s.host);
  const t = nodemailer.createTransport({
    host: address ?? s.host,
    port: s.port,
    secure: s.secure === 'ssl',
    requireTLS: s.secure === 'starttls',
    ignoreTLS: s.secure === 'none',
    auth: { user: s.user, pass: s.password },
    tls: { servername: net.isIP(s.host) ? undefined : s.host },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    name: 'gr8r',
  });
  return {
    sendMail: m =>
      t.sendMail({
        from: { name: m.from.name, address: m.from.address },
        to: m.to,
        cc: m.cc.length ? m.cc : undefined,
        subject: m.subject,
        text: m.text,
        html: m.html || undefined,
        messageId: m.messageId,
        inReplyTo: m.inReplyTo || undefined,
        references: m.references || undefined,
        attachments: m.attachments.map(a => ({ filename: a.filename, content: Buffer.from(a.content), contentType: a.contentType })),
      }),
    verify: () => t.verify(),
    close: () => t.close(),
  };
}

/** Ограниченный снимок INBOX; транспорт подменяется в тестах без сети. */
export interface ImapTransport {
  uidValidity: string;
  uidNext: number;
  fetchRange(from: number, to: number): Promise<{ uid: number; source: Uint8Array | null; size: number }[]>;
  close(): Promise<void>;
}
export const EMAIL_MAX_SOURCE_BYTES = 30 * 1024 * 1024;

export async function openImap(s: MailServer): Promise<ImapTransport> {
  if (emailRuntime.imapFor) return emailRuntime.imapFor(s);
  const address = await resolveMailHost(s.host);
  const client = new ImapFlow({
    host: address ?? s.host, port: s.port, secure: s.secure === 'ssl',
    doSTARTTLS: s.secure === 'starttls' ? true : s.secure === 'none' ? false : undefined,
    auth: { user: s.user, pass: s.password },
    tls: { servername: net.isIP(s.host) ? undefined : s.host },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000,
    logger: false, disableAutoIdle: true,
  });
  // Ошибки команд отклоняют их Promise; событие error не должно завершать процесс воркера.
  client.on('error', () => {});
  try {
    await client.connect();
    const box = await client.mailboxOpen('INBOX', { readOnly: true });
    return {
      uidValidity: String(box.uidValidity), uidNext: box.uidNext,
      async fetchRange(from, to) {
        if (to < from) return [];
        // Сначала завершаем FETCH: новая команда внутри его итератора блокировала бы соединение.
        const rows = await client.fetchAll(`${from}:${to}`, { uid: true, size: true }, { uid: true });
        const result: { uid: number; source: Uint8Array | null; size: number }[] = [];
        let batchBytes = 0;
        for (const r of rows) {
          let source: Uint8Array | null = null;
          if ((r.size ?? 0) <= EMAIL_MAX_SOURCE_BYTES) {
            const { content } = await client.download(r.uid, undefined, { uid: true });
            if (!content) throw new MailError('Email content is unavailable', true);
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of content) {
              size += chunk.length;
              if (size > EMAIL_MAX_SOURCE_BYTES) throw new MailError('Email source exceeds size limit', false);
              chunks.push(Buffer.from(chunk));
            }
            source = Buffer.concat(chunks);
          }
          result.push({ uid: r.uid, size: r.size ?? 0, source });
          batchBytes += source?.length ?? 0;
          if (batchBytes >= EMAIL_MAX_SOURCE_BYTES) break;
        }
        return result;
      },
      async close() { try { await client.logout(); } finally { client.close(); } },
    };
  } catch (e) { client.close(); throw classifyMailError(e, s.password); }
}

/** Полная проверка IMAP: подключение, TLS и вход с паролем приложения. */
export async function probeImap(s: MailServer): Promise<void> {
  if (emailRuntime.imapProbe) return emailRuntime.imapProbe(s);
  const client = await openImap(s);
  await client.close();
}
