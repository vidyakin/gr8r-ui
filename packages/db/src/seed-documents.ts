/* Демо документов и склада для демо-воркспейса: организация «ООО «Гр8р Студия»» (ОСН, НДС 20%), два склада, реквизиты у пяти компаний CRM
   и две цепочки документов, проведённые настоящими сервисами (поэтому остатки, резервы и средняя себестоимость — как у живых данных):
   «заказ поставщику → поступление» и «заказ покупателя → счёт → реализация (УПД)» + акт услуг. Данные — на русском, интерфейс английский. */
import { accountKeyOk, DEFAULT_QUOTE_TEMPLATE, makeInn, makeOgrn, monthPeriod } from '@gr8r/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from './client';
import { changeDocumentState, createBasedOn, createDocument, ensureCostItems, postDocument, updateDocument, type DocCtx } from './documents';
import { createWorkOrderAssignment, saveWorkOrderMaterials } from './work-orders';
import { saveWorkOrderBilling } from './services';
import { ensureModuleProject, issueTaskKey } from './modules';
import { fillCountSheet } from './inventory';
import { createTemplate, createVariant } from './quotes';
import './internal-ops';
import { bankAccounts, companies, costItems, documentLines, organizations, productManufacturing, products, stockLevels, tasks, timeLogs, warehouses, workCenters, workspaces, manufacturedItems } from './schema';
import { productionPlanLines, productionPlans } from './schema';
import { planPeriods } from '@gr8r/shared';
import { createProductionFromOrder, createProductionOrder, createSupplierOrdersForOrder, fillOrderFromBom, setComponentOwner } from './production';
import { createProcessorReport, createProcessorTransfer } from './tolling';
import { createOtherCosts } from './other-costs';
import { seedInvestments } from './seed-investments';
import { seedPayments } from './seed-payments';
import { seedPayroll } from './seed-payroll';
import { closePeriodMonth } from './cost-closing';
import { assignOperations, createPieceworkOrder } from './piecework';
import { productionComponents, productionItems, productionOperations } from './schema';
import { recalculateOrderCalculation } from './calculations';
import { uuidv7 } from './uuid';
import { seedRepair } from './seed-repair';
import { seedDelivery } from './seed-delivery';
import { seedFleet } from './seed-fleet';

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10);

/** Расчётный счёт с верным контрольным ключом для БИК (подбирается девятая цифра) */
function account(bik: string, tail: string, prefix = '40702810'): string {
  for (let k = 0; k < 10; k++) {
    const acc = `${prefix}${k}${tail}`;
    if (accountKeyOk(bik, acc)) return acc;
  }
  throw new Error('no valid control key');
}

const BANKS = {
  sber: { bik: '044525225', bankName: 'ПАО Сбербанк', corr: '30101810400000000225' },
  alfa: { bik: '044525593', bankName: 'АО «Альфа-Банк»', corr: '30101810200000000593' },
  tinkoff: { bik: '044525974', bankName: 'АО «Тинькофф Банк»', corr: '30101810145250000974' },
} as const;

export interface DemoCompanyIds {
  /** Поставщик материалов */
  atlas: string;
  /** Поставщик готовой мебели */
  northwind: string;
  /** Покупатели */
  quanta: string;
  skyline: string;
}

