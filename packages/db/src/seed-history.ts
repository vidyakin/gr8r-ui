/* История демо (полноценный пример): четыре прошлых месяца и начало текущего — справочники (покупатели, поставщики с
   реквизитами и контактами, товары на перепродажу) и обороты, проведённые настоящими сервисами: закупки, продажи со счетами
   и возвратами, оплаты полностью/частично/с долгом, перемещения, списания, выпуск продукции, аренда и коммуналка.
   Генерация детерминирована (свой генератор случайных чисел), поэтому каждый сброс демо даёт одинаковые данные.
   Вызывается из seedDocuments до прочих цепочек — номера документов идут по порядку дат. Проверка — demo-check.ts. */
import { accountKeyOk, makeInn, makeOgrn } from '@erp/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from './client';
import { createBasedOn, createDocument, postDocument, updateDocument, type DocCtx } from './documents';
import { createPayment, createPaymentFromDocument, ensureCashFlowItems, updatePayment } from './payments';
import { createOpening } from './opening-balances';
import { createProductionFromOrder, createProductionOrder, fillOrderFromBom } from './production';
import { bankAccounts, cashFlowItems, cashRegisters, companies, contacts, costItems, documentLines, documents, manufacturedItems, productCategories, productionComponents, productionItems, products, workCenters } from './schema';

/** Сколько полных прошлых месяцев в истории (плюс текущий месяц до вчерашнего дня) */
export const HISTORY_MONTHS = 4;

/** Детерминированный генератор (mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!,
    chance: (p: number) => next() < p,
    digits: (n: number) => Array.from({ length: n }, () => Math.floor(next() * 10)).join(''),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
/** Первый день месяца со смещением от текущего (0 — текущий, 1 — прошлый…) */
export function historyMonthStart(offset: number, now = new Date()): string {
  return isoDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1)));
}
const addDays = (date: string, n: number) => isoDay(new Date(Date.parse(`${date}T00:00:00Z`) + n * 864e5));

const BANKS = [
  { bik: '044525225', bankName: 'ПАО Сбербанк', corr: '30101810400000000225' },
  { bik: '044525593', bankName: 'АО «Альфа-Банк»', corr: '30101810200000000593' },
  { bik: '044525974', bankName: 'АО «Тинькофф Банк»', corr: '30101810145250000974' },
  { bik: '044525187', bankName: 'Банк ВТБ (ПАО)', corr: '30101810700000000187' },
  { bik: '044030653', bankName: 'Северо-Западный банк ПАО Сбербанк', corr: '30101810500000000653' },
] as const;

function account(bik: string, tail: string): string {
  for (let k = 0; k < 10; k++) {
    const acc = `40702810${k}${tail}`;
    if (accountKeyOk(bik, acc)) return acc;
  }
  throw new Error('no valid control key');
}

