/* Демо объектов объектного учёта (задача 1268): два объекта по-русски, у одного свой склад.
   Проекты задач создаются здесь же — как это делает сервис при создании объекта.
   Смета (задача 1269): у первого объекта согласованная основная смета (2 раздела по 3 позиции) и допработа в черновике.
   Процент выполнения и вехи (задача 1272): у первого объекта аванс и два этапа, у пары позиций сметы выполненный объём. */
import type { Db } from './client';
import { objectEstimateItems, objectEstimateSections, objectEstimates, objectForemen, objectMilestones, objects, projects, warehouses } from './schema';

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
  await seedEstimates(db, wsId, memberId, inserted[0]!);
  await seedMilestones(db, wsId, inserted[0]!);
  return { objects: inserted.length };
}

/** Смета демо-объекта: согласованная основная (снимок цен и норм) и допработа в черновике. Суммы без НДС. */
async function seedEstimates(db: Db, wsId: string, memberId: string, objectId: string): Promise<void> {
  const [main] = await db
    .insert(objectEstimates)
    .values({
      workspaceId: wsId,
      objectId,
      number: 'СМ-001',
      name: 'Смета на электромонтаж корпуса 2',
      kind: 'main',
      status: 'approved',
      approvedAt: new Date(),
      approvedBy: memberId,
      note: 'Щиты, кабельные трассы и освещение мест общего пользования. Цены без НДС.',
    })
    .returning({ id: objectEstimates.id });

  const works = await db
    .insert(objectEstimateSections)
    .values({ workspaceId: wsId, estimateId: main!.id, name: 'Электромонтажные работы', sortOrder: 0 })
    .returning({ id: objectEstimateSections.id });
  const materials = await db
    .insert(objectEstimateSections)
    .values({ workspaceId: wsId, estimateId: main!.id, name: 'Материалы и оборудование', sortOrder: 1 })
    .returning({ id: objectEstimateSections.id });

  await db.insert(objectEstimateItems).values([
    // выполненный объём (задача 1272): трассы проложены, щиты смонтированы
    { workspaceId: wsId, estimateId: main!.id, sectionId: works[0]!.id, sortOrder: 0, kind: 'work', name: 'Прокладка кабеля в лотке и гофре', unitCode: '006', qty: '480', price: '250', costPrice: '150', laborHours: '0.12', vatRate: '20', doneQty: '480' },
    { workspaceId: wsId, estimateId: main!.id, sectionId: works[0]!.id, sortOrder: 1, kind: 'work', name: 'Монтаж распределительного щита', unitCode: '796', qty: '2', price: '12000', costPrice: '7000', laborHours: '6', vatRate: '20', doneQty: '2' },
    { workspaceId: wsId, estimateId: main!.id, sectionId: works[0]!.id, sortOrder: 2, kind: 'work', name: 'Пусконаладка и сдача линий', unitCode: '796', qty: '1', price: '25000', costPrice: '12000', laborHours: '16', vatRate: '20' },
    { workspaceId: wsId, estimateId: main!.id, sectionId: materials[0]!.id, sortOrder: 3, kind: 'material', name: 'Кабель ВВГнг-LS 3×2,5', unitCode: '006', qty: '500', price: '120', costPrice: '85', vatRate: '20' },
    { workspaceId: wsId, estimateId: main!.id, sectionId: materials[0]!.id, sortOrder: 4, kind: 'panel', name: 'Щит распределительный ЩР-1 (сборка)', unitCode: '796', qty: '2', price: '45000', costPrice: '32000', vatRate: '20' },
    { workspaceId: wsId, estimateId: main!.id, sectionId: materials[0]!.id, sortOrder: 5, kind: 'material', name: 'Лоток металлический 100×50', unitCode: '006', qty: '120', price: '680', costPrice: '520', vatRate: '20' },
  ]);

  const [change] = await db
    .insert(objectEstimates)
    .values({
      workspaceId: wsId,
      objectId,
      number: 'СМ-001-Д1',
      name: 'Дополнительные розеточные группы',
      kind: 'change',
      status: 'draft',
      changeStatus: 'draft',
      parentId: main!.id,
      note: 'Запрос заказчика от 12.11.2026: розетки в подъездах и кладовых.',
    })
    .returning({ id: objectEstimates.id });
  const extra = await db
    .insert(objectEstimateSections)
    .values({ workspaceId: wsId, estimateId: change!.id, name: 'Дополнительные работы', sortOrder: 0 })
    .returning({ id: objectEstimateSections.id });
  await db.insert(objectEstimateItems).values([
    { workspaceId: wsId, estimateId: change!.id, sectionId: extra[0]!.id, sortOrder: 0, kind: 'work', name: 'Монтаж подрозетников и розеток', unitCode: '796', qty: '24', price: '900', costPrice: '600', laborHours: '0.5', vatRate: '20' },
    { workspaceId: wsId, estimateId: change!.id, sectionId: extra[0]!.id, sortOrder: 1, kind: 'material', name: 'Кабель ВВГнг-LS 3×1,5', unitCode: '006', qty: '180', price: '75', costPrice: '52', vatRate: '20' },
  ]);
}

/** Вехи демо-объекта (задача 1272): аванс отдельно, «Кабельные трассы» выполнены. Проценты — от стоимости договора. */
async function seedMilestones(db: Db, wsId: string, objectId: string): Promise<void> {
  await db.insert(objectMilestones).values([
    { workspaceId: wsId, objectId, sortOrder: 0, name: 'Аванс заказчика', kind: 'advance', pct: '30', note: 'Аванс 30% на закупку материалов — не выполнение' },
    { workspaceId: wsId, objectId, sortOrder: 1, name: 'Кабельные трассы', kind: 'stage', pct: '40', doneAt: new Date('2026-11-20T12:00:00Z'), note: 'Лотки и кабель проложены' },
    { workspaceId: wsId, objectId, sortOrder: 2, name: 'Пусконаладка', kind: 'stage', pct: '30', note: 'Пусконаладка и сдача линий заказчику' },
  ]);
}
