import type { Locale } from '../../i18n';

export interface DocLineData {
  name: string;
  qty: number;
  price: number;
}

export interface DocDict {
  crumbsDraft: [string, string];
  crumbsPosted: [string, string];
  subCrumb: string;
  docTitlePrefix: string;
  docNumber: string;
  draftWord: string;
  statusPosted: string;
  statusDraft: string;
  savedNote: string;
  createFromBtn: string;
  printBtn: string;
  postBtn: string;
  unpostBtn: string;
  fields: {
    org: string;
    orgValue: string;
    buyer: string;
    buyerPlaceholder: string;
    priceType: string;
    priceTypeContractHint: string;
    priceWholesale: string;
    priceRetail: string;
    warehouse: string;
    warehouseValue: string;
    date: string;
    dateValue: string;
    number: string;
    numberHint: string;
    contract: string;
    contractSigned: string;
    contractPlaceholder: string;
    pricesMode: string;
    vatIncluded: string;
    vatExcluded: string;
  };
  tabs: [string, string, string];
  cols: {
    num: string;
    item: string;
    qty: string;
    price: string;
    vat: string;
    total: string;
  };
  itemSearchPlaceholder: string;
  addLineBtn: string;
  relatedHeading: string;
  relatedText: string;
  totals: {
    subtotal: string;
    vatLabel: string;
    vatRate: number;
    grandTotal: string;
  };
  buyers: string[];
  selectedBuyer: string;
  buyerQuery: string;
  items: string[];
  itemQuery: string;
  initialLine: DocLineData;
  addedLine: DocLineData;
  words: Record<number, string>;
}

