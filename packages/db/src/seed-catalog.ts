/* Демо каталога и производства для демо-воркспейса: дерево категорий с характеристиками, ~20 товаров и 3 услуги,
   2 участка, 2 изделия со спецификацией в 2–3 уровня (стол с полуфабрикатами «столешница» и «подстолье»).
   Названия товаров — данные (на русском), интерфейс остаётся английским. */
import type { Db } from './client';
import { registerBaseUnits } from './catalog';
import { bomLines, attributeDefs, manufacturedItems, productCategories, products, workCenters } from './schema';
import { uuidv7 } from './uuid';

/** EAN-13 с контрольной цифрой из 12 цифр */
function ean13(body12: string): string {
  const sum = [...body12].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return body12 + String((10 - (sum % 10)) % 10);
}

const choice = (value: string, color = 'gray') => ({ value, label: value, color });

export async function seedCatalog(db: Db, wsId: string) {
  await registerBaseUnits(db, wsId);

  /* ---------- категории и характеристики ---------- */
  const cat = (name: string, parent: { id: string; path: string } | null, sortOrder: number) => {
    const id = uuidv7();
    return { id, path: parent ? `${parent.path}/${id}` : id, parentId: parent?.id ?? null, name, sortOrder, workspaceId: wsId };
  };
  const furniture = cat('Мебель', null, 0);
  const tables = cat('Столы', furniture, 0);
  const hardware = cat('Фурнитура', furniture, 1);
  const materials = cat('Материалы', furniture, 2);
  const services = cat('Услуги', null, 1);
  for (const c of [furniture, tables, hardware, materials, services]) await db.insert(productCategories).values(c);

  const attr = (categoryId: string, order: number, a: { key: string; name: string; type: string; required?: boolean; unit?: string; options?: Record<string, unknown> }) => ({
    workspaceId: wsId,
    categoryId,
    sortOrder: order,
    key: a.key,
    name: a.name,
    type: a.type,
    required: a.required ?? false,
    unit: a.unit ?? '',
    options: (a.options ?? {}) as never,
  });
  await db.insert(attributeDefs).values([
    attr(furniture.id, 0, { key: 'brand', name: 'Brand', type: 'text' }),
    attr(furniture.id, 1, { key: 'color', name: 'Color', type: 'select', options: { choices: [choice('Натуральный', 'amber'), choice('Белый'), choice('Чёрный', 'violet'), choice('Графит', 'indigo')] } }),
    attr(tables.id, 0, { key: 'width', name: 'Width', type: 'number', required: true, unit: 'мм', options: { min: 100, max: 5000 } }),
    attr(tables.id, 1, { key: 'depth', name: 'Depth', type: 'number', unit: 'мм', options: { min: 100, max: 3000 } }),
    attr(tables.id, 2, { key: 'height', name: 'Height', type: 'number', unit: 'мм', options: { min: 100, max: 1500 } }),
    attr(tables.id, 3, { key: 'top_material', name: 'Top material', type: 'select', options: { choices: [choice('Дуб', 'amber'), choice('МДФ', 'teal'), choice('ЛДСП', 'blue')] } }),
    attr(hardware.id, 0, { key: 'fastener_type', name: 'Type', type: 'select', required: true, options: { choices: [choice('Саморез', 'blue'), choice('Болт', 'indigo'), choice('Стяжка', 'violet'), choice('Опора', 'teal'), choice('Полкодержатель', 'green')] } }),
    attr(hardware.id, 1, { key: 'size', name: 'Size', type: 'text' }),
    attr(materials.id, 0, { key: 'thickness', name: 'Thickness', type: 'number', unit: 'мм', options: { min: 0, max: 200 } }),
    attr(materials.id, 1, { key: 'species', name: 'Material', type: 'select', options: { choices: [choice('Дуб', 'amber'), choice('Берёза', 'green'), choice('МДФ', 'teal'), choice('Химия', 'rose')] } }),
  ]);

  /* ---------- товары и услуги ---------- */
  let seq = 0;
  const barcode = () => ean13(`46000000${String(++seq).padStart(4, '0')}`);
  const ids: Record<string, string> = {};
  const goods = async (key: string, p: { name: string; sku: string; category: string; unit?: string; price: number; purchase: number; vat?: string; attrs?: Record<string, unknown>; active?: boolean }) => {
    const id = (ids[key] = uuidv7());
    await db.insert(products).values({
      id,
      workspaceId: wsId,
      kind: 'goods',
      sku: p.sku,
      name: p.name,
      barcode: barcode(),
      unitCode: p.unit ?? '796',
      vatRate: p.vat ?? '20',
      price: p.price.toFixed(2),
      purchasePrice: p.purchase.toFixed(2),
      categoryId: p.category,
      attrs: p.attrs ?? {},
      isActive: p.active ?? true,
    });
  };

  // Готовая продукция (изготавливается по спецификациям ниже)
  await goods('tableNord', { name: 'Стол обеденный «Норд»', sku: 'TBL-001', category: tables.id, price: 38900, purchase: 0, attrs: { brand: 'Gr8r Home', color: 'Натуральный', width: 1400, depth: 800, height: 750, top_material: 'Дуб' } });
  await goods('tableOffice', { name: 'Стол письменный «Офис»', sku: 'TBL-002', category: tables.id, price: 17900, purchase: 0, attrs: { brand: 'Gr8r Home', color: 'Белый', width: 1200, depth: 600, height: 740, top_material: 'МДФ' } });
  await goods('tableLoft', { name: 'Стол журнальный «Лофт» (закупной)', sku: 'TBL-003', category: tables.id, price: 12500, purchase: 7300, attrs: { brand: 'Loft&Co', color: 'Графит', width: 900, depth: 500, height: 420, top_material: 'ЛДСП' }, active: false });

  // Готовая мебель, купленная для перепродажи
  await goods('chair', { name: 'Стул обеденный «Классик»', sku: 'FRN-001', category: furniture.id, price: 5900, purchase: 3200, attrs: { brand: 'Loft&Co', color: 'Чёрный' } });
  await goods('stool', { name: 'Табурет «Мини»', sku: 'FRN-002', category: furniture.id, price: 2400, purchase: 1300, attrs: { brand: 'Loft&Co', color: 'Белый' } });

  // Фурнитура
  await goods('screw', { name: 'Саморез 4×40 (шт)', sku: 'HW-SCR-440', category: hardware.id, price: 4, purchase: 1.5, attrs: { fastener_type: 'Саморез', size: '4×40' } });
  await goods('bolt', { name: 'Болт мебельный М6×60', sku: 'HW-BLT-660', category: hardware.id, price: 18, purchase: 9, attrs: { fastener_type: 'Болт', size: 'М6×60' } });
  await goods('cam', { name: 'Эксцентриковая стяжка 15 мм', sku: 'HW-CAM-15', category: hardware.id, price: 22, purchase: 11, attrs: { fastener_type: 'Стяжка', size: '15 мм' } });
  await goods('foot', { name: 'Опора регулируемая 60–80 мм', sku: 'HW-FT-60', category: hardware.id, price: 140, purchase: 85, attrs: { fastener_type: 'Опора', size: '60–80 мм' } });
  await goods('shelfPin', { name: 'Полкодержатель 5 мм', sku: 'HW-SHP-5', category: hardware.id, price: 6, purchase: 2.5, attrs: { fastener_type: 'Полкодержатель', size: '5 мм' } });

  // Материалы
  await goods('oakBeam', { name: 'Брус дубовый 50×50', sku: 'MT-OAK-5050', category: materials.id, unit: '006', price: 620, purchase: 380, attrs: { thickness: 50, species: 'Дуб' } });
  await goods('oakBoard', { name: 'Доска дубовая 30 мм (м²)', sku: 'MT-OAK-30', category: materials.id, unit: '055', price: 6900, purchase: 4200, attrs: { thickness: 30, species: 'Дуб' } });
  await goods('plywood', { name: 'Фанера берёзовая 18 мм', sku: 'MT-PLY-18', category: materials.id, unit: '625', price: 2900, purchase: 1850, attrs: { thickness: 18, species: 'Берёза' } });
  await goods('mdf', { name: 'МДФ 16 мм, лист 2800×2070', sku: 'MT-MDF-16', category: materials.id, unit: '625', price: 3600, purchase: 2300, attrs: { thickness: 16, species: 'МДФ' } });
  await goods('edge', { name: 'Кромка ПВХ 2 мм', sku: 'MT-EDG-2', category: materials.id, unit: '006', price: 38, purchase: 21, attrs: { thickness: 2 } });
  await goods('lacquer', { name: 'Лак матовый полиуретановый', sku: 'MT-LAC-1', category: materials.id, unit: '112', price: 1450, purchase: 900, attrs: { species: 'Химия' } });
  await goods('stain', { name: 'Морилка водная, дуб', sku: 'MT-STN-1', category: materials.id, unit: '112', price: 780, purchase: 450, attrs: { species: 'Химия' } });
  await goods('glue', { name: 'Клей ПВА столярный', sku: 'MT-GLU-1', category: materials.id, unit: '166', price: 310, purchase: 180, attrs: { species: 'Химия' } });
  await goods('sandpaper', { name: 'Шлифшкурка P120, лист', sku: 'MT-SND-120', category: materials.id, unit: '625', price: 45, purchase: 24 });
  await goods('packaging', { name: 'Упаковка картон + плёнка', sku: 'MT-PKG-1', category: materials.id, price: 420, purchase: 260 });

  // Услуги
  const service = async (name: string, sku: string, unit: string, price: number, vat = '20') =>
    db.insert(products).values({ workspaceId: wsId, kind: 'service', sku, name, unitCode: unit, vatRate: vat, price: price.toFixed(2), purchasePrice: '0', categoryId: services.id });
  await service('Доставка по городу', 'SV-DLV', '876', 1500);
  await service('Сборка мебели на месте', 'SV-ASM', '356', 1800);
  await service('Замер и консультация', 'SV-MSR', '876', 0, 'none');

  /* ---------- участки ---------- */
  const carpentry = uuidv7();
  const assembly = uuidv7();
  await db.insert(workCenters).values([
    { id: carpentry, workspaceId: wsId, code: 'WS-1', name: 'Столярный цех', hourlyRate: '650.00', note: 'Распил, склейка, шлифовка, покрытие' },
    { id: assembly, workspaceId: wsId, code: 'WS-2', name: 'Сборочный участок', hourlyRate: '450.00', note: 'Сборка и упаковка' },
  ]);

  /* ---------- продукция и спецификации ---------- */
  const item = async (key: string, i: { name: string; code: string; kind: 'product' | 'semi'; productId?: string; batchQty?: number; overheadPct: number }) => {
    ids[key] = uuidv7();
    await db.insert(manufacturedItems).values({ id: ids[key], workspaceId: wsId, code: i.code, name: i.name, kind: i.kind, unitCode: '796', productId: i.productId ?? null, batchQty: String(i.batchQty ?? 1), overheadPct: String(i.overheadPct) });
  };
  type Line = { kind: 'material'; product: string; qty: number; scrap?: number } | { kind: 'semi'; item: string; qty: number } | { kind: 'work'; op: string; center?: string; hours?: number; rate?: number; fixed?: number };
  const bom = async (itemKey: string, lines: Line[]) => {
    await db.insert(bomLines).values(
      lines.map((l, i) => {
        const base = { workspaceId: wsId, itemId: ids[itemKey]!, kind: l.kind, sortOrder: i };
        if (l.kind === 'material') {
          const unit = ({ oakBeam: '006', oakBoard: '055', plywood: '625', mdf: '625', edge: '006', lacquer: '112', stain: '112', glue: '166', sandpaper: '625' } as Record<string, string>)[l.product] ?? '796';
          return { ...base, productId: ids[l.product]!, qty: String(l.qty), unitCode: unit, scrapPct: String(l.scrap ?? 0) };
        }
        if (l.kind === 'semi') return { ...base, childItemId: ids[l.item]!, qty: String(l.qty), unitCode: '796', semiMode: 'stock' as const };
        return { ...base, operation: l.op, workCenterId: l.center === 'assembly' ? assembly : carpentry, hours: String(l.hours ?? 0), rate: l.rate !== undefined ? l.rate.toFixed(2) : null, fixedCost: l.fixed !== undefined ? l.fixed.toFixed(2) : null, qty: '1' };
      }),
    );
  };

  // Нижний уровень: царга в сборе (полуфабрикат)
  await item('rail', { name: 'Царга в сборе', code: 'SEMI-RAIL', kind: 'semi', overheadPct: 10 });
  await bom('rail', [
    { kind: 'material', product: 'oakBeam', qty: 2.2, scrap: 8 },
    { kind: 'material', product: 'bolt', qty: 4 },
    { kind: 'material', product: 'glue', qty: 0.05 },
    { kind: 'work', op: 'Фрезеровка и сверление', center: 'carpentry', hours: 0.5 },
  ]);
  // Средний уровень: подстолье (две царги + ножки)
  await item('base', { name: 'Подстолье дубовое', code: 'SEMI-BASE', kind: 'semi', overheadPct: 10 });
  await bom('base', [
    { kind: 'semi', item: 'rail', qty: 2 },
    { kind: 'material', product: 'oakBeam', qty: 3.2, scrap: 8 },
    { kind: 'material', product: 'stain', qty: 0.4 },
    { kind: 'work', op: 'Сборка подстолья', center: 'carpentry', hours: 1 },
  ]);
  // Столешница: партия 2 шт
  await item('top', { name: 'Столешница дубовая 1400×800', code: 'SEMI-TOP', kind: 'semi', batchQty: 2, overheadPct: 15 });
  await bom('top', [
    { kind: 'material', product: 'oakBoard', qty: 2.24, scrap: 12 },
    { kind: 'material', product: 'lacquer', qty: 0.6 },
    { kind: 'material', product: 'sandpaper', qty: 4 },
    { kind: 'work', op: 'Распил и склейка щита', center: 'carpentry', hours: 3 },
    { kind: 'work', op: 'Шлифовка и покрытие', center: 'carpentry', hours: 2 },
  ]);
  // Изделие 1: обеденный стол (3 уровня: стол → подстолье → царга)
  await item('dining', { name: 'Стол обеденный «Норд»', code: 'FG-NORD', kind: 'product', productId: ids.tableNord, overheadPct: 12 });
  await bom('dining', [
    { kind: 'semi', item: 'top', qty: 1 },
    { kind: 'semi', item: 'base', qty: 1 },
    { kind: 'material', product: 'foot', qty: 4 },
    { kind: 'material', product: 'cam', qty: 8 },
    { kind: 'material', product: 'screw', qty: 16 },
    { kind: 'material', product: 'packaging', qty: 1 },
    { kind: 'work', op: 'Финишная сборка', center: 'assembly', hours: 1 },
    { kind: 'work', op: 'Упаковка', center: 'assembly', fixed: 300 },
  ]);
  // Полуфабрикат и изделие 2: письменный стол (2 уровня)
  await item('officeTop', { name: 'Столешница МДФ 1200×600', code: 'SEMI-OTOP', kind: 'semi', overheadPct: 8 });
  await bom('officeTop', [
    { kind: 'material', product: 'mdf', qty: 0.5, scrap: 10 },
    { kind: 'material', product: 'edge', qty: 3.6, scrap: 5 },
    { kind: 'work', op: 'Раскрой и кромление', center: 'carpentry', hours: 0.8 },
  ]);
  await item('desk', { name: 'Стол письменный «Офис»', code: 'FG-OFFICE', kind: 'product', productId: ids.tableOffice, overheadPct: 10 });
  await bom('desk', [
    { kind: 'semi', item: 'officeTop', qty: 1 },
    { kind: 'material', product: 'foot', qty: 4 },
    { kind: 'material', product: 'plywood', qty: 0.25, scrap: 10 },
    { kind: 'material', product: 'screw', qty: 12 },
    { kind: 'work', op: 'Сборка', center: 'assembly', hours: 0.7 },
  ]);

  return { products: 20, services: 3 };
}
