/* Карантин входного контроля (задача 1186): с карантинного склада нельзя списывать товар.
   Перемещение из карантина разрешено и снимает карантин — расход в составе перемещения
   помечается флагом `transfer` и проверку не проходит.
   Модуль — лист (только схема и ошибки), поэтому его можно звать из слоя склада без циклических импортов. */
import { and, eq } from 'drizzle-orm';
import type { Db } from './client';
import { DomainError } from './errors';
import { warehouses } from './schema';

/** Карантинные склады воркспейса: с них нельзя списывать товар */
export async function quarantineWarehouses(db: Db, workspaceId: string): Promise<Set<string>> {
  const rows = await db.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.workspaceId, workspaceId), eq(warehouses.kind, 'quarantine')));
  return new Set(rows.map(r => r.id));
}

/** Расход с карантинного склада запрещён. Перемещение из карантина разрешено и снимает карантин:
    расход перемещения — часть пары «расход с карантина + приход на обычный склад», такие движения помечаются флагом `transfer`.
    `reqs` — движения документа: расходы с пометкой transfer не проверяются. */
export async function assertNoQuarantineOut(db: Db, workspaceId: string, reqs: { warehouseId: string; direction: 'in' | 'out'; transfer?: boolean }[]): Promise<void> {
  const outs = reqs.filter(r => r.direction === 'out' && !r.transfer).map(r => r.warehouseId);
  if (!outs.length) return;
  const quarantine = await quarantineWarehouses(db, workspaceId);
  const hit = [...new Set(outs)].filter(id => quarantine.has(id));
  if (!hit.length) return;
  const rows = await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses).where(and(eq(warehouses.workspaceId, workspaceId), eq(warehouses.kind, 'quarantine')));
  const names = rows.filter(r => hit.includes(r.id)).map(r => r.name);
  throw new DomainError(422, 'quarantine_blocked', `Goods on the quarantine warehouse cannot be issued: ${names.join(', ')}. Move them to a regular warehouse first`, { warehouseIds: hit });
}