/** Покупатели: [название, отрасль, размер, город, регион ИНН, адрес, контакт, должность] */
const CUSTOMERS: [string, string, string, string, string, string, string, string][] = [
  ['ООО «Кофейня на Чистых»', 'Общепит', '11–50', 'Москва', '77', '101000, г. Москва, Чистопрудный б-р, д. 12, стр. 2', 'Ирина Белова', 'Управляющая'],
  ['ООО «Хостел Сити»', 'Гостиничный бизнес', '11–50', 'Москва', '77', '105005, г. Москва, ул. Бауманская, д. 33', 'Дмитрий Орлов', 'Директор'],
  ['ООО «КоворкингЛаб»', 'Недвижимость', '11–50', 'Москва', '77', '123112, г. Москва, Пресненская наб., д. 10, БЦ «Башня на набережной»', 'Анна Миронова', 'Офис-менеджер'],
  ['АО «Сибирская логистика»', 'Логистика', '201–500', 'Новосибирск', '54', '630099, г. Новосибирск, ул. Советская, д. 18', 'Олег Кравцов', 'Начальник АХО'],
  ['ООО «Школа английского “Бридж”»', 'Образование', '11–50', 'Санкт-Петербург', '78', '191025, г. Санкт-Петербург, Невский пр., д. 88', 'Елена Смирнова', 'Директор'],
  ['ООО «Клиника доктора Лаврова»', 'Медицина', '51–200', 'Москва', '77', '119048, г. Москва, ул. Усачёва, д. 35', 'Павел Лавров', 'Главный врач'],
  ['ООО «Ресторан “Терраса”»', 'Общепит', '51–200', 'Казань', '16', '420111, г. Казань, ул. Баумана, д. 44', 'Ринат Галиев', 'Шеф-менеджер'],
  ['ООО «Девелопмент Групп»', 'Строительство', '201–500', 'Москва', '77', '115280, г. Москва, ул. Ленинская Слобода, д. 19', 'Сергей Носков', 'Руководитель снабжения'],
  ['ООО «Отель “Волга”»', 'Гостиничный бизнес', '51–200', 'Нижний Новгород', '52', '603005, г. Нижний Новгород, Нижне-Волжская наб., д. 9', 'Марина Зайцева', 'Директор по закупкам'],
  ['ООО «ИТ-Парк Восток»', 'Информационные технологии', '51–200', 'Екатеринбург', '66', '620014, г. Екатеринбург, ул. Малышева, д. 51', 'Артём Юдин', 'Офис-менеджер'],
  ['ООО «Детский сад “Солнышко”»', 'Образование', '11–50', 'Москва', '77', '129344, г. Москва, ул. Енисейская, д. 22', 'Татьяна Ковалёва', 'Заведующая'],
  ['ООО «Фитнес Про»', 'Спорт', '11–50', 'Санкт-Петербург', '78', '197101, г. Санкт-Петербург, Каменноостровский пр., д. 42', 'Никита Волков', 'Управляющий'],
];
const SOLE: [string, string, string][] = [
  ['ИП Морозова Ольга Петровна', 'Розничная торговля', '141070, Московская обл., г. Королёв, пр. Космонавтов, д. 8, кв. 15'],
  ['ИП Гусев Кирилл Андреевич', 'Дизайн интерьеров', '197198, г. Санкт-Петербург, ул. Блохина, д. 25, кв. 7'],
];
/** Поставщики: [название, отрасль, город, регион, адрес, контакт, что поставляет] */
const SUPPLIERS: [string, string, string, string, string, string, 'resale' | 'materials'][] = [
  ['ООО «МебельОпт»', 'Оптовая торговля', 'Москва', '50', '143005, Московская обл., г. Одинцово, Транспортная ул., д. 2', 'Виктор Лапин', 'resale'],
  ['ООО «Фабрика “Уют”»', 'Производство мебели', 'Пенза', '58', '440028, г. Пенза, ул. Германа Титова, д. 7', 'Людмила Карпова', 'resale'],
  ['ООО «Офисные решения»', 'Оптовая торговля', 'Москва', '77', '109428, г. Москва, Рязанский пр., д. 8А', 'Глеб Шестаков', 'resale'],
  ['ООО «ЛесПромТорг»', 'Деревообработка', 'Кострома', '44', '156005, г. Кострома, ул. Ивана Сусанина, д. 41', 'Андрей Белых', 'materials'],
  ['ООО «Фурнитура Хаб»', 'Оптовая торговля', 'Москва', '77', '115432, г. Москва, пр. Андропова, д. 18, к. 6', 'Ксения Рябова', 'materials'],
];

