/* Демо воронок продаж (задача 1176): основная воронка «Продажи» с русскими этапами (нормативы, обязательные поля, вероятности)
   и вторая — «Сервис»; причины проигрыша; история этапов демо-сделок. */
import { eq } from 'drizzle-orm';
import { LEGACY_DEAL_STAGES, type LegacyDealStage, type StageTemplate } from '@gr8r/shared';
import type { Db } from './client';
import { createPipeline, insertDeal, moveDeal } from './pipelines';
import { dealLostReasons, dealStageHistory, dealStages, deals } from './schema';

const SALES: StageTemplate[] = [
  { name: 'Лид', category: 'in_progress', probability: 10, color: 'gray', slaDays: 14 },
  { name: 'Квалифицирован', category: 'in_progress', probability: 25, color: 'blue', slaDays: 10 },
  { name: 'Предложение', category: 'in_progress', probability: 50, color: 'violet', slaDays: 14, requiredFields: ['amount'] },
  { name: 'Переговоры', category: 'in_progress', probability: 75, color: 'amber', slaDays: 21, requiredFields: ['amount', 'closeDate'] },
  { name: 'Выиграна', category: 'won', probability: 100, color: 'green' },
  { name: 'Проиграна', category: 'lost', probability: 0, color: 'red' },
];
const SERVICE: StageTemplate[] = [
  { name: 'Заявка', category: 'in_progress', probability: 20, color: 'gray', slaDays: 2 },
  { name: 'Диагностика', category: 'in_progress', probability: 40, color: 'blue', slaDays: 3 },
  { name: 'Согласование сметы', category: 'in_progress', probability: 60, color: 'violet', slaDays: 5, requiredFields: ['amount'] },
  { name: 'В работе', category: 'in_progress', probability: 80, color: 'amber', slaDays: 14, requiredFields: ['amount', 'contact'] },
  { name: 'Выполнено', category: 'won', probability: 100, color: 'green' },
  { name: 'Отменено', category: 'lost', probability: 0, color: 'red' },
];
const REASONS = ['Слишком дорого', 'Выбрали конкурента', 'Нет бюджета', 'Не приняли решение', 'Не вовремя', 'Изменились требования'];

/** Воронки и причины демо-воркспейса. Возвращает id этапов основной воронки по старым ключам стадий демо-данных */
export async function seedDealPipelines(db: Db, workspaceId: string): Promise<{ stageByKey: Record<LegacyDealStage, string>; mainId: string; serviceId: string; reasonIds: string[] }> {
  const main = await createPipeline(db, workspaceId, { name: 'Продажи', stages: SALES, isDefault: true });
  const service = await createPipeline(db, workspaceId, { name: 'Сервис', stages: SERVICE });
  const reasons = await db.insert(dealLostReasons).values(REASONS.map((name, i) => ({ workspaceId, name, sortOrder: i }))).returning();
  const stageByKey = Object.fromEntries(LEGACY_DEAL_STAGES.map((s, i) => [s.key, main.stages[i]!.id])) as Record<LegacyDealStage, string>;
  return { stageByKey, mainId: main.pipeline.id, serviceId: service.pipeline.id, reasonIds: reasons.sort((a, b) => a.sortOrder - b.sortOrder).map(r => r.id) };
}

/** История демо-сделок основной воронки: вход в текущий этап в момент создания */
export async function seedDealHistory(db: Db, workspaceId: string): Promise<void> {
  const rows = await db.select().from(deals).where(eq(deals.workspaceId, workspaceId));
  if (rows.length) await db.insert(dealStageHistory).values(rows.map(d => ({ workspaceId, dealId: d.id, toPipelineId: d.pipelineId, toStageId: d.stageId, createdAt: d.createdAt })));
}

const dayOffset = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Несколько сервисных сделок через настоящий сервис перехода; одна «застряла» на этапе дольше норматива (подсветка в канбане) */
export async function seedServiceDeals(db: Db, workspaceId: string, ownerId: string, companyIds: string[], serviceId: string): Promise<void> {
  const ctx = { workspaceId, memberId: ownerId };
  const stages = await db.select().from(dealStages).where(eq(dealStages.pipelineId, serviceId));
  const id = (name: string) => stages.find(s => s.name === name)!.id;
  const mk = (i: number, name: string, amount: string, closeIn: number) =>
    insertDeal(db, ctx, { name, companyId: companyIds[i % companyIds.length] ?? null, ownerId, amount, closeDate: dayOffset(closeIn) }, { pipelineId: serviceId });
  const a = await mk(0, 'Замена фасадов кухни', '86000.00', 20);
  await mk(1, 'Ремонт раздвижной системы', '24500.00', 12);
  const c = await mk(2, 'Гарантийная подгонка дверей', '12000.00', 5);
  const d = await mk(3, 'Монтаж подсветки', '31000.00', -2);
  await moveDeal(db, ctx, a.id, { stageId: id('Диагностика') });
  await moveDeal(db, ctx, c.id, { stageId: id('Согласование сметы') });
  await moveDeal(db, ctx, d.id, { stageId: id('Выполнено') });
  await db.update(deals).set({ stageEnteredAt: new Date(Date.now() - 6 * 86_400_000) }).where(eq(deals.id, a.id));
}
