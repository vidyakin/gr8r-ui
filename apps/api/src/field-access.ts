import { loadHiddenFields } from '@erp/db';
import type { Ctx } from './crud';
import { AppError } from './errors';

const byRequest = new WeakMap<Ctx['c'], Promise<string[]>>();

export function hiddenFieldsOf(ctx: Ctx): Promise<string[]> {
  let hidden = byRequest.get(ctx.c);
  if (!hidden) {
    hidden = loadHiddenFields(ctx.db, ctx.memberId, ctx.role, ctx.workspaceId);
    byRequest.set(ctx.c, hidden);
  }
  return hidden;
}

export function requireVisibleFields(forbidden: readonly string[]) {
  if (forbidden.length) throw new AppError(403, 'field_forbidden', 'You do not have permission to edit a hidden field');
}

/** Печатные формы содержат исходные реквизиты и суммы, включая PDF из очереди. */
export async function assertDocumentPrintAccess(ctx: Ctx) {
  const hidden = await hiddenFieldsOf(ctx);
  requireVisibleFields(hidden.filter(key => key === 'document.total'
    || key === 'company.requisites'
    || key === 'company.bankAccounts'
    || key.startsWith('custom:document.')
    || key.startsWith('custom:company.')));
}