/** Товары на перепродажу: [ключ, название, sku, категория, цена, закупка] */
const RESALE: [string, string, string, 'furniture' | 'tables' | 'hardware', number, number][] = [
  ['armchair', 'Кресло офисное «Комфорт»', 'FRN-101', 'furniture', 14900, 8900],
  ['chairMesh', 'Кресло сетчатое «Аэро»', 'FRN-102', 'furniture', 21500, 13200],
  ['sofa', 'Диван трёхместный «Берлин»', 'FRN-103', 'furniture', 64900, 41000],
  ['rack', 'Стеллаж металлический 5 полок', 'FRN-104', 'furniture', 8900, 5100],
  ['wardrobe', 'Шкаф для одежды двухстворчатый', 'FRN-105', 'furniture', 27900, 17500],
  ['pedestal', 'Тумба мобильная 3 ящика', 'FRN-106', 'furniture', 9400, 5600],
  ['cabinet', 'Шкаф для документов высокий', 'FRN-107', 'furniture', 19800, 12100],
  ['barStool', 'Стул барный «Лофт»', 'FRN-108', 'furniture', 7900, 4300],
  ['bench', 'Банкетка для прихожей', 'FRN-109', 'furniture', 6500, 3700],
  ['hanger', 'Вешалка напольная', 'FRN-110', 'furniture', 4200, 2300],
  ['meetTable', 'Стол переговорный 2400×1200', 'TBL-101', 'tables', 46500, 29800],
  ['cafeTable', 'Стол для кафе 700×700', 'TBL-102', 'tables', 8900, 5200],
  ['standDesk', 'Стол с электроприводом 1400×700', 'TBL-103', 'tables', 38900, 25400],
  ['coffeeTable', 'Стол журнальный круглый', 'TBL-104', 'tables', 9900, 5900],
  ['hinge', 'Петля накладная с доводчиком', 'HW-HNG-35', 'hardware', 120, 62],
  ['slide', 'Направляющие шариковые 450 мм (пара)', 'HW-SLD-450', 'hardware', 390, 210],
  ['handle', 'Ручка-скоба 128 мм, чёрная', 'HW-HDL-128', 'hardware', 180, 95],
  ['gasLift', 'Газлифт 100N', 'HW-GAS-100', 'hardware', 260, 140],
];

/** Наборы продаж по типу клиента: ключи товаров из RESALE и старого каталога */
const BASKETS: { key: string; qty: [number, number] }[][] = [
  [{ key: 'armchair', qty: [4, 20] }, { key: 'pedestal', qty: [2, 12] }, { key: 'cabinet', qty: [1, 6] }],
  [{ key: 'chairMesh', qty: [6, 24] }, { key: 'standDesk', qty: [2, 10] }, { key: 'meetTable', qty: [1, 2] }],
  [{ key: 'cafeTable', qty: [4, 16] }, { key: 'barStool', qty: [6, 24] }, { key: 'FRN-001', qty: [8, 30] }],
  [{ key: 'sofa', qty: [1, 3] }, { key: 'coffeeTable', qty: [1, 4] }, { key: 'hanger', qty: [2, 6] }, { key: 'bench', qty: [1, 4] }],
  [{ key: 'wardrobe', qty: [2, 8] }, { key: 'rack', qty: [3, 12] }, { key: 'FRN-002', qty: [6, 20] }],
  [{ key: 'FRN-003', qty: [4, 12] }, { key: 'meetTable', qty: [1, 1] }, { key: 'chairMesh', qty: [4, 10] }],
];

export interface HistoryRefs {
  organizationId: string;
  mainWarehouseId: string;
  fgWarehouseId: string;
  shopWarehouseId: string;
  /** Старые поставщики сида: материалы и готовая мебель */
  materialsSupplierId: string;
  furnitureSupplierId: string;
  /** Старые покупатели сида (получают часть продаж) */
  customerIds: string[];
}

export interface HistoryResult {
  /** Касса «Основная касса» и начальные остатки денег созданы здесь — seedPayments их не повторяет */
  cashRegisterId: string;
  bankAccountId: string;
  documents: number;
  months: string[];
}

