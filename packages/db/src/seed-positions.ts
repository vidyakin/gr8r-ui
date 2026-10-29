/* Демо должностей и видов номенклатуры (задача 1172): виды «Массаж», «Мебель», «Монтаж»; должности «Массажист», «Рабочий цеха»,
   «Курьер», «Менеджер» назначены участникам (кроме автора: owner видит всё). Запускается после каталога и до доставки и записи. */
import { and, asc, eq, like, ne, or } from 'drizzle-orm';
import type { Db } from './client';
import type { DocCtx } from './documents';
import { createPosition, createProductKind, setMemberPositions } from './positions';
import { members, productKinds, products } from './schema';

export async function seedPositions(db: Db, ctx: DocCtx): Promise<void> {
  const ws = ctx.workspaceId;
  const massage = await createProductKind(db, ctx, { name: 'Массаж', type: 'service', sortOrder: 1 });
  const furniture = await createProductKind(db, ctx, { name: 'Мебель', type: 'goods', sortOrder: 2 });
  const mounting = await createProductKind(db, ctx, { name: 'Монтаж', type: 'work', sortOrder: 3 });
  // виды у товаров каталога: мебель (столы, стулья, окно) и монтаж (работа)
  await db.update(products).set({ productKindId: furniture.id }).where(and(eq(products.workspaceId, ws), eq(products.kind, 'goods'), or(like(products.sku, 'TBL-%'), like(products.sku, 'FRN-%'), eq(products.sku, 'WIN-001'))));
  await db.update(products).set({ productKindId: mounting.id }).where(and(eq(products.workspaceId, ws), eq(products.sku, 'WR-MNT')));

  const masseur = await createPosition(db, ctx, { name: 'Массажист', functions: ['appointments_specialist'], sections: ['crm'], productKindIds: [massage.id], sortOrder: 1 });
  const worker = await createPosition(db, ctx, { name: 'Рабочий цеха', functions: ['production_worker'], sections: ['production', 'stock'], sortOrder: 2 });
  const courier = await createPosition(db, ctx, { name: 'Курьер', functions: ['courier'], sections: ['deliveries'], sortOrder: 3 });
  const driver = await createPosition(db, ctx, { name: 'Водитель', functions: ['driver'], sections: ['transport', 'deliveries'], sortOrder: 5 });
  const manager = await createPosition(db, ctx, { name: 'Менеджер', functions: ['sales_manager'], sections: ['crm', 'trade'], sortOrder: 4 });

  // участники по порядку создания, без автора: массажисты, менеджер, рабочий цеха, два курьера
  const people = await db.select({ id: members.id }).from(members).where(and(eq(members.workspaceId, ws), eq(members.status, 'active'), ne(members.id, ctx.memberId ?? ''))).orderBy(asc(members.createdAt), asc(members.id));
  const plan: [number, string][] = [[0, masseur.id], [1, masseur.id], [2, manager.id], [3, worker.id], [4, courier.id], [5, courier.id]];
  // водители — те же два сотрудника, что и курьеры (вторая должность)
  for (const [i, positionId] of plan) if (people[i]) await setMemberPositions(db, ctx, people[i]!.id, i >= 4 ? [positionId, driver.id] : [positionId]);
}

/** Вид номенклатуры «Массаж» для услуг записи (создаётся в seedPositions) */
export async function massageKindId(db: Db, ws: string): Promise<string | null> {
  const [k] = await db.select({ id: productKinds.id }).from(productKinds).where(and(eq(productKinds.workspaceId, ws), eq(productKinds.name, 'Массаж'))).limit(1);
  return k?.id ?? null;
}