export async function seedDocuments(db: Db, wsId: string, memberId: string, co: DemoCompanyIds) {
  const ctx: DocCtx = { workspaceId: wsId, memberId };

  /* ---------- организация и склады ---------- */
  const [org] = await db
    .insert(organizations)
    .values({
      workspaceId: wsId,
      name: 'ООО «Гр8р Студия»',
      fullName: 'Общество с ограниченной ответственностью «Гр8р Студия»',
      kind: 'legal',
      inn: makeInn('770812345'),
      kpp: '770801001',
      ogrn: makeOgrn('102770812345'),
      legalAddress: '125009, г. Москва, ул. Тверская, д. 12, стр. 1, офис 5',
      actualAddress: '125009, г. Москва, ул. Тверская, д. 12, стр. 1, офис 5',
      phone: '+7 (495) 123-45-67',
      email: 'office@gr8r.example',
      directorName: 'Соколов Андрей Викторович',
      directorTitle: 'Генеральный директор',
      accountantName: 'Кузнецова Марина Олеговна',
      taxSystem: 'osn',
      defaultVatRate: '20',
      isDefault: true,
    })
    .returning();
  await db.insert(bankAccounts).values({ workspaceId: wsId, organizationId: org!.id, bik: BANKS.sber.bik, account: account(BANKS.sber.bik, '00000012345'), corrAccount: BANKS.sber.corr, bankName: BANKS.sber.bankName, isDefault: true });
  await db.insert(bankAccounts).values({ workspaceId: wsId, organizationId: org!.id, bik: BANKS.alfa.bik, account: account(BANKS.alfa.bik, '00000067890'), corrAccount: BANKS.alfa.corr, bankName: BANKS.alfa.bankName });
  const [main] = await db.insert(warehouses).values({ workspaceId: wsId, name: 'Основной склад', code: 'MAIN', address: 'Московская обл., г. Химки, ул. Заводская, 7', isDefault: true }).returning();
  const [fg] = await db.insert(warehouses).values({ workspaceId: wsId, name: 'Склад готовой продукции', code: 'FG', address: 'г. Москва, Алтуфьевское ш., 62' }).returning();
  // склад-цех: материалы передаются на него перемещением, участок выпускает продукцию на склад готовой продукции
  const [shop] = await db.insert(warehouses).values({ workspaceId: wsId, name: 'Цех столярный', code: 'SHOP', address: 'Московская обл., г. Химки, ул. Заводская, 7, цех', kind: 'workshop' }).returning();
  // отходы и брак производства приходуются на свои склады
  const [wasteWh] = await db.insert(warehouses).values({ workspaceId: wsId, name: 'Склад отходов', code: 'WST', address: 'Московская обл., г. Химки, ул. Заводская, 7, цех' }).returning();
  const [defectWh] = await db.insert(warehouses).values({ workspaceId: wsId, name: 'Склад брака', code: 'DEF', address: 'Московская обл., г. Химки, ул. Заводская, 7, цех' }).returning();
  await db.update(workCenters).set({ warehouseId: shop!.id, outputWarehouseId: fg!.id, wasteWarehouseId: wasteWh!.id, defectWarehouseId: defectWh!.id }).where(eq(workCenters.workspaceId, wsId));

  /* ---------- реквизиты контрагентов (пять компаний) ---------- */
  const requisites = async (id: string, v: { kind?: 'legal' | 'sole_proprietor'; inn: string; kpp?: string; ogrn: string; legal: string; actual?: string; bank: keyof typeof BANKS; tail: string }) => {
    await db.update(companies).set({ kind: v.kind ?? 'legal', inn: v.inn, kpp: v.kpp ?? '', ogrn: v.ogrn, legalAddress: v.legal, actualAddress: v.actual ?? v.legal }).where(eq(companies.id, id));
    const b = BANKS[v.bank];
    await db.insert(bankAccounts).values({ workspaceId: wsId, companyId: id, bik: b.bik, account: account(b.bik, v.tail), corrAccount: b.corr, bankName: b.bankName, isDefault: true });
  };
  await requisites(co.atlas, { inn: makeInn('504711223'), kpp: '504701001', ogrn: makeOgrn('105504711223'), legal: '141400, Московская обл., г. Химки, ул. Заводская, д. 7', bank: 'sber', tail: '00000111111' });
  await requisites(co.northwind, { inn: makeInn('780214567'), kpp: '780201001', ogrn: makeOgrn('107780214567'), legal: '195197, г. Санкт-Петербург, Кондратьевский пр., д. 15', bank: 'tinkoff', tail: '00000222222' });
  await requisites(co.quanta, { inn: makeInn('772033445'), kpp: '772001001', ogrn: makeOgrn('109772033445'), legal: '115114, г. Москва, Дербеневская наб., д. 7, стр. 3', actual: '115114, г. Москва, Дербеневская наб., д. 7, стр. 3, этаж 4', bank: 'alfa', tail: '00000333333' });
  await requisites(co.skyline, { inn: makeInn('773155667'), kpp: '773101001', ogrn: makeOgrn('111773155667'), legal: '121151, г. Москва, наб. Тараса Шевченко, д. 23А', bank: 'sber', tail: '00000444444' });
  const [ip] = await db
    .insert(companies)
    .values({
      workspaceId: wsId,
      name: 'ИП Сидоров Алексей Викторович',
      industry: 'Retail',
      size: '1–10',
      city: 'Москва',
      kind: 'sole_proprietor',
      inn: makeInn('7731234567'),
      ogrn: makeOgrn('31577312345678'),
      legalAddress: '117556, г. Москва, Симферопольский б-р, д. 17, кв. 41',
      actualAddress: '117556, г. Москва, Симферопольский б-р, д. 17, кв. 41',
      ownerId: memberId,
    })
    .returning();
  await db.insert(bankAccounts).values({ workspaceId: wsId, companyId: ip!.id, bik: BANKS.tinkoff.bik, account: account(BANKS.tinkoff.bik, '00000555555'), corrAccount: BANKS.tinkoff.corr, bankName: BANKS.tinkoff.bankName, isDefault: true });

  /* ---------- товары ---------- */
  const bySku = new Map<string, { id: string; purchasePrice: string; price: string }>();
  const skus = ['MT-OAK-5050', 'MT-OAK-30', 'MT-PLY-18', 'MT-MDF-16', 'MT-EDG-2', 'MT-LAC-1', 'MT-STN-1', 'MT-GLU-1', 'MT-SND-120', 'MT-PKG-1', 'HW-SCR-440', 'HW-BLT-660', 'HW-CAM-15', 'HW-FT-60', 'HW-SHP-5', 'FRN-001', 'FRN-002', 'FRN-003', 'SV-DLV', 'SV-ASM', 'SV-MSR', 'WR-MNT', 'WR-SRV', 'MT-GLS-4', 'MT-PRF-PVC', 'MT-PNT-1', 'WIN-001', 'SV-PNT', 'MT-LOG-150', 'MT-BLK-001', 'MT-OFC-001'];
  for (const p of await db.select({ id: products.id, sku: products.sku, purchasePrice: products.purchasePrice, price: products.price }).from(products).where(inArray(products.sku, skus))) bySku.set(p.sku, p);
  const P = (sku: string) => {
    const p = bySku.get(sku);
    if (!p) throw new Error(`demo product ${sku} is missing`);
    return p;
  };
  const buy = (sku: string, qty: number) => ({ productId: P(sku).id, qty: String(qty), price: P(sku).purchasePrice, discountPct: '0' });
  const sell = (sku: string, qty: number, extra: { price?: number; discountPct?: number } = {}) => ({ productId: P(sku).id, qty: String(qty), price: String(extra.price ?? P(sku).price), discountPct: String(extra.discountPct ?? 0) });

  /** Дата документа (черновик) и проведение */
  const postAt = async (id: string, daysAgo: number) => {
    await updateDocument(db, ctx, id, { date: iso(daysAgo) });
    await postDocument(db, ctx, id);
  };

  /* ---------- закупки: заказ поставщику → поступление ---------- */
  const so1 = await createDocument(db, ctx, {
    type: 'supplier_order',
    counterpartyId: co.atlas,
    warehouseId: main!.id,
    date: iso(52),
    comment: 'Квартальный заказ материалов и фурнитуры',
    lines: [
      buy('MT-OAK-5050', 300), buy('MT-OAK-30', 40), buy('MT-PLY-18', 60), buy('MT-MDF-16', 50), buy('MT-EDG-2', 400), buy('MT-LAC-1', 30), buy('MT-STN-1', 20), buy('MT-GLU-1', 25), buy('MT-SND-120', 200), buy('MT-PKG-1', 80),
      buy('HW-SCR-440', 2000), buy('HW-BLT-660', 600), buy('HW-CAM-15', 800), buy('HW-FT-60', 300), buy('HW-SHP-5', 500),
    ],
  });
  await postAt(so1, 52);
  const rc1 = await createBasedOn(db, ctx, so1, 'receipt');
  await postAt(rc1, 45);

  const so2 = await createDocument(db, ctx, {
    type: 'supplier_order',
    counterpartyId: co.northwind,
    warehouseId: fg!.id,
    date: iso(40),
    comment: 'Готовая мебель на перепродажу',
    lines: [buy('FRN-001', 40), buy('FRN-002', 60)],
  });
  await postAt(so2, 40);
  const rc2 = await createBasedOn(db, ctx, so2, 'receipt');
  await postAt(rc2, 33);

  /* ---------- продажи: заказ покупателя → счёт → реализация (УПД) + акт услуг ---------- */
  const order = await createDocument(db, ctx, {
    type: 'customer_order',
    counterpartyId: co.quanta,
    warehouseId: fg!.id,
    date: iso(24),
    comment: 'Мебель для переговорных, доставка и сборка',
    lines: [sell('FRN-001', 12), sell('FRN-002', 20, { discountPct: 5 }), sell('SV-DLV', 1), sell('SV-ASM', 6)],
  });
  await postAt(order, 24);
  const invoice = await createBasedOn(db, ctx, order, 'invoice');
  await updateDocument(db, ctx, invoice, { dueDate: iso(17) });
  await postAt(invoice, 23);
  // УПД по счёту: товары и доставка; сборка пойдёт отдельным актом
  const shipment = await createBasedOn(db, ctx, invoice, 'realization');
  const shipmentLines = (await db.select().from(documentLines).where(eq(documentLines.documentId, shipment)).orderBy(asc(documentLines.sortOrder))).filter(l => l.productId !== P('SV-ASM').id);
  await updateDocument(db, ctx, shipment, { lines: shipmentLines.map(l => ({ id: l.id, productId: l.productId, qty: l.qty, price: l.price, discountPct: l.discountPct, vatRate: l.vatRate as never })) });
  await postAt(shipment, 20);
  const actDoc = await createBasedOn(db, ctx, order, 'act');
  await postAt(actDoc, 20);

  // коммерческое предложение → заказ с резервом остатков под отгрузку
  const quote = await createDocument(db, ctx, {
    type: 'quote',
    counterpartyId: co.skyline,
    date: iso(9),
    dueDate: iso(-5),
    comment: 'Стулья для переговорной, действует две недели',
    lines: [sell('FRN-001', 10, { price: 5600 })],
  });
  await postAt(quote, 9);
  const order2 = await createBasedOn(db, ctx, quote, 'customer_order');
  await postAt(order2, 6);

  // черновик КП с двумя вариантами и группами строк и шаблон КП (docs/architecture/quotes.md)
  const g = (groupName: string, l: ReturnType<typeof sell>) => ({ ...l, groupName });
  const offer = await createDocument(db, ctx, {
    type: 'quote',
    counterpartyId: co.skyline,
    date: iso(1),
    dueDate: iso(-13),
    comment: 'Оснащение второй переговорной: два варианта на выбор',
    lines: [g('Мебель', sell('FRN-001', 8)), g('Мебель', sell('FRN-002', 2)), g('Услуги', sell('SV-DLV', 1)), g('Услуги', sell('SV-ASM', 2))],
  });
  await updateDocument(db, ctx, offer, { variantName: 'Стандарт' });
  await createVariant(db, ctx, offer, { name: 'Эконом', copy: false });
  await updateDocument(db, ctx, offer, { lines: [g('Мебель', sell('FRN-001', 8, { discountPct: 10 })), g('Услуги', sell('SV-DLV', 1))] });
  await createTemplate(db, ctx, {
    name: 'КП с вариантами и условиями',
    body: `${DEFAULT_QUOTE_TEMPLATE.replace('{{Подписи}}', '## Условия\nОплата: 50 % предоплата, остаток — после поставки.\nСрок поставки: 10 рабочих дней.\n\n{{Подписи}}')}`,
  });

  // прямая отгрузка ИП: цены «НДС сверху»
  const direct = await createDocument(db, ctx, {
    type: 'realization',
    counterpartyId: ip!.id,
    warehouseId: fg!.id,
    priceIncludesVat: false,
    date: iso(3),
    lines: [sell('FRN-002', 8, { price: 2000 })],
  });
  await postAt(direct, 3);

  /* ---------- заказ-наряд: работа и товар, материалы и исполнитель ---------- */
  const workOrder = await createDocument(db, ctx, {
    type: 'work_order',
    counterpartyId: co.quanta,
    warehouseId: main!.id,
    date: iso(2),
    comment: 'Монтаж и наладка оборудования на объекте',
    lines: [sell('WR-MNT', 4), sell('HW-CAM-15', 6)],
  });
  await saveWorkOrderMaterials(db, ctx, workOrder, [{ productId: P('HW-BLT-660').id, qty: '12' }]);
  // Строка работы: назначение получает плановые часы из нормы (4 × 1,5 ч), работа выставляется по фактическим часам
  const [workLine] = await db.select().from(documentLines).where(and(eq(documentLines.documentId, workOrder), eq(documentLines.productId, P('WR-MNT').id))).limit(1);
  // часовой интервал назначения: сегодня с 10:00 до 13:30 — его видно в планировщике услуг
  const shiftStart = new Date(`${iso(0)}T10:00:00Z`);
  const shiftEnd = new Date(`${iso(0)}T13:30:00Z`);
  const workAssignment = await createWorkOrderAssignment(db, ctx, workOrder, {
    assigneeId: memberId,
    title: 'Монтаж и наладка на объекте',
    startDate: iso(1),
    dueDate: iso(-2),
    startAt: shiftStart.toISOString(),
    endAt: shiftEnd.toISOString(),
    lineId: workLine!.id,
  });
  await saveWorkOrderBilling(db, ctx, workOrder, [{ lineId: workLine!.id, billing: 'hours' }]);
  await db.insert(timeLogs).values({ workspaceId: wsId, taskId: workAssignment.taskId, memberId, hours: '6.500', logDate: iso(1), note: 'Монтаж и наладка на объекте' });
  await changeDocumentState(db, ctx, workOrder, 'in_progress');

  // Время по заказчику без заказ-наряда: консультация по договору — задача модуля services с заказчиком
  const servicesProject = await ensureModuleProject(db, wsId, 'services');
  const consultation = await db
    .insert(tasks)
    .values({
      workspaceId: wsId,
      key: await issueTaskKey(db, servicesProject),
      projectId: servicesProject,
      module: 'services',
      title: 'Консультация по договору обслуживания',
      status: 'done',
      assigneeId: memberId,
      companyId: co.quanta,
      workProductId: P('SV-MSR').id,
      description: 'Время записано по заказчику: заказ-наряда на эту консультацию нет',
      createdBy: memberId,
    })
    .returning({ id: tasks.id });
  await db.insert(timeLogs).values({ workspaceId: wsId, taskId: consultation![0].id, memberId, hours: '1.500', logDate: iso(3), note: 'Консультация по договору' });

  /* ---------- складские документы: перемещение между складами и списание ---------- */
  await ensureCostItems(db, wsId);
  const [brak] = await db.select({ id: costItems.id }).from(costItems).where(and(eq(costItems.workspaceId, wsId), eq(costItems.systemKey, 'brak')));
  const transfer = await createDocument(db, ctx, {
    type: 'stock_transfer',
    warehouseId: main!.id,
    targetWarehouseId: fg!.id,
    date: iso(12),
    comment: 'Фурнитура на склад готовой продукции',
    lines: [buy('HW-SCR-440', 120)],
  });
  await postAt(transfer, 12);
  const writeOff = await createDocument(db, ctx, {
    type: 'write_off',
    warehouseId: main!.id,
    costItemId: brak!.id,
    date: iso(5),
    comment: 'Брак при раскрое фанеры',
    lines: [buy('MT-PLY-18', 4)],
  });
  await postAt(writeOff, 5);

  /* ---------- производство: материалы на цех, заказ на производство и выпуск ---------- */
  const toShop = await createDocument(db, ctx, {
    type: 'stock_transfer',
    warehouseId: main!.id,
    targetWarehouseId: shop!.id,
    date: iso(4),
    comment: 'Материалы на столярный цех',
    lines: [buy('MT-OAK-5050', 60), buy('HW-SCR-440', 400), buy('MT-PKG-1', 40)],
  });
  await postAt(toShop, 4);

  const [loft] = await db.select().from(manufacturedItems).where(eq(manufacturedItems.code, 'FG-LOFT')).limit(1);
  const [assemblyCenter] = await db.select().from(workCenters).where(eq(workCenters.code, 'WS-2')).limit(1);
  const prodOrder = await createProductionOrder(db, ctx, {
    workCenterId: assemblyCenter!.id,
    warehouseId: shop!.id,
    targetWarehouseId: fg!.id,
    date: iso(3),
    comment: 'Стулья «Лофт» партией',
    items: [{ itemId: loft!.id, qty: '6' }],
  });
  await fillOrderFromBom(db, ctx, prodOrder);
  await postAt(prodOrder, 3);
  const release = await createProductionFromOrder(db, ctx, prodOrder, { date: iso(2), lines: [{ orderItemId: (await db.select().from(productionItems).where(eq(productionItems.documentId, prodOrder))).map(i => i.id)[0]!, qty: '4', defectQty: '1', defectMode: 'expense' }] });
  await postAt(release, 2);

  /* ---------- разборка: брусы делятся на заготовки и обрезки ---------- */
  const [logItem] = await db.select().from(manufacturedItems).where(eq(manufacturedItems.code, 'DIS-LOG')).limit(1);
  const [carpentryCenter] = await db.select().from(workCenters).where(eq(workCenters.code, 'WS-1')).limit(1);
  const logReceipt = await createDocument(db, ctx, {
    type: 'receipt',
    counterpartyId: co.atlas,
    warehouseId: main!.id,
    date: iso(9),
    comment: 'Брусы на раскрой',
    lines: [buy('MT-LOG-150', 30)],
  });
  await postAt(logReceipt, 9);
  const logsToShop = await createDocument(db, ctx, {
    type: 'stock_transfer',
    warehouseId: main!.id,
    targetWarehouseId: shop!.id,
    date: iso(8),
    comment: 'Брусы на столярный цех',
    lines: [buy('MT-LOG-150', 30)],
  });
  await postAt(logsToShop, 8);
  const disOrder = await createProductionOrder(db, ctx, {
    operation: 'disassembly',
    workCenterId: carpentryCenter!.id,
    warehouseId: shop!.id,
    targetWarehouseId: fg!.id,
    date: iso(7),
    comment: 'Разборка брусов на заготовки',
    items: [{ itemId: logItem!.id, qty: '10' }],
  });
  await fillOrderFromBom(db, ctx, disOrder);
  await postAt(disOrder, 7);
  const disRelease = await createProductionFromOrder(db, ctx, disOrder, { date: iso(6), lines: [{ orderItemId: (await db.select().from(productionItems).where(eq(productionItems.documentId, disOrder))).map(i => i.id)[0]!, qty: '10' }] });
  await postAt(disRelease, 6);

  /* ---------- этап 4в: назначение операции исполнителю и сдельный наряд ---------- */
  // Операция «Сборка стула» назначена сотруднику: у него появляется задача модуля production
  const [assemblyLine] = await db.select().from(productionComponents).where(and(eq(productionComponents.documentId, prodOrder), eq(productionComponents.kind, 'work'))).limit(1);
  await assignOperations(db, ctx, prodOrder, [{ componentId: assemblyLine!.id, memberId, qty: '4' }]);
  const [assignment] = await db.select().from(productionOperations).where(eq(productionOperations.documentId, prodOrder)).limit(1);
  const [releaseLine] = await db.select().from(productionComponents).where(and(eq(productionComponents.documentId, release), eq(productionComponents.kind, 'work'))).limit(1);
  const [operation] = await db.select().from(products).where(eq(products.sku, 'OP-ASM')).limit(1);
  const piecework = await createPieceworkOrder(db, ctx, {
    date: iso(2),
    memberId,
    workCenterId: assemblyCenter!.id,
    comment: 'Сборка стульев «Лофт»',
    lines: [{ operationId: operation!.id, qty: '4', planQty: '4', hours: '2', assignmentId: assignment!.id, releaseDocumentId: release, componentId: releaseLine!.id }],
  });
  await postAt(piecework, 2);

  /* ---------- этап 0б: инвентаризация, перемещение «в пути», передача в эксплуатацию ---------- */
  const count = await createDocument(db, ctx, {
    type: 'inventory_count',
    warehouseId: main!.id,
    date: iso(2),
    comment: 'Инвентаризация основного склада',
    lines: [],
  });
  await fillCountSheet(db, ctx, count);
  await postAt(count, 2);
  const inTransit = await createDocument(db, ctx, {
    type: 'stock_transfer',
    operation: 'in_transit',
    warehouseId: main!.id,
    targetWarehouseId: fg!.id,
    date: iso(1),
    comment: 'Фурнитура в пути на склад готовой продукции',
    lines: [buy('HW-SCR-440', 60)],
  });
  await postAt(inTransit, 1);
  const [exploitation] = await db.select({ id: costItems.id }).from(costItems).where(and(eq(costItems.workspaceId, wsId), eq(costItems.systemKey, 'v_expluaciatsiyu')));
  const toUse = await createDocument(db, ctx, {
    type: 'stock_transfer',
    operation: 'to_operation',
    warehouseId: main!.id,
    inUseMemberId: memberId,
    costItemId: exploitation!.id,
    date: iso(1),
    comment: 'Оснастка в эксплуатацию',
    lines: [buy('HW-SCR-440', 5)],
  });
  await postAt(toUse, 1);

  // товар производится: способ пополнения и спецификация по умолчанию — рабочее место «Выпуск продукции» видит такой заказ
  await db.insert(productManufacturing).values({ workspaceId: wsId, productId: P('FRN-003').id, replenishment: 'production', defaultItemId: loft!.id }).onConflictDoNothing();
  const chairOrder = await createDocument(db, ctx, {
    type: 'customer_order',
    counterpartyId: co.quanta,
    warehouseId: fg!.id,
    date: iso(1),
    comment: 'Стулья «Лофт» под заказ',
    lines: [sell('FRN-003', 5)],
  });
  await postAt(chairOrder, 1);

  // Окно на заказ: параметры строки (ширина, высота, цвет) и калькуляция заказа
  const [windowItem] = await db.select().from(manufacturedItems).where(eq(manufacturedItems.code, 'FG-WINDOW')).limit(1);
  await db.insert(productManufacturing).values({ workspaceId: wsId, productId: P('WIN-001').id, replenishment: 'production', defaultItemId: windowItem!.id }).onConflictDoNothing();
  const windowOrder = await createDocument(db, ctx, {
    type: 'customer_order',
    counterpartyId: co.skyline,
    warehouseId: fg!.id,
    date: iso(2),
    comment: 'Окно по замерам 1200×1400, белый цвет',
    lines: [{ id: uuidv7(), productId: P('WIN-001').id, name: 'Окно', unitCode: '796', qty: '2', price: '18500', discountPct: '0', vatRate: '20', params: { width: 1200, height: 1400, color: 'white' } }],
  });
  await postAt(windowOrder, 2);
  // калькуляция заказа: плановая себестоимость по спецификации с параметрами и наценка
  await recalculateOrderCalculation(db, wsId, { customerOrderId: windowOrder, priceSource: 'purchase_price', markupPct: '25' });

  // Заказ на производство изделия с этапами: в рабочем месте видны колонки этапов
  const [office] = await db.select().from(manufacturedItems).where(eq(manufacturedItems.code, 'FG-OFFICE')).limit(1);
  const [carpentry] = await db.select().from(workCenters).where(eq(workCenters.code, 'WS-1')).limit(1);
  const officeOrder = await createProductionOrder(db, ctx, {
    workCenterId: carpentry!.id,
    warehouseId: shop!.id,
    targetWarehouseId: fg!.id,
    date: iso(1),
    comment: 'Столы «Офис» по этапам',
    items: [{ itemId: office!.id, qty: '3' }],
  });
  await fillOrderFromBom(db, ctx, officeOrder);
  await postAt(officeOrder, 1);

  /* ---------- этап 3: обеспечение материалов — частичный резерв и размещение (заказ поставщику) ---------- */
  // поставщик материалов по умолчанию: заказы поставщикам по потребности создаются на него
  await db.update(products).set({ defaultSupplierId: co.atlas }).where(sql`${products.sku} like 'MT-%' or ${products.sku} like 'HW-%'`);
  // партия больше остатка на цехе: резерв частичный, не обеспеченное закрывается заказом поставщику (размещение)
  const bigOrder = await createProductionOrder(db, ctx, {
    workCenterId: assemblyCenter!.id,
    warehouseId: shop!.id,
    targetWarehouseId: fg!.id,
    date: iso(1),
    comment: 'Партия стульев «Лофт» под новый заказ',
    items: [{ itemId: loft!.id, qty: '40' }],
  });
  await fillOrderFromBom(db, ctx, bigOrder);
  await postAt(bigOrder, 1);
  await createSupplierOrdersForOrder(db, ctx, bigOrder, {});

  /* ---------- этап 5: план производства и нормы запаса ---------- */
  // нормы запаса: материалы закупаются (норма по компании), стулья производятся, деревянные панели перемещаются с цеха
  await db.insert(stockLevels).values([
    { workspaceId: wsId, productId: P('MT-OAK-5050').id, minQty: '20', maxQty: '60', replenishment: 'purchase' },
    { workspaceId: wsId, productId: P('MT-OAK-5050').id, warehouseId: shop!.id, minQty: '10', maxQty: '30', replenishment: 'purchase' },
    { workspaceId: wsId, productId: P('FRN-003').id, warehouseId: fg!.id, minQty: '5', maxQty: '20', replenishment: 'production' },
    { workspaceId: wsId, productId: P('MT-PLY-18').id, warehouseId: shop!.id, minQty: '10', maxQty: '40', replenishment: 'transfer', sourceWarehouseId: fg!.id },
  ]);
  // план производства на четыре недели: неделями, склад продукции и участок-диспетчер
  const periods = planPeriods(iso(0), iso(-35), 'week');
  await db.insert(productionPlans).values({
    workspaceId: wsId,
    name: 'План производства на месяц',
    periodFrom: periods[0]!,
    periodTo: periods[periods.length - 1]!,
    step: 'week',
    status: 'draft',
    warehouseId: fg!.id,
    workCenterId: assemblyCenter!.id,
    comment: 'Стулья «Лофт» и столы «Офис» по неделям',
  });
  const [plan] = await db.select().from(productionPlans).where(eq(productionPlans.workspaceId, wsId)).limit(1);
  if (plan) {
    await db.insert(productionPlanLines).values([
      { workspaceId: wsId, planId: plan.id, itemId: loft!.id, periodStart: periods[0]!, qty: '12', isSemi: false, sortOrder: 0 },
      { workspaceId: wsId, planId: plan.id, itemId: loft!.id, periodStart: periods[1]!, qty: '10', isSemi: false, sortOrder: 1 },
      { workspaceId: wsId, planId: plan.id, itemId: office!.id, periodStart: periods[1]!, qty: '4', isSemi: false, sortOrder: 2 },
    ]);
  }

  /* ---------- закрытие периода: косвенные затраты, «Прочие затраты» и закрытый месяц ---------- */
  // статьи затрат с базой распределения: электричество делится по объёму выпуска, аренда остаётся нераспределённой
  const overheadItems = await db
    .insert(costItems)
    .values([
      { workspaceId: wsId, name: 'Электроэнергия цеха', kind: 'expense', distributionMethod: 'output_qty' },
      { workspaceId: wsId, name: 'Аренда цеха', kind: 'expense', distributionMethod: 'none' },
    ])
    .onConflictDoNothing()
    .returning({ id: costItems.id, name: costItems.name });
  const el = overheadItems.find(i => i.name === 'Электроэнергия цеха')!;
  const rentItem = overheadItems.find(i => i.name === 'Аренда цеха')!;
  // поступление услуги со статьёй и участком — сумма строки становится косвенными затратами месяца
  const power = await createDocument(db, ctx, {
    type: 'receipt',
    counterpartyId: co.atlas,
    warehouseId: main!.id,
    date: iso(2),
    comment: 'Электроэнергия и отопление цеха',
    lines: [{ productId: P('SV-DLV').id, qty: '1', price: '24000', discountPct: '0', costItemId: el.id, workCenterId: assemblyCenter!.id }],
  });
  await postAt(power, 2);
  // документ «Прочие затраты»: аренда цеха и обслуживание оборудования
  const otherCosts = await createOtherCosts(db, ctx, {
    date: iso(2),
    comment: 'Прочие затраты месяца',
    lines: [
      { costItemId: rentItem.id, workCenterId: assemblyCenter!.id, amount: '90000', comment: 'Аренда цеха' },
      { costItemId: el.id, amount: '6000', comment: 'Обслуживание станков' },
    ],
  });
  await postDocument(db, ctx, otherCosts);
  /* ---------- этап 8: переработка давальческого сырья и свой склад переработчика ---------- */
  // заказ на переработку: заказ покупателя с видом операции «Переработка» (давалец — ООО «Кванта»)
  const processingOrder = await createDocument(db, ctx, {
    type: 'customer_order',
    operation: 'processing',
    counterpartyId: co.quanta,
    warehouseId: shop!.id,
    date: iso(2),
    comment: 'Партия стульев «Лофт» из сырья заказчика',
    lines: [{ productId: P('SV-ASM').id, qty: '6', price: '18000', discountPct: '0' }],
  });
  await postAt(processingOrder, 2);
  // приём давальческого сырья: количество на остаток давальца, свой склад и средняя не меняются
  const tollingReceipt = await createDocument(db, ctx, {
    type: 'tolling_receipt',
    counterpartyId: co.quanta,
    warehouseId: shop!.id,
    tollingOrderId: processingOrder,
    date: iso(2),
    comment: 'Приём дуба и фурнитуры заказчика',
    lines: [buy('MT-OAK-5050', 24), buy('HW-SCR-440', 96)],
  });
  await postAt(tollingReceipt, 2);
  // заказ на производство по заказу на переработку и выпуск: давальское сырьё списывается, продукция — давальцу
  const tollingProdOrder = await createProductionOrder(db, ctx, {
    processingOrderId: processingOrder,
    workCenterId: assemblyCenter!.id,
    warehouseId: shop!.id,
    targetWarehouseId: shop!.id,
    date: iso(1),
    comment: 'Стулья «Лофт» из сырья заказчика',
    items: [{ itemId: loft!.id, qty: '4' }],
  });
  await fillOrderFromBom(db, ctx, tollingProdOrder);
  // упаковка своя — в одном выпуске можно смешать давальческое сырьё и своё
  const tollingPack = (await db.select({ id: productionComponents.id }).from(productionComponents).where(and(eq(productionComponents.documentId, tollingProdOrder), eq(productionComponents.productId, P('MT-PKG-1').id)))).at(0);
  if (tollingPack) await setComponentOwner(db, ctx, tollingProdOrder, tollingPack.id, 'own');
  await postAt(tollingProdOrder, 1);
  // склад продукции указываем явно: иначе выпуск приходует её на склад участка, а не туда, где числится сырьё давальца
  const tollingRelease = await createProductionFromOrder(db, ctx, tollingProdOrder, { date: iso(1), targetWarehouseId: shop!.id, lines: [{ orderItemId: (await db.select().from(productionItems).where(eq(productionItems.documentId, tollingProdOrder))).map(i => i.id)[0]!, qty: '4' }] });
  await postAt(tollingRelease, 1);
  // отчёт о переработке: продукция отдана давальцу, использованное сырьё списано, отходы вернулись
  const tollingReport = await createDocument(db, ctx, {
    type: 'tolling_report',
    counterpartyId: co.quanta,
    warehouseId: shop!.id,
    tollingOrderId: processingOrder,
    date: iso(1),
    comment: 'Отчёт о переработке партии',
    lines: [
      { productId: P('FRN-003').id, qty: '4', price: '18000', discountPct: '0', vatRate: '20', tollingRole: 'product' },
      { productId: P('MT-OAK-5050').id, qty: '4', price: '0', discountPct: '0', vatRate: 'none', tollingRole: 'material' },
      { productId: P('MT-OAK-5050').id, qty: '1', price: '0', discountPct: '0', vatRate: 'none', tollingRole: 'waste' },
    ],
  });
  await postAt(tollingReport, 1);

  // свой склад переработчика: склад контрагента + заказ поставщику на переработку и передача сырья
  const [procWh] = await db.insert(warehouses).values({ workspaceId: wsId, name: 'Склад переработчика «Вихрь»', code: 'VIKHR', address: 'г. Москва, ул. Складочная, 3', counterpartyId: co.atlas }).returning();
  const procOrder = await createDocument(db, ctx, {
    type: 'supplier_order',
    operation: 'processing',
    counterpartyId: co.atlas,
    warehouseId: main!.id,
    date: iso(1),
    comment: 'Передача деталей в обработку',
    lines: [buy('MT-EDG-2', 120)],
  });
  await postAt(procOrder, 1);
  const procTransfer = await createProcessorTransfer(db, ctx, procOrder, { date: iso(1) });
  await postAt(procTransfer, 1);
  // отчёт переработчика: материалы с его склада и услуга окраски — в себестоимость продукции
  const procReport = await createProcessorReport(db, ctx, {
    itemId: loft!.id,
    qty: '4',
    processorWarehouseId: procWh!.id,
    warehouseId: fg!.id,
    workCenterId: assemblyCenter!.id,
    date: iso(1),
    basedOnId: procOrder,
    materials: [{ productId: P('MT-EDG-2').id, qty: '24' }],
    services: [{ productId: P('SV-ASM').id, qty: '4', price: '350' }],
  });
  await postAt(procReport, 1);

  // инвестпроекты: документы факта проводятся до даты запрета
  await seedInvestments(db, ctx, { organizationId: org!.id, supplierId: co.atlas, customerId: co.quanta, serviceId: P('SV-PNT').id });

  // деньги (задача 1174б): оплаты, аванс, подотчёт, инкассация; тоже до даты запрета
  await seedPayments(db, ctx, { organizationId: org!.id, customerId: co.skyline, serviceId: P('SV-PNT').id });
  // зарплата (задача 1184): оклады, начисление, ведомости, выплаты
  await seedPayroll(db, ctx, { organizationId: org!.id });

  // ремонт и серийные номера (задача 1099): смартфон с номерами, ремонтный и гарантийный заказ-наряды
  const repairSeed = await seedRepair(db, ctx, { warehouseId: main!.id, supplierId: co.atlas, customerId: co.skyline, partProductId: P('HW-CAM-15').id, workProductId: P('WR-SRV').id });

  // доставка (задача 1100): способы, курьеры и доставки в разных статусах
  await seedDelivery(db, ctx, { carrierId: co.northwind, repairWorkOrderId: repairSeed.repair });
  await seedFleet(db, ctx);

  // закрытый месяц: закрываем месяц выпуска — косвенные затраты распределяются, средняя склада пересчитывается
  const closedMonth = iso(3).slice(0, 7);
  await closePeriodMonth(db, ctx, closedMonth);
  // дата запрета — на конец закрытого месяца: документы этого месяца уже нельзя проводить и править
  const { end } = monthPeriod(closedMonth);
  await db.update(workspaces).set({ closedThrough: end, closeMovesLock: false }).where(eq(workspaces.id, wsId));

  return { documents: 34, workOrder, closedMonth, processingOrder };
}