export async function seedHistory(db: Db, ctx: DocCtx, refs: HistoryRefs, now = new Date()): Promise<HistoryResult> {
  const ws = ctx.workspaceId;
  const r = rng(20261117);
  const yesterday = isoDay(new Date(now.getTime() - 864e5));
  const start = historyMonthStart(HISTORY_MONTHS, now);
  let count = 0;

  /* ---------- справочники: товары на перепродажу ---------- */
  const cats = await db.select({ id: productCategories.id, name: productCategories.name }).from(productCategories).where(eq(productCategories.workspaceId, ws));
  const catId = { furniture: cats.find(c => c.name === 'Мебель')?.id ?? null, tables: cats.find(c => c.name === 'Столы')?.id ?? null, hardware: cats.find(c => c.name === 'Фурнитура')?.id ?? null };
  await db.insert(products).values(
    RESALE.map(([, name, sku, cat, price, purchase], i) => ({
      workspaceId: ws,
      kind: 'goods' as const,
      sku,
      name,
      barcode: ean13(`46100000${String(i + 1).padStart(4, '0')}`),
      unitCode: '796',
      vatRate: '20',
      price: price.toFixed(2),
      purchasePrice: purchase.toFixed(2),
      categoryId: catId[cat],
      attrs: cat === 'hardware' ? {} : { brand: r.pick(['Loft&Co', 'Уют', 'OfficePro']) },
    })),
  );
  const skuOf = new Map(RESALE.map(([key, , sku]) => [key, sku]));
  const allSkus = [...RESALE.map(x => x[2]), 'FRN-001', 'FRN-002', 'FRN-003', 'SV-DLV', 'SV-ASM', 'MT-PKG-1', 'MT-EDG-2', 'MT-PLY-18', 'MT-LAC-1', 'HW-SCR-440', 'HW-CAM-15'];
  const prodRows = await db.select({ id: products.id, sku: products.sku, price: products.price, purchasePrice: products.purchasePrice }).from(products).where(and(eq(products.workspaceId, ws), inArray(products.sku, allSkus)));
  const bySku = new Map(prodRows.map(p => [p.sku, p]));
  const P = (keyOrSku: string) => {
    const p = bySku.get(skuOf.get(keyOrSku) ?? keyOrSku);
    if (!p) throw new Error(`history product ${keyOrSku} is missing`);
    return p;
  };

  /* ---------- справочники: контрагенты с реквизитами и контактами ---------- */
  const usedTails = new Set<string>();
  const tail = () => {
    let t: string;
    do t = r.digits(11);
    while (usedTails.has(t));
    usedTails.add(t);
    return t;
  };
  const addBank = async (companyId: string) => {
    const b = r.pick(BANKS);
    await db.insert(bankAccounts).values({ workspaceId: ws, companyId, bik: b.bik, account: account(b.bik, tail()), corrAccount: b.corr, bankName: b.bankName, isDefault: true });
  };
  const translit = (s: string) => s.toLowerCase().replace(/[^a-zа-яё]+/g, '').replace(/[а-яё]/g, ch => ({ а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' })[ch] ?? '');
  const phone = () => `+7 (${r.pick(['495', '499', '812', '343', '383', '843'])}) ${r.digits(3)}-${r.digits(2)}-${r.digits(2)}`;
  const addCompany = async (v: { name: string; industry: string; size: string; city: string; region: string; address: string; contact?: string; title?: string; sole?: boolean }) => {
    const sole = !!v.sole;
    const innBase = sole ? `${v.region}${r.digits(8)}` : `${v.region}${r.digits(7)}`;
    const [c] = await db
      .insert(companies)
      .values({
        workspaceId: ws,
        name: v.name,
        industry: v.industry,
        size: v.size,
        city: v.city,
        kind: sole ? 'sole_proprietor' : 'legal',
        inn: makeInn(innBase),
        kpp: sole ? '' : `${v.region}${r.digits(2)}01001`,
        ogrn: sole ? makeOgrn(`3${r.digits(2)}${v.region}${r.digits(10)}`.slice(0, 14)) : makeOgrn(`1${r.digits(2)}${v.region}${r.digits(7)}`.slice(0, 12)),
        legalAddress: v.address,
        actualAddress: v.address,
        ownerId: ctx.memberId,
        createdAt: new Date(`${start}T09:00:00Z`),
      })
      .returning({ id: companies.id });
    await addBank(c!.id);
    if (v.contact) {
      const domain = translit(v.name.replace(/^(ООО|АО|ИП)\s*/, '')).slice(0, 14) || 'company';
      const [first, last] = v.contact.split(' ');
      await db.insert(contacts).values({ workspaceId: ws, companyId: c!.id, name: v.contact, title: v.title ?? '', email: `${translit(first!)}.${translit(last ?? '')}@${domain}.ru`, phone: phone(), ownerId: ctx.memberId });
    }
    return c!.id;
  };
  const customers: string[] = [];
  for (const [name, industry, size, city, region, address, contact, title] of CUSTOMERS) customers.push(await addCompany({ name, industry, size, city, region, address, contact, title }));
  for (const [name, industry, address] of SOLE) customers.push(await addCompany({ name, industry, size: '1–10', city: address.includes('Петербург') ? 'Санкт-Петербург' : 'Москва', region: address.includes('Петербург') ? '78' : '50', address, sole: true }));
  const resaleSuppliers = [refs.furnitureSupplierId];
  const materialSuppliers = [refs.materialsSupplierId];
  for (const [name, industry, city, region, address, contact, kind] of SUPPLIERS) {
    const id = await addCompany({ name, industry, size: '51–200', city, region, address, contact, title: 'Менеджер по продажам' });
    (kind === 'resale' ? resaleSuppliers : materialSuppliers).push(id);
  }
  const allCustomers = [...customers, ...refs.customerIds];

  /* ---------- деньги: касса, статьи, начальные остатки на начало истории ---------- */
  await ensureCashFlowItems(db, ws);
  const [register] = await db.insert(cashRegisters).values({ workspaceId: ws, name: 'Основная касса', organizationId: refs.organizationId, responsibleId: ctx.memberId }).returning({ id: cashRegisters.id });
  const [bank] = await db.select({ id: bankAccounts.id }).from(bankAccounts).where(and(eq(bankAccounts.organizationId, refs.organizationId), eq(bankAccounts.isDefault, true))).limit(1);
  const flow = async (name: string, kind: 'income' | 'expense') => (await db.insert(cashFlowItems).values({ workspaceId: ws, name, kind, flowGroup: 'operating' }).returning({ id: cashFlowItems.id }))[0]!.id;
  const rentFlow = await flow('Аренда склада и цеха', 'expense');
  const utilFlow = await flow('Коммунальные услуги', 'expense');
  const retailFlow = await flow('Розничная выручка', 'income');
  const opening = await createOpening(db, ctx, {
    organizationId: refs.organizationId,
    date: addDays(start, -1),
    comment: 'Остатки на начало учёта',
    lines: [
      { kind: 'cash', cashRegisterId: register!.id, amount: '150000.00', comment: 'Наличные в основной кассе' },
      { kind: 'bank', bankAccountId: bank!.id, amount: '6000000.00', comment: 'Остаток на расчётном счёте' },
    ] as never,
  });
  await postDocument(db, ctx, opening);
  count++;

  /* ---------- помощники ---------- */
  const postOn = async (id: string, date: string) => {
    await updateDocument(db, ctx, id, { date });
    await postDocument(db, ctx, id);
    count++;
  };
  const payOn = async (id: string, date: string) => {
    await updatePayment(db, ctx, id, { date });
    await postDocument(db, ctx, id);
    count++;
  };
  const clamp = (date: string) => (date > yesterday ? yesterday : date);
  const line = (key: string, qty: number, price: string, discountPct = 0) => ({ productId: P(key).id, qty: String(qty), price, discountPct: String(discountPct) });
  const [brak] = await db.select({ id: costItems.id }).from(costItems).where(and(eq(costItems.workspaceId, ws), eq(costItems.systemKey, 'brak')));
  const [loft] = await db.select().from(manufacturedItems).where(and(eq(manufacturedItems.workspaceId, ws), eq(manufacturedItems.code, 'FG-LOFT'))).limit(1);
  const [assembly] = await db.select().from(workCenters).where(and(eq(workCenters.workspaceId, ws), eq(workCenters.code, 'WS-2'))).limit(1);

  const months: string[] = [];
  for (let offset = HISTORY_MONTHS; offset >= 0; offset--) {
    const m0 = historyMonthStart(offset, now);
    const current = offset === 0;
    // текущий месяц — только до вчерашнего дня и меньше оборотов
    const lastDay = current ? yesterday : addDays(historyMonthStart(offset - 1, now), -1);
    if (lastDay < addDays(m0, 6)) continue;
    months.push(m0.slice(0, 7));
    const d = (day: number) => clamp(addDays(m0, day - 1) > lastDay ? lastDay : addDays(m0, day - 1));

    /* продажи месяца: план корзин (нужен заранее, чтобы закупить под него) */
    const orders = Array.from({ length: current ? r.int(3, 5) : r.int(9, 13) }, () => {
      const basket = r.pick(BASKETS);
      const items = basket.filter((_, i) => i === 0 || r.chance(0.6)).map(b => ({ key: b.key, qty: r.int(b.qty[0], b.qty[1]) }));
      return { customer: r.pick(allCustomers), day: r.int(5, current ? 14 : 26), items, delivery: r.chance(0.6), assembly: r.chance(0.35), discount: r.chance(0.25) ? r.pick([3, 5, 7, 10]) : 0 };
    });
    const need = new Map<string, number>();
    for (const o of orders) for (const it of o.items) need.set(it.key, (need.get(it.key) ?? 0) + it.qty);

    /* закупка готовой мебели под план (FRN-003 — своё производство, его не закупаем) */
    const toBuy = [...need].filter(([k]) => k !== 'FRN-003');
    const bySupplier = new Map<string, [string, number][]>();
    toBuy.forEach(([k, q], i) => {
      const sup = resaleSuppliers[i % resaleSuppliers.length]!;
      bySupplier.set(sup, [...(bySupplier.get(sup) ?? []), [k, Math.ceil(q * 1.15) + r.int(0, 3)]]);
    });
    for (const [sup, items] of bySupplier) {
      const so = await createDocument(db, ctx, { type: 'supplier_order', counterpartyId: sup, warehouseId: refs.fgWarehouseId, date: d(1), comment: 'Закупка под заказы месяца', lines: items.map(([k, q]) => line(k, q, P(k).purchasePrice)) });
      await postOn(so, d(1));
      const rc = await createBasedOn(db, ctx, so, 'receipt');
      await postOn(rc, d(r.int(2, 4)));
      // поставщику платим через 5–20 дней; в последнем закрытом и текущем месяце часть — в долг
      if (!(offset <= 1 && r.chance(0.4))) {
        const pay = await createPaymentFromDocument(db, ctx, rc, 'bank');
        await payOn(pay, clamp(addDays(d(4), r.int(5, 20))));
      }
    }

    /* материалы и производство стульев «Лофт» (кроме текущего месяца) */
    const chairs = need.get('FRN-003') ?? 0;
    if (loft && assembly && (chairs > 0 || !current)) {
      const qty = Math.max(chairs + r.int(2, 6), 6);
      const po = await createProductionOrder(db, ctx, { workCenterId: assembly.id, warehouseId: refs.shopWarehouseId, targetWarehouseId: refs.fgWarehouseId, date: d(2), comment: `Стулья «Лофт» на ${m0.slice(0, 7)}`, items: [{ itemId: loft.id, qty: String(qty) }] });
      await fillOrderFromBom(db, ctx, po);
      const comps = await db.select({ productId: productionComponents.productId, qty: productionComponents.qty }).from(productionComponents).where(eq(productionComponents.documentId, po));
      const mat = new Map<string, number>();
      for (const c of comps) if (c.productId && Number(c.qty) > 0) mat.set(c.productId, (mat.get(c.productId) ?? 0) + Number(c.qty));
      if (mat.size) {
        const matLines = [...mat].map(([productId, q]) => {
          const p = prodRows.find(x => x.id === productId);
          return { productId, qty: String(Math.ceil(q * 1.1)), price: p?.purchasePrice ?? '0', discountPct: '0' };
        });
        // цены материалов, которых нет в выборке, берём из карточки
        for (const l of matLines) if (l.price === '0') l.price = (await db.select({ p: products.purchasePrice }).from(products).where(eq(products.id, l.productId)).limit(1))[0]?.p ?? '0';
        const rc = await createDocument(db, ctx, { type: 'receipt', counterpartyId: r.pick(materialSuppliers), warehouseId: refs.mainWarehouseId, date: d(2), comment: 'Материалы для производства', lines: matLines });
        await postOn(rc, d(2));
        const pay = await createPaymentFromDocument(db, ctx, rc, 'bank');
        await payOn(pay, clamp(addDays(d(2), r.int(3, 10))));
        const tr = await createDocument(db, ctx, { type: 'stock_transfer', warehouseId: refs.mainWarehouseId, targetWarehouseId: refs.shopWarehouseId, date: d(3), comment: 'Материалы на сборочный участок', lines: [...mat].map(([productId, q]) => ({ productId, qty: String(Math.ceil(q * 1.05)), price: '0', discountPct: '0' })) });
        await postOn(tr, d(3));
      }
      await postOn(po, d(3));
      const itemIds = (await db.select({ id: productionItems.id }).from(productionItems).where(eq(productionItems.documentId, po))).map(i => i.id);
      const rel = await createProductionFromOrder(db, ctx, po, { date: d(4), lines: [{ orderItemId: itemIds[0]!, qty: String(qty) }] });
      await postOn(rel, d(4));
    }

    /* продажи: заказ → (счёт) → реализация → оплата; возвраты и долги */
    let returned = false;
    for (const o of orders) {
      const lines = [
        ...o.items.map(it => line(it.key, it.qty, P(it.key).price, o.discount)),
        ...(o.delivery ? [line('SV-DLV', 1, P('SV-DLV').price)] : []),
        ...(o.assembly ? [line('SV-ASM', Math.max(1, Math.round(o.items.reduce((s, x) => s + x.qty, 0) / 4)), P('SV-ASM').price)] : []),
      ];
      const orderDate = d(o.day);
      const order = await createDocument(db, ctx, { type: 'customer_order', counterpartyId: o.customer, warehouseId: refs.fgWarehouseId, date: orderDate, comment: r.pick(['Оснащение офиса', 'Мебель для нового зала', 'Дозаказ по договору', 'Обновление интерьера', 'Комплектация открытия']), lines });
      await postOn(order, orderDate);
      // в текущем месяце часть заказов ещё не отгружена — остаются резервы
      if (current && r.chance(0.5)) continue;
      const withInvoice = r.chance(0.7);
      let base = order;
      if (withInvoice) {
        const invoice = await createBasedOn(db, ctx, order, 'invoice');
        await updateDocument(db, ctx, invoice, { dueDate: addDays(orderDate, 10) });
        await postOn(invoice, clamp(addDays(orderDate, 1)));
        base = invoice;
      }
      const shipDate = clamp(addDays(orderDate, r.int(2, 7)));
      const ship = await createBasedOn(db, ctx, base, 'realization');
      await updateDocument(db, ctx, ship, { dueDate: addDays(shipDate, 14) });
      await postOn(ship, shipDate);
      // оплаты: предоплата по счёту, оплата по факту, частичная; в свежих месяцах часть ещё не оплачена (дебиторка)
      const roll = r.next();
      if (offset <= 1 && roll < 0.35) continue;
      if (roll < 0.25) {
        // частичная оплата: половина, остаток — долг покупателя
        const p = await createPaymentFromDocument(db, ctx, ship, 'bank');
        const [doc] = await db.select({ total: documents.total }).from(documents).where(eq(documents.id, ship)).limit(1);
        await updatePayment(db, ctx, p, { lines: [{ settlementDocumentId: ship, amount: (Number(doc!.total) / 2).toFixed(2), comment: 'Оплата 50%' } as never] });
        await payOn(p, clamp(addDays(shipDate, r.int(5, 15))));
      } else {
        const p = await createPaymentFromDocument(db, ctx, ship, r.chance(0.12) ? 'cash' : 'bank');
        await payOn(p, clamp(addDays(shipDate, r.int(1, 18))));
      }
      // возврат части товара — раз в месяц, по первой подходящей отгрузке
      if (!returned && !current && r.chance(0.3)) {
        const ret = await createBasedOn(db, ctx, ship, 'customer_return');
        const retLines = (await db.select().from(documentLines).where(eq(documentLines.documentId, ret))).filter(l => l.productId !== P('SV-DLV').id && l.productId !== P('SV-ASM').id);
        const one = retLines.find(l => Number(l.qty) >= 2);
        if (one) {
          await updateDocument(db, ctx, ret, { comment: 'Возврат: повреждение при транспортировке', lines: [{ id: one.id, productId: one.productId, qty: '1', price: one.price, discountPct: one.discountPct, vatRate: one.vatRate as never }] });
          await postOn(ret, clamp(addDays(shipDate, r.int(3, 8))));
          returned = true;
        }
      }
    }

    /* склад: перемещение фурнитуры на склад готовой продукции и списание брака */
    if (!current) {
      const hw = await createDocument(db, ctx, { type: 'receipt', counterpartyId: r.pick(materialSuppliers), warehouseId: refs.mainWarehouseId, date: d(6), comment: 'Фурнитура для сборки у клиентов', lines: [line('hinge', r.int(100, 300), P('hinge').purchasePrice), line('slide', r.int(40, 120), P('slide').purchasePrice), line('handle', r.int(80, 200), P('handle').purchasePrice), line('gasLift', r.int(20, 60), P('gasLift').purchasePrice)] });
      await postOn(hw, d(6));
      const hwPay = await createPaymentFromDocument(db, ctx, hw, 'bank');
      await payOn(hwPay, d(r.int(10, 20)));
      const tr = await createDocument(db, ctx, { type: 'stock_transfer', warehouseId: refs.mainWarehouseId, targetWarehouseId: refs.fgWarehouseId, date: d(12), comment: 'Фурнитура на склад готовой продукции', lines: [line('hinge', 40, '0'), line('handle', 30, '0')] });
      await postOn(tr, d(12));
      if (r.chance(0.6) && brak) {
        const wo = await createDocument(db, ctx, { type: 'write_off', warehouseId: refs.mainWarehouseId, costItemId: brak.id, date: d(20), comment: 'Брак фурнитуры: сломанные направляющие', lines: [line('slide', r.int(2, 6), '0')] });
        await postOn(wo, d(20));
      }
    }

    /* постоянные расходы: аренда, коммуналка; розничная выручка в кассу */
    const rent = await createPayment(db, ctx, { type: 'bank_payment', operation: 'other_expense', bankAccountId: bank!.id, comment: `Аренда склада и цеха за ${m0.slice(0, 7)}`, lines: [{ amount: '180000', cashFlowItemId: rentFlow, comment: 'Аренда' } as never] });
    await payOn(rent, d(5));
    if (!current) {
      const util = await createPayment(db, ctx, { type: 'bank_payment', operation: 'other_expense', bankAccountId: bank!.id, comment: 'Электроэнергия и вода', lines: [{ amount: String(r.int(28, 46) * 1000), cashFlowItemId: utilFlow, comment: 'Коммунальные услуги' } as never] });
      await payOn(util, d(25));
      const retail = await createPayment(db, ctx, { type: 'cash_receipt', operation: 'other_income', cashRegisterId: register!.id, comment: 'Выручка шоурума', lines: [{ amount: String(r.int(40, 95) * 1000), cashFlowItemId: retailFlow, comment: 'Розничные продажи' } as never] });
      await payOn(retail, d(28));
    }
  }

  return { cashRegisterId: register!.id, bankAccountId: bank!.id, documents: count, months };
}

function ean13(body12: string): string {
  const sum = body12.split('').reduce((s, ch, i) => s + Number(ch) * (i % 2 ? 3 : 1), 0);
  return body12 + ((10 - (sum % 10)) % 10);
}
