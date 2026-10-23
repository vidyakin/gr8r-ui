/* Демо договоров и тарифных планов (этап 8 «УНФ: Услуги»): договор обслуживания с тарифным планом,
   абонентской позицией (замер и консультация) и позицией по факту (сервисное обслуживание). */
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from './client';
import { contracts, documents, products, tariffPlanLines, tariffPlans } from './schema';

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10);

export interface SeededContract {
  id: string;
  number: string;
}

/** Тарифный план и договор обслуживания для демо-клиента */
export async function seedContracts(db: Db, wsId: string, orgId: string, customerId: string, workOrderId?: string): Promise<SeededContract> {
  const [plan] = await db
    .insert(tariffPlans)
    .values({ workspaceId: wsId, name: 'Тариф «Сервисное обслуживание»', extraProductPolicy: 'allow', note: 'Замер и консультация — абонплата, сервисное обслуживание — по факту' })
    .returning();
  const rows = await db.select().from(products).where(and(eq(products.workspaceId, wsId), inArray(products.sku, ['SV-MSR', 'WR-SRV'])));
  const by = new Map(rows.map(p => [p.sku, p]));
  await db.insert(tariffPlanLines).values([
    { workspaceId: wsId, tariffPlanId: plan!.id, productId: by.get('SV-MSR')!.id, qty: '5', price: '1200', isSubscription: true, sortOrder: 0 },
    { workspaceId: wsId, tariffPlanId: plan!.id, productId: by.get('WR-SRV')!.id, qty: '1', price: '3200', isSubscription: false, sortOrder: 1 },
  ]);
  const [contract] = await db
    .insert(contracts)
    .values({
      workspaceId: wsId,
      companyId: customerId,
      organizationId: orgId,
      number: 'Д-2026-14',
      date: iso(90),
      kind: 'customer',
      category: 'Обслуживание',
      isSigned: true,
      isDefault: true,
      validFrom: iso(90),
      validTo: null,
      paymentDays: 14,
      priceType: 'Прайс для клиентов',
      isService: true,
      tariffPlanId: plan!.id,
      periodicity: 'month',
      billingDay: 1,
      documentPackage: 'invoice',
      note: 'Договор на ежемесячное обслуживание: замеры и консультации по абонплате, сервисное обслуживание — по факту',
    })
    .returning();
  // заказ-наряд демо относится к этому договору
  if (workOrderId) await db.update(documents).set({ contractId: contract!.id }).where(eq(documents.id, workOrderId));
  return { id: contract!.id, number: contract!.number };
}
