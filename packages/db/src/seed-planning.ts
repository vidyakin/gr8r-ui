/* Демо планирования загрузки: сменные графики, праздники, ключевые ресурсы (оборудование) и норматив
   потребности в ресурсах у операции. Названия — данные (на русском), интерфейс остаётся английским. */
import { and, eq } from 'drizzle-orm';
import type { Db } from './client';
import { productResources, resources, workCalendars, workspaceHolidays } from './schema';
import { workCenters } from './schema/production';
import { products } from './schema/catalog';
import { uuidv7 } from './uuid';

export async function seedPlanning(db: Db, wsId: string) {
  /* ---------- сменные графики ---------- */
  const fiveDay = uuidv7();
  const shift = uuidv7();
  await db.insert(workCalendars).values([
    {
      id: fiveDay,
      workspaceId: wsId,
      name: 'Пятидневка',
      kind: 'weekly',
      pattern: { weekdays: [1, 2, 3, 4, 5], startHour: 8, endHour: 17 },
      hoursPerDay: '8',
      isDefault: true,
      note: 'Пять рабочих дней, выходные в субботу и воскресенье',
    },
    {
      id: shift,
      workspaceId: wsId,
      name: 'Сменный 2/2',
      kind: 'cycle',
      pattern: { cycle: [1, 1, 0, 0] },
      cycleStart: '2026-01-05',
      hoursPerDay: '8',
      note: 'Два рабочих дня, два выходных',
    },
  ]);

  /* ---------- праздники воркспейса ---------- */
  await db.insert(workspaceHolidays).values([
    { workspaceId: wsId, date: '2026-01-01', name: 'Новый год' },
    { workspaceId: wsId, date: '2026-05-01', name: 'Праздник Весны и Труда' },
  ]);

  /* ---------- участки: мощность и график ---------- */
  const centers = await db.select({ id: workCenters.id, code: workCenters.code }).from(workCenters).where(eq(workCenters.workspaceId, wsId));
  const carpentry = centers.find(c => c.code === 'WS-1');
  const assembly = centers.find(c => c.code === 'WS-2');
  await db.update(workCenters).set({ calendarId: fiveDay, capacityHoursPerDay: '16' }).where(eq(workCenters.workspaceId, wsId));
  if (assembly) await db.update(workCenters).set({ capacityHoursPerDay: '24' }).where(eq(workCenters.id, assembly.id));

  /* ---------- ключевые ресурсы (оборудование) ---------- */
  const saw = uuidv7();
  const press = uuidv7();
  const bench = uuidv7();
  await db.insert(resources).values([
    { id: saw, workspaceId: wsId, code: 'EQ-1', name: 'Раскроечный станок', kind: 'equipment', workCenterId: carpentry?.id ?? null, capacityUnits: 1, calendarId: fiveDay, note: 'Форматно-раскроечный станок' },
    { id: press, workspaceId: wsId, code: 'EQ-2', name: 'Пресс для кромки', kind: 'equipment', workCenterId: carpentry?.id ?? null, capacityUnits: 1, calendarId: fiveDay },
    { id: bench, workspaceId: wsId, code: 'EQ-3', name: 'Сборочный верстак', kind: 'other', workCenterId: assembly?.id ?? null, capacityUnits: 2, calendarId: shift, note: 'Две смены по графику 2/2' },
  ]);

  /* ---------- норматив: операция «Сборка стула» нуждается в сборочном верстаке ---------- */
  const [operation] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.workspaceId, wsId), eq(products.kind, 'operation')))
    .limit(1);
  if (operation) await db.insert(productResources).values({ workspaceId: wsId, productId: operation.id, resourceId: bench, hoursPerUnit: '0.500' });

  return { calendars: 2, holidays: 2, resources: 3 };
}
