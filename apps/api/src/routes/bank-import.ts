/* Банковская выписка (задача 1174в): предпросмотр и импорт файла 1CClientBankExchange, выгрузка платёжных поручений.
   Разбор файла — чистая функция из @gr8r/shared, правила сопоставления — packages/db/src/bank-import.ts. */
import { zValidator } from '@hono/zod-validator';
import { commitBankImport, exportPaymentOrders, previewBankImport } from '@gr8r/db';
import { bankImportCommit, bankImportPreviewQuery, BankStatementFormatError, decodeBankStatement, encodeBankStatement, parseBankStatement, paymentOrdersQuery } from '@gr8r/shared';
import { Hono } from 'hono';
import { ctxOf, validationHook } from '../crud';
import { AppError } from '../errors';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const write = requireRole('member');
const MAX_BYTES = 5 * 1024 * 1024;

export const bankImportRoutes = new Hono<AppEnv>()
  // тело запроса — сам файл выписки (любая кодировка), счёт организации — в query
  .post('/preview', write, zValidator('query', bankImportPreviewQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const buf = new Uint8Array(await c.req.arrayBuffer());
    if (buf.byteLength === 0) throw new AppError(422, 'invalid_statement', 'The file is empty');
    if (buf.byteLength > MAX_BYTES) throw new AppError(422, 'file_too_large', 'The statement file is larger than 5 MB');
    const { text, encoding } = decodeBankStatement(buf);
    let statement;
    try {
      statement = parseBankStatement(text);
    } catch (e) {
      if (e instanceof BankStatementFormatError) throw new AppError(422, 'invalid_statement', 'The file is not a bank statement in the 1CClientBankExchange format');
      throw e;
    }
    return c.json({ encoding, ...(await previewBankImport(ctx.db, statement, { bankAccountId: c.req.valid('query').bankAccountId ?? null })) });
  })
  .post('/commit', write, zValidator('json', bankImportCommit, validationHook), async c => {
    const ctx = ctxOf(c);
    const b = c.req.valid('json');
    return c.json(await commitBankImport(ctx.db, { workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role }, b));
  })
  // платёжные поручения в формате 1CClientBankExchange (windows-1251, как ждут банк-клиенты)
  .get('/payment-orders', zValidator('query', paymentOrdersQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const r = await exportPaymentOrders(ctx.db, { bankAccountId: q.bankAccountId, ...(q.from ? { from: q.from } : {}), ...(q.to ? { to: q.to } : {}), ...(q.ids ? { ids: q.ids.split(',').filter(Boolean) } : {}) });
    if (r.count === 0) throw new AppError(422, 'nothing_to_export', 'There are no payment orders to export');
    const bytes = encodeBankStatement(r.text, 'windows-1251');
    return new Response(bytes.buffer as ArrayBuffer, {
      headers: { 'Content-Type': 'text/plain; charset=windows-1251', 'Content-Disposition': 'attachment; filename="payment-orders.txt"', 'X-Exported-Count': String(r.count), 'X-Skipped-Count': String(r.skipped.length) },
    });
  });
