import type { Locale } from '../../i18n';

export type StageId = 'cut' | 'build' | 'paint';

export interface ProdRow {
  id: string;
  name: string;
  kind?: string;
  qty: number;
  done: number;
}

export interface ProdOrder {
  id: string;
  num: string;
  type: string;
  state: [string, string];
  who?: string;
  center: string;
  due: string;
  rows: ProdRow[];
}

export interface ProductionDict {
  crumbs: [string, string];
  title: string;
  subtitle: string;
  seg: [string, string];
  releaseBtn: string;
  releaseBtnCount: (n: number) => string;
  cols: { product: string; ordered: string; released: string; remaining: string };
  stages: [StageId, string][];
  checkAll: string;
  uncheckAll: string;
  doneState: string;
  toast: string;
  initialOrders: ProdOrder[];
}

export const PRODUCTION_DICT: Record<Locale, ProductionDict> = {
  ru: {
    crumbs: ['Производство', 'Выпуск продукции'],
    title: 'Выпуск продукции',
    subtitle: 'Заказы, ожидающие выпуска. Отметьте строки и этапы, выберите участок.',
    seg: ['Целиком', 'По количеству'],
    releaseBtn: 'Выпустить',
    releaseBtnCount: n => `Выпустить (${n})`,
    cols: { product: 'Продукция', ordered: 'Заказано', released: 'Выпущено', remaining: 'Остаток' },
    stages: [['cut', 'Раскрой'], ['build', 'Сборка'], ['paint', 'Покраска']],
    checkAll: 'Отметить все',
    uncheckAll: 'Снять все',
    doneState: 'Выполнен',
    toast: 'Создан выпуск продукции ВП-000087 · Цех №1',
    initialOrders: [
      {
        id: 'o1',
        num: 'ЗК-000118',
        type: 'Заказ покупателя',
        state: ['В работе', 'accent'],
        who: 'ООО «Атлас Мебель»',
        center: 'Цех №1',
        due: '06.11.2026',
        rows: [
          { id: 'r1', name: 'Стол обеденный «Дуб» 160×90', qty: 2, done: 0 },
          { id: 'r2', name: 'Стул «Классик»', kind: 'дуб, лак', qty: 8, done: 0 },
        ],
      },
      {
        id: 'o2',
        num: 'ПР-000052',
        type: 'Заказ на производство',
        state: ['Запланирован', 'amber'],
        center: 'Цех №2',
        due: '12.11.2026',
        rows: [{ id: 'r3', name: 'Шкаф-купе «Лофт» 2400', qty: 3, done: 1 }],
      },
    ],
  },
  en: {
    crumbs: ['Production', 'Production output'],
    title: 'Production output',
    subtitle: 'Orders awaiting output. Check lines and stages, then select a work center.',
    seg: ['Full', 'By quantity'],
    releaseBtn: 'Release',
    releaseBtnCount: n => `Release (${n})`,
    cols: { product: 'Product', ordered: 'Ordered', released: 'Output', remaining: 'Left' },
    stages: [['cut', 'Cutting'], ['build', 'Assembly'], ['paint', 'Finishing']],
    checkAll: 'Select all',
    uncheckAll: 'Clear all',
    doneState: 'Completed',
    toast: 'Production output PO-000087 created · Workshop #1',
    initialOrders: [
      {
        id: 'o1',
        num: 'SO-000118',
        type: 'Sales order',
        state: ['In progress', 'accent'],
        who: 'Atlas Furniture LLC',
        center: 'Workshop #1',
        due: 'Nov 6, 2026',
        rows: [
          { id: 'r1', name: 'Oak Dining Table 160×90', qty: 2, done: 0 },
          { id: 'r2', name: 'Classic Chair', kind: 'oak, lacquer', qty: 8, done: 0 },
        ],
      },
      {
        id: 'o2',
        num: 'MO-000052',
        type: 'Production order',
        state: ['Planned', 'amber'],
        center: 'Workshop #2',
        due: 'Nov 12, 2026',
        rows: [{ id: 'r3', name: 'Loft Sliding Wardrobe 2400', qty: 3, done: 1 }],
      },
    ],
  },
  es: {
    crumbs: ['Producción', 'Salida de producción'],
    title: 'Salida de producción',
    subtitle: 'Órdenes pendientes de salida. Marca líneas y etapas y elige el taller.',
    seg: ['Completo', 'Por cantidad'],
    releaseBtn: 'Registrar',
    releaseBtnCount: n => `Registrar (${n})`,
    cols: { product: 'Producto', ordered: 'Pedido', released: 'Producido', remaining: 'Restante' },
    stages: [['cut', 'Corte'], ['build', 'Montaje'], ['paint', 'Acabado']],
    checkAll: 'Marcar todo',
    uncheckAll: 'Desmarcar todo',
    doneState: 'Completada',
    toast: 'Salida de producción SP-000087 creada · Taller nº 1',
    initialOrders: [
      {
        id: 'o1',
        num: 'PV-000118',
        type: 'Pedido de cliente',
        state: ['En curso', 'accent'],
        who: 'Atlas Muebles S.L.',
        center: 'Taller nº 1',
        due: '06/11/2026',
        rows: [
          { id: 'r1', name: 'Mesa comedor «Roble» 160×90', qty: 2, done: 0 },
          { id: 'r2', name: 'Silla «Clásica»', kind: 'roble, barniz', qty: 8, done: 0 },
        ],
      },
      {
        id: 'o2',
        num: 'OP-000052',
        type: 'Orden de producción',
        state: ['Planificada', 'amber'],
        center: 'Taller nº 2',
        due: '12/11/2026',
        rows: [{ id: 'r3', name: 'Armario corredero «Loft» 2400', qty: 3, done: 1 }],
      },
    ],
  },
};