export const DOC_DICT: Record<Locale, DocDict> = {
  ru: {
    crumbsDraft: ['Документы', 'Счёт покупателю (черновик)'],
    crumbsPosted: ['Документы', 'Счёт покупателю СЧ-000214'],
    subCrumb: 'Продажи / Счета покупателям',
    docTitlePrefix: 'Счёт покупателю',
    docNumber: 'СЧ-000214',
    draftWord: 'черновик',
    statusPosted: 'Проведён',
    statusDraft: 'Черновик',
    savedNote: 'Все изменения сохранены',
    createFromBtn: 'Создать на основании',
    printBtn: 'Печать',
    postBtn: 'Провести',
    unpostBtn: 'Отменить проведение',
    fields: {
      org: 'Организация',
      orgValue: 'ООО «Мебельная фабрика»',
      buyer: 'Покупатель',
      buyerPlaceholder: 'Поиск по названию или ИНН',
      priceType: 'Вид цен',
      priceTypeContractHint: 'По договору покупателя',
      priceWholesale: 'Оптовая',
      priceRetail: 'Розничная',
      warehouse: 'Склад',
      warehouseValue: 'Основной склад',
      date: 'Дата',
      dateValue: '29.10.2026',
      number: 'Номер',
      numberHint: 'Присваивается при проведении',
      contract: 'Договор',
      contractSigned: 'Договор поставки № 41',
      contractPlaceholder: 'Выберите договор',
      pricesMode: 'Цены',
      vatIncluded: 'НДС в сумме',
      vatExcluded: 'НДС сверху',
    },
    tabs: ['Товары и услуги', 'Оплата', 'Доставка'],
    cols: {
      num: '№',
      item: 'Товар или услуга',
      qty: 'Кол-во',
      price: 'Цена',
      vat: 'Сумма НДС',
      total: 'Всего',
    },
    itemSearchPlaceholder: 'Поиск по названию, артикулу или штрихкоду',
    addLineBtn: 'Добавить строку',
    relatedHeading: 'Связанные документы',
    relatedText: 'На основании: Заказ покупателя № 118',
    totals: {
      subtotal: 'Сумма без НДС',
      vatLabel: 'НДС 20%',
      vatRate: 20,
      grandTotal: 'Всего (с НДС)',
    },
    buyers: ['ООО «Атлас Мебель» · ИНН 7704 512 389', 'ООО «Атлант-Строй» · ИНН 5029 117 640'],
    selectedBuyer: 'ООО «Атлас Мебель»',
    buyerQuery: 'Атл',
    items: ['Стол обеденный «Дуб» 160×90 · 24 900 ₽', 'Стол журнальный «Дуб» · 11 400 ₽'],
    itemQuery: 'стол об',
    initialLine: { name: 'Стул обеденный «Классик»', qty: 4, price: 5900 },
    addedLine: { name: 'Стол обеденный «Дуб» 160×90', qty: 1, price: 24900 },
    words: {
      23600: 'Двадцать три тысячи шестьсот рублей 00 копеек',
      48500: 'Сорок восемь тысяч пятьсот рублей 00 копеек',
      73400: 'Семьдесят три тысячи четыреста рублей 00 копеек',
    },
  },
  en: {
    crumbsDraft: ['Sales docs', 'Customer invoice (draft)'],
    crumbsPosted: ['Sales docs', 'Customer invoice INV-000214'],
    subCrumb: 'Sales / Customer invoices',
    docTitlePrefix: 'Customer invoice',
    docNumber: 'INV-000214',
    draftWord: 'draft',
    statusPosted: 'Posted',
    statusDraft: 'Draft',
    savedNote: 'All changes saved',
    createFromBtn: 'Create from',
    printBtn: 'Print',
    postBtn: 'Post',
    unpostBtn: 'Unpost',
    fields: {
      org: 'Organization',
      orgValue: 'Furniture Factory LLC',
      buyer: 'Customer',
      buyerPlaceholder: 'Search by name or Tax ID',
      priceType: 'Price tier',
      priceTypeContractHint: 'Per customer contract',
      priceWholesale: 'Wholesale',
      priceRetail: 'Retail',
      warehouse: 'Warehouse',
      warehouseValue: 'Main warehouse',
      date: 'Date',
      dateValue: '10/29/2026',
      number: 'Number',
      numberHint: 'Assigned on posting',
      contract: 'Contract',
      contractSigned: 'Supply contract #41',
      contractPlaceholder: 'Select contract',
      pricesMode: 'Tax mode',
      vatIncluded: 'Tax included',
      vatExcluded: 'Tax excluded',
    },
    tabs: ['Items & services', 'Payment', 'Delivery'],
    cols: {
      num: '#',
      item: 'Item or service',
      qty: 'Qty',
      price: 'Price',
      vat: 'VAT',
      total: 'Total',
    },
    itemSearchPlaceholder: 'Search by name, SKU, or barcode',
    addLineBtn: 'Add line',
    relatedHeading: 'Related documents',
    relatedText: 'Based on: Sales order #118',
    totals: {
      subtotal: 'Subtotal',
      vatLabel: 'VAT 20%',
      vatRate: 20,
      grandTotal: 'Total (incl. VAT)',
    },
    buyers: ['Atlas Furniture LLC · Tax ID 84-2910482', 'Atlantic Build Co · Tax ID 51-9038127'],
    selectedBuyer: 'Atlas Furniture LLC',
    buyerQuery: 'Atl',
    items: ['Oak Dining Table 160×90 · $2,490', 'Oak Coffee Table · $1,140'],
    itemQuery: 'oak din',
    initialLine: { name: 'Classic Dining Chair', qty: 4, price: 590 },
    addedLine: { name: 'Oak Dining Table 160×90', qty: 1, price: 2490 },
    words: {
      2360: 'Two thousand three hundred sixty dollars and 00/100',
      4850: 'Four thousand eight hundred fifty dollars and 00/100',
      7340: 'Seven thousand three hundred forty dollars and 00/100',
    },
  },
  es: {
    crumbsDraft: ['Documentos', 'Factura de venta (borrador)'],
    crumbsPosted: ['Documentos', 'Factura de venta FV-000214'],
    subCrumb: 'Ventas / Facturas de clientes',
    docTitlePrefix: 'Factura de venta',
    docNumber: 'FV-000214',
    draftWord: 'borrador',
    statusPosted: 'Contabilizada',
    statusDraft: 'Borrador',
    savedNote: 'Todos los cambios guardados',
    createFromBtn: 'Crear a partir de',
    printBtn: 'Imprimir',
    postBtn: 'Contabilizar',
    unpostBtn: 'Anular',
    fields: {
      org: 'Empresa',
      orgValue: 'Fábrica de Muebles S.L.',
      buyer: 'Cliente',
      buyerPlaceholder: 'Buscar por nombre o NIF',
      priceType: 'Tarifa',
      priceTypeContractHint: 'Según contrato del cliente',
      priceWholesale: 'Mayorista',
      priceRetail: 'Minorista',
      warehouse: 'Almacén',
      warehouseValue: 'Almacén principal',
      date: 'Fecha',
      dateValue: '29/10/2026',
      number: 'Número',
      numberHint: 'Asignado al contabilizar',
      contract: 'Contrato',
      contractSigned: 'Contrato de suministro n.º 41',
      contractPlaceholder: 'Seleccionar contrato',
      pricesMode: 'Precios',
      vatIncluded: 'IVA incluido',
      vatExcluded: 'Más IVA',
    },
    tabs: ['Productos y servicios', 'Pago', 'Entrega'],
    cols: {
      num: 'N.º',
      item: 'Producto o servicio',
      qty: 'Cant.',
      price: 'Precio',
      vat: 'IVA',
      total: 'Total',
    },
    itemSearchPlaceholder: 'Buscar por nombre, SKU o código',
    addLineBtn: 'Añadir línea',
    relatedHeading: 'Documentos relacionados',
    relatedText: 'Basado en: Pedido de cliente n.º 118',
    totals: {
      subtotal: 'Base imponible',
      vatLabel: 'IVA 21%',
      vatRate: 21,
      grandTotal: 'Total (IVA incl.)',
    },
    buyers: ['Atlas Muebles S.L. · NIF B84291048', 'Atlántico Obra S.L. · NIF B51903812'],
    selectedBuyer: 'Atlas Muebles S.L.',
    buyerQuery: 'Atl',
    items: ['Mesa de comedor «Roble» 160×90 · 2490 €', 'Mesa de centro «Roble» · 1140 €'],
    itemQuery: 'mesa de c',
    initialLine: { name: 'Silla de comedor «Clásica»', qty: 4, price: 590 },
    addedLine: { name: 'Mesa de comedor «Roble» 160×90', qty: 1, price: 2490 },
    words: {
      2360: 'Dos mil trescientos sesenta euros con 00/100',
      4850: 'Cuatro mil ochocientos cincuenta euros con 00/100',
      7340: 'Siete mil trescientos cuarenta euros con 00/100',
    },
  },
};
