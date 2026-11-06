/* Демо объектов объектного учёта (задача 1268): два объекта по-русски, у одного свой склад.
   Проекты задач создаются здесь же — как это делает сервис при создании объекта.
   Смета (задача 1269): у первого объекта согласованная основная смета (2 раздела по 3 позиции) и допработа в черновике.
   Процент выполнения и вехи (задача 1272): у первого объекта аванс и два этапа, у пары позиций сметы выполненный объём.
   Табель прораба (задача 1271): бригада из трёх рабочих без входа с бейджами и две подтверждённые смены прошлой недели.
   Выручка (задача 1273): у первого объекта подписанный акт по объёмам за прошлый месяц с выставленными счётом и актом.
   Субподряд (задача 1274): у первого объекта позиция субподряда в смете, заказ субподрядчику и принятый акт субподрядчика
   с частичным отклонением (причина из справочника причин брака) и списанием материала со склада объекта. */
import { eq } from 'drizzle-orm';
import type { Db } from './client';
import { createObjectAct, invoiceObjectAct, signObjectAct, suggestAct } from './object-acts';
import { createDocument, postDocument } from './documents';
import { acceptSubAct, createSubAct } from './object-subcontract';
import { confirmShift, createShift, saveShift } from './object-shifts';
import { addEmployeeAccrual, ensurePayrollKinds, updateEmployeePayroll } from './payroll';
import {
  defectReasons,
  members,
  objectEstimateItems,
  objectEstimateSections,
  objectEstimates,
  objectForemen,
  objectMilestones,
  objects,
  productCategories,
  products,
  projects,
  warehouses,
  workspaces,
} from './schema';

export async function seedObjects(
  db: Db,
  wsId: string,
  memberId: string,
  refs: { north: string; himki: string; subcontractor: string },
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
  const subcontract = await seedSubcontractProducts(db, wsId);
  await seedEstimates(db, wsId, memberId, inserted[0]!, subcontract);
  await seedMilestones(db, wsId, inserted[0]!);
  const crew = await seedCrew(db, wsId, memberId);
  await seedShifts(db, wsId, memberId, inserted[0]!, crew);
  await seedActs(db, wsId, memberId, inserted[0]!);
  await seedSubcontract(db, wsId, memberId, inserted[0]!, siteWarehouse!.id, refs.subcontractor, subcontract);
  return { objects: inserted.length };
}

