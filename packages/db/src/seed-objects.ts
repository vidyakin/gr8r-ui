/* Демо объектов объектного учёта (задача 1268): два объекта по-русски, у одного свой склад.
   Проекты задач создаются здесь же — как это делает сервис при создании объекта. */
import type { Db } from './client';
import { objectForemen, objects, projects, warehouses } from './schema';

export async function seedObjects(
  db: Db,
  wsId: string,
  memberId: string,
  refs: { north: string; himki: string },
): Promise<{ objects: number }> {
  const [siteWarehouse] = await db
    .insert(warehouses)
    .values({ workspaceId: wsId, name: 'Склад объекта «ЖК Северный»', code: 'OBJ-SEV', address: 'г. Москва, ул. Северная, 2' })
    .returning();

  const rows = [
    {
      number: 'OBJ-001',
      name: 'ЖК Северный, корп. 2 — электромонтаж',
      customerId: refs.north,
      address: 'г. Москва, ул. Северная, 2',
      startDate: '2026-09-01',
      dueDate: '2027-06-30',
      status: 'active' as const,
      revenueMode: 'acts' as const,
      overheadPct: '12.00',
      warehouseId: siteWarehouse!.id,
      key: 'SEV2',
      note: 'Электромонтаж корпуса 2: щиты, кабельные трассы, освещение мест общего пользования.',
    },
    {
      number: 'OBJ-002',
      name: 'Склад Химки — монтаж щитовой',
      customerId: refs.himki,
      address: 'Московская обл., г. Химки, ул. Заводская, 7',
      startDate: '2026-10-15',
      dueDate: '2027-02-28',
      status: 'planning' as const,
      revenueMode: 'milestones' as const,
      overheadPct: '10.00',
      warehouseId: null,
      key: 'HIMKI',
      note: 'Монтаж щитовой на складе в Химках: сборка и подключение распределительных щитов.',
    },
  ];

  const inserted: string[] = [];
  for (const r of rows) {
    const [project] = await db
      .insert(projects)
      .values({ workspaceId: wsId, key: r.key, name: r.name, module: 'general', status: 'active', startDate: r.startDate, dueDate: r.dueDate, createdBy: memberId })
      .returning({ id: projects.id });
    const [object] = await db
      .insert(objects)
      .values({
        workspaceId: wsId,
        number: r.number,
        name: r.name,
        customerId: r.customerId,
        address: r.address,
        startDate: r.startDate,
        dueDate: r.dueDate,
        status: r.status,
        managerId: memberId,
        revenueMode: r.revenueMode,
        overheadPct: r.overheadPct,
        projectId: project!.id,
        warehouseId: r.warehouseId,
        note: r.note,
      })
      .returning({ id: objects.id });
    inserted.push(object!.id);
  }
  await db.insert(objectForemen).values([{ workspaceId: wsId, objectId: inserted[0]!, memberId }]);
  return { objects: inserted.length };
}