/** Смета демо-объекта: согласованная основная (снимок цен и норм) и допработа в черновике. Суммы без НДС. */
async function seedEstimates(db: Db, wsId: string, memberId: string, objectId: string, subcontract: SubcontractRefs): Promise<void> {
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
    // субподряд (задача 1274): позиция с товаром-услугой каталога — по ней создаётся заказ субподрядчику
    {
      workspaceId: wsId,
      estimateId: main!.id,
      sectionId: works[0]!.id,
      sortOrder: 6,
      kind: 'subcontract',
      name: 'Монтаж системы видеонаблюдения (субподряд)',
      productId: subcontract.serviceId,
      unitCode: '796',
      qty: '10',
      price: '15000',
      costPrice: '12000',
      vatRate: '20',
      note: 'Работы ООО «Атлас Машиностроение»: камеры, регистратор, пусконаладка',
    },
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

/** Бригада демо-объекта (задача 1271): трое рабочих без входа с табельными номерами и бейджами.
    Стоимость часа: у первого почасовая ставка, у второго оклад (или оклада нет — стоимость не считается),
    у третьего ничего — пробел «нет ставки». Демо-пользователь — прораб этого объекта (назначен выше). */
async function seedCrew(db: Db, wsId: string, memberId: string): Promise<string[]> {
  const workers = [
    { name: 'Смирнов Пётр', personnelNumber: 'Т-101', title: 'Электромонтажник', hourlyRate: '650.00' as string | null, salary: null as string | null },
    { name: 'Кузнецов Иван', personnelNumber: 'Т-102', title: 'Электромонтажник', hourlyRate: null, salary: '45000.00' },
    { name: 'Морозов Алексей', personnelNumber: 'Т-103', title: 'Помощник электромонтажника', hourlyRate: null, salary: null },
  ];
  const kinds = await ensurePayrollKinds(db, wsId);
  const ids: string[] = [];
  for (const w of workers) {
    const code = `W${w.personnelNumber.replace(/\D/g, '').padStart(8, '0')}`;
    const [row] = await db
      .insert(members)
      .values({ workspaceId: wsId, userId: null, email: `worker-${code.toLowerCase()}@workers.invalid`, name: w.name, title: w.title, personnelNumber: w.personnelNumber, badgeCode: code, role: 'member', status: 'active' })
      .returning({ id: members.id });
    ids.push(row!.id);
    if (w.hourlyRate || w.salary) {
      await updateEmployeePayroll(db, { workspaceId: wsId, memberId }, row!.id, { hourlyRate: w.hourlyRate });
      if (w.salary) await addEmployeeAccrual(db, { workspaceId: wsId, memberId }, { memberId: row!.id, kindId: kinds.get('salary')!.id, validFrom: '2026-01-01', amount: w.salary, percentBasis: 'revenue' });
    }
  }
  return ids;
}

/** Две подтверждённые смены прошлой недели (задача 1271): часы по позициям сметы и выполненный объём один раз на бригаду */
async function seedShifts(db: Db, wsId: string, memberId: string, objectId: string, crew: string[]): Promise<void> {
  const items = await db.select({ id: objectEstimateItems.id, name: objectEstimateItems.name, kind: objectEstimateItems.kind, qty: objectEstimateItems.qty, doneQty: objectEstimateItems.doneQty }).from(objectEstimateItems).where(eq(objectEstimateItems.estimateId, (await db.select({ id: objectEstimates.id }).from(objectEstimates).where(eq(objectEstimates.objectId, objectId)).limit(1))[0]!.id));
  const cable = items.find(i => i.kind === 'work' && i.name.includes('Прокладка'));
  const commissioning = items.find(i => i.kind === 'work' && i.name.includes('Пусконаладка'));
  const ctx = { workspaceId: wsId, memberId, role: 'owner' as const };
  const day = (back: number) => new Date(Date.now() - back * 864e5).toISOString().slice(0, 10);
  const shifts = [
    { date: day(8), hours: ['8', '8', '8'], volume: null as { itemId: string; qty: string } | null, note: 'Прокладка трасс в подъездах 1–2' },
    { date: day(7), hours: ['8', '8', '4'], volume: commissioning ? { itemId: commissioning.id, qty: '0.5' } : null, note: 'Подготовка к пусконаладке, мастер уехал на другой объект' },
  ];
  for (const s of shifts) {
    const id = await createShift(db, ctx, objectId, { workDate: s.date, foremanId: memberId, note: s.note });
    await saveShift(db, ctx, id, {
      hours: crew.map((workerId, i) => ({ memberId: workerId, hours: s.hours[i]!, estimateItemId: cable?.id ?? null, note: '' })),
      volumes: s.volume ? [{ estimateItemId: s.volume.itemId, qty: s.volume.qty }] : [],
    });
    await confirmShift(db, ctx, id);
  }
}

/** Подписанный акт по объёмам за прошлый месяц и выставленные из него счёт и акт оказания услуг (задача 1273).
    Объёмы — предложенные сервисом: выполненное минус уже принятое. Сид закрывает месяц выпуска, поэтому документы
    акта остаются черновиками (их проводят после открытия периода): это штатное поведение выставления. */
async function seedActs(db: Db, wsId: string, memberId: string, objectId: string): Promise<void> {
  const ctx = { workspaceId: wsId, memberId, role: 'owner' as const };
  const [object] = await db.select({ number: objects.number }).from(objects).where(eq(objects.id, objectId)).limit(1);
  if (!object) return;
  // последний день прошлого месяца: отчётный период акта
  const now = new Date();
  const actDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10);
  const periodFrom = `${actDate.slice(0, 7)}-01`;
  const suggestion = await suggestAct(db, objectId, { kind: 'volumes', from: periodFrom, to: actDate });
  if (!suggestion.lines.length) return;
  const act = await createObjectAct(db, ctx, objectId, {
    kind: 'volumes',
    actDate,
    periodFrom,
    periodTo: actDate,
    note: `Приёмка работ за ${periodFrom.slice(0, 7)}: выполненное по смете принято заказчиком`,
    lines: suggestion.lines.map(l => ({ estimateItemId: l.estimateItemId!, qty: l.qty })),
  });
  await signObjectAct(db, ctx, act.id);
  await invoiceObjectAct(db, ctx, act.id);
}

/** Товары субподряда демо-объекта (задача 1274): услуга каталога для заказа и материал со склада объекта */
interface SubcontractRefs {
  /** Услуга «Монтаж системы видеонаблюдения (субподряд)»: строка заказа и позиции сметы */
  serviceId: string;
  /** Материал, который субподрядчик расходует со склада объекта */
  materialId: string;
}

/** Услуга-работа субподряда (одна на воркспейс) и материал монтажа из демо-каталога */
async function seedSubcontractProducts(db: Db, wsId: string): Promise<SubcontractRefs> {
  const [services] = await db.select({ id: productCategories.id }).from(productCategories).where(eq(productCategories.name, 'Услуги')).limit(1);
  const [existing] = await db.select({ id: products.id }).from(products).where(eq(products.name, 'Монтаж системы видеонаблюдения')).limit(1);
  const serviceId =
    existing?.id ??
    (
      await db
        .insert(products)
        .values({
          workspaceId: wsId,
          kind: 'service',
          sku: 'SV-CCTV',
          name: 'Монтаж системы видеонаблюдения',
          description: 'Работы субподрядчика: камеры, регистратор, пусконаладка',
          unitCode: '796',
          vatRate: '20',
          price: '15000.00',
          purchasePrice: '12000.00',
          categoryId: services?.id ?? null,
        })
        .returning({ id: products.id })
    )[0]!.id;
  // материал монтажа — фанера из демо-каталога (артикул MT-PLY-18): лежит на складе объекта
  const [material] = await db.select({ id: products.id }).from(products).where(eq(products.sku, 'MT-PLY-18')).limit(1);
  if (!material) throw new Error('Демо-каталог без фанеры: материал субподряда не из чего взять');
  return { serviceId, materialId: material.id };
}

/** Субподряд демо-объекта (задача 1274): заказ субподрядчику из позиции сметы, материалы на складе объекта
    и принятый акт субподрядчика с частичным отклонением. Документы проводятся, поэтому на время сида
    дата запрета снимается и возвращается обратно: иначе они остались бы черновиками. */
async function seedSubcontract(
  db: Db,
  wsId: string,
  memberId: string,
  objectId: string,
  objectWarehouseId: string,
  subcontractorId: string,
  refs: SubcontractRefs,
): Promise<void> {
  const ctx = { workspaceId: wsId, memberId, role: 'owner' as const };
  const now = new Date();
  // последний день прошлого месяца — период работ субподрядчика
  const docDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10);
  const periodFrom = `${docDate.slice(0, 7)}-01`;
  const [mainWarehouse] = await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.code, 'MAIN')).limit(1);
  const [reason] = await db.select({ id: defectReasons.id, name: defectReasons.name }).from(defectReasons).where(eq(defectReasons.name, 'Дефект материала')).limit(1);
  const [item] = await db
    .select({ id: objectEstimateItems.id })
    .from(objectEstimateItems)
    .where(eq(objectEstimateItems.productId, refs.serviceId))
    .limit(1);
  if (!mainWarehouse || !reason || !item) return;

  // дата запрета снимается на время сида: документы субподряда должны быть проведены
  const [lock] = await db.select({ closedThrough: workspaces.closedThrough }).from(workspaces).where(eq(workspaces.id, wsId)).limit(1);
  await db.update(workspaces).set({ closedThrough: null }).where(eq(workspaces.id, wsId));
  try {
    // заказ субподрядчику: строка-работа по закупочной цене каталога, объект — объект сметы
    const orderId = await createDocument(db, ctx, {
      type: 'supplier_order',
      counterpartyId: subcontractorId,
      warehouseId: objectWarehouseId,
      objectId,
      date: docDate,
      comment: 'Монтаж системы видеонаблюдения: заказ субподрядчику',
      lines: [{ productId: refs.serviceId, qty: '10', price: '12000', discountPct: '0' }],
    });
    await postDocument(db, ctx, orderId);

    // материал монтажа приходит на основной склад и перемещается на склад объекта
    const stock = await createDocument(db, ctx, {
      type: 'receipt',
      counterpartyId: subcontractorId,
      warehouseId: mainWarehouse.id,
      date: docDate,
      priceIncludesVat: false,
      comment: 'Фанера под монтаж видеонаблюдения',
      lines: [{ productId: refs.materialId, qty: '10', price: '1850', discountPct: '0' }],
    });
    await postDocument(db, ctx, stock);
    const transfer = await createDocument(db, ctx, {
      type: 'stock_transfer',
      warehouseId: mainWarehouse.id,
      targetWarehouseId: objectWarehouseId,
      objectId,
      date: docDate,
      comment: 'Фанера на склад объекта для субподрядчика',
      lines: [{ productId: refs.materialId, qty: '10', price: '0', discountPct: '0' }],
    });
    await postDocument(db, ctx, transfer);

    // акт субподрядчика: предъявлено 10 камер, принято 9, одна с дефектом материала; 4 листа фанеры израсходовано
    const act = await createSubAct(db, ctx, objectId, {
      counterpartyId: subcontractorId,
      orderId,
      docNumber: 'ВМ-14',
      docDate,
      periodFrom,
      periodTo: docDate,
      lines: [{ estimateItemId: item.id, qty: '10', acceptedQty: '9', defectReasonId: reason.id, note: 'Одна камера с дефектом материала' }],
      materials: [{ productId: refs.materialId, qty: '4', note: 'Фанера под крепление камер' }],
      note: `Акт субподрядчика за ${periodFrom.slice(0, 7)}: частичная приёмка с причиной отклонения`,
    });
    await acceptSubAct(db, ctx, act.id);
  } finally {
    // возвращаем дату запрета: демо-период снова закрыт
    await db.update(workspaces).set({ closedThrough: lock?.closedThrough ?? null }).where(eq(workspaces.id, wsId));
  }
}
