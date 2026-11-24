import type { Locale } from '../../i18n';

export interface SalesLine {
  name: string;
  qty: number;
  price: number;
}

export interface JournalRow {
  num: string;
  date: string;
  who: string;
  total: number;
}

export interface SalesDict {
  buyer: string;
  buyerAv: string;
  buyerTag: string;
  org: string;
  warehouse: string;
  priceType: string;
  contract: string;
  orderDate: string;
  realDate: string;
  orderNum: string;
  realNum: string;
  lines: SalesLine[];
  words: string;
  journal: JournalRow[];
  crumbs: {
    sales: string;
    journal: string;
    order: string;
    realPosted: string;
    realDraft: string;
    settlements: string;
  };
  journalUi: {
    title: string;
    subtitle: string;
    tabs: [string, string, string, string];
    searchPh: string;
    filter: string;
    sort: string;
    cols: { num: string; date: string; buyer: string; payment: string; status: string; vat: string; total: string };
    unpaid: string;
    posted: string;
    total: string;
  };
  docUi: {
    orderTitle: string;
    realTitle: string;
    draftLower: string;
    postedBadge: string;
    draftBadge: string;
    postedAt: string;
    allSaved: string;
    movesBtn: string;
    printBtn: string;
    basedBtn: string;
    basedItems: [string, string, string];
    unpostBtn: string;
    postBtn: string;
    fields: { org: string; buyer: string; warehouse: string; date: string; number: string; numberHint: string; priceType: string; contract: string };
    tabs: [string, string, string];
    lineCols: { item: string; qty: string; price: string; vat: string; total: string };
    linkedTitle: string;
    noBased: string;
    noCreated: string;
    basedOn: string;
    subtotal: string;
    vatLabel: string;
    grandTotal: string;
  };
  cardUi: {
    tabs: [string, string, string, string];
    buyerHeading: string;
    balanceLabel: string;
    balanceHint: string;
    reconcileBtn: string;
    cols: { date: string; doc: string; charged: string; paid: string };
    opening: string;
    closing: string;
  };
  shipUi: { title: string; desc: string; dateLabel: string; datePh: string; keepBtn: string; createBtn: string };
  movesUi: { title: string; desc: string; cols: [string, string, string]; closeBtn: string };
}

export const SALES_DICT: Record<Locale, SalesDict> = {
  ru: {
    buyer: 'ООО «Атлас Мебель»',
    buyerAv: 'АМ',
    buyerTag: 'Мебель',
    org: 'ООО «Мебельная фабрика»',
    warehouse: 'Основной склад',
    priceType: 'Оптовая',
    contract: 'Договор поставки № 41',
    orderDate: '27.10.2026',
    realDate: '29.10.2026',
    orderNum: 'ЗК-000118',
    realNum: 'РТ-000063',
    lines: [
      { name: 'Стол обеденный «Дуб» 160×90', qty: 2, price: 24900 },
      { name: 'Стул «Классик»', qty: 8, price: 5900 },
      { name: 'Тумба под ТВ «Лофт»', qty: 1, price: 14500 },
    ],
    words: 'Сто одиннадцать тысяч пятьсот рублей 00 копеек',
    journal: [
      { num: 'ЗК-000118', date: '27.10.2026', who: 'ООО «Атлас Мебель»', total: 111500 },
      { num: 'ЗК-000117', date: '26.10.2026', who: 'ИП Громова Е. В.', total: 38400 },
      { num: 'ЗК-000116', date: '23.10.2026', who: 'ООО «Атлант-Строй»', total: 214900 },
      { num: 'ЗК-000115', date: '21.10.2026', who: 'ООО «Северный дом»', total: 67200 },
    ],
    crumbs: {
      sales: 'Продажи',
      journal: 'Заказы покупателей',
      order: 'Заказ покупателя ЗК-000118',
      realPosted: 'Реализация РТ-000063',
      realDraft: 'Реализация (черновик)',
      settlements: 'Взаиморасчёты',
    },
    journalUi: {
      title: 'Продажи',
      subtitle: 'КП, заказы покупателей, счета, отгрузки (УПД), акты услуг и возвраты.',
      tabs: ['Все типы', 'Заказ покупателя', 'Счёт на оплату', 'Реализация (УПД)'],
      searchPh: 'Поиск по покупателю',
      filter: 'Фильтр',
      sort: 'Сортировка: Дата',
      cols: { num: 'Номер', date: 'Дата', buyer: 'Покупатель', payment: 'Оплата', status: 'Статус', vat: 'НДС', total: 'Всего' },
      unpaid: 'Не оплачен',
      posted: 'Проведён',
      total: 'Итого',
    },
    docUi: {
      orderTitle: 'Заказ покупателя',
      realTitle: 'Реализация (УПД)',
      draftLower: 'черновик',
      postedBadge: 'Проведён',
      draftBadge: 'Черновик',
      postedAt: 'Проведён 29.10.2026',
      allSaved: 'Все изменения сохранены',
      movesBtn: 'Движения',
      printBtn: 'Печать',
      basedBtn: 'Создать на основании',
      basedItems: ['Счёт на оплату', 'Реализация (УПД)', 'Акт выполненных работ'],
      unpostBtn: 'Отменить проведение',
      postBtn: 'Провести',
      fields: { org: 'Организация', buyer: 'Покупатель', warehouse: 'Склад', date: 'Дата', number: 'Номер', numberHint: 'Присваивается при проведении', priceType: 'Вид цен', contract: 'Договор' },
      tabs: ['Товары и услуги', 'Оплата', 'Доставка'],
      lineCols: { item: 'Товар или услуга', qty: 'Кол-во', price: 'Цена', vat: 'Сумма НДС', total: 'Всего' },
      linkedTitle: 'Связанные документы',
      noBased: 'Не создан на основании другого документа',
      noCreated: 'Созданных документов пока нет.',
      basedOn: 'На основании ',
      subtotal: 'Сумма без НДС',
      vatLabel: 'НДС 20%',
      grandTotal: 'Всего (с НДС)',
    },
    cardUi: {
      tabs: ['Обзор', 'Договоры', 'Документы', 'Взаиморасчёты'],
      buyerHeading: 'Покупатель',
      balanceLabel: 'Сальдо:',
      balanceHint: 'Плюс — долг, минус — аванс',
      reconcileBtn: 'Акт сверки',
      cols: { date: 'Дата', doc: 'Документ', charged: 'Начислено', paid: 'Оплачено' },
      opening: 'Сальдо на начало',
      closing: 'Сальдо на конец',
    },
    shipUi: {
      title: 'Создать реализацию',
      desc: 'Можно выбрать дату: в реализацию попадут только строки заказа со сроком отгрузки не позже неё. Без даты берутся все строки.',
      dateLabel: 'Отгрузка по дату',
      datePh: 'Не выбрана',
      keepBtn: 'Оставить',
      createBtn: 'Создать',
    },
    movesUi: {
      title: 'Движения склада',
      desc: 'Движения, записанные проведённым документом.',
      cols: ['Склад', 'Товар', 'Количество'],
      closeBtn: 'Закрыть',
    },
  },
  en: {
    buyer: 'Atlas Furniture LLC',
    buyerAv: 'AF',
    buyerTag: 'Furniture',
    org: 'Furniture Factory LLC',
    warehouse: 'Main warehouse',
    priceType: 'Wholesale',
    contract: 'Supply agreement #41',
    orderDate: 'Oct 27, 2026',
    realDate: 'Oct 29, 2026',
    orderNum: 'SO-000118',
    realNum: 'SH-000063',
    lines: [
      { name: 'Oak Dining Table 160×90', qty: 2, price: 600 },
      { name: 'Classic Chair', qty: 8, price: 150 },
      { name: 'Loft TV Stand', qty: 1, price: 360 },
    ],
    words: 'Two thousand seven hundred sixty dollars 00 cents',
    journal: [
      { num: 'SO-000118', date: 'Oct 27, 2026', who: 'Atlas Furniture LLC', total: 2760 },
      { num: 'SO-000117', date: 'Oct 26, 2026', who: 'Gromova Studio', total: 1200 },
      { num: 'SO-000116', date: 'Oct 23, 2026', who: 'Atlant Build LLC', total: 6480 },
      { num: 'SO-000115', date: 'Oct 21, 2026', who: 'North Home LLC', total: 1980 },
    ],
    crumbs: {
      sales: 'Sales',
      journal: 'Sales orders',
      order: 'Sales order SO-000118',
      realPosted: 'Shipment SH-000063',
      realDraft: 'Shipment (draft)',
      settlements: 'Settlements',
    },
    journalUi: {
      title: 'Sales',
      subtitle: 'Quotes, sales orders, invoices, shipments, service acts, and returns.',
      tabs: ['All types', 'Sales order', 'Invoice', 'Shipment'],
      searchPh: 'Search by customer',
      filter: 'Filter',
      sort: 'Sort: Date',
      cols: { num: 'Number', date: 'Date', buyer: 'Customer', payment: 'Payment', status: 'Status', vat: 'VAT', total: 'Total' },
      unpaid: 'Unpaid',
      posted: 'Posted',
      total: 'Total',
    },
    docUi: {
      orderTitle: 'Sales order',
      realTitle: 'Shipment',
      draftLower: 'draft',
      postedBadge: 'Posted',
      draftBadge: 'Draft',
      postedAt: 'Posted Oct 29, 2026',
      allSaved: 'All changes saved',
      movesBtn: 'Movements',
      printBtn: 'Print',
      basedBtn: 'Create from',
      basedItems: ['Invoice', 'Shipment', 'Service completion act'],
      unpostBtn: 'Unpost',
      postBtn: 'Post',
      fields: { org: 'Company', buyer: 'Customer', warehouse: 'Warehouse', date: 'Date', number: 'Number', numberHint: 'Assigned on posting', priceType: 'Price list', contract: 'Contract' },
      tabs: ['Items & services', 'Payment', 'Delivery'],
      lineCols: { item: 'Item or service', qty: 'Qty', price: 'Price', vat: 'VAT amount', total: 'Total' },
      linkedTitle: 'Linked documents',
      noBased: 'Not created from another document',
      noCreated: 'No linked documents created yet.',
      basedOn: 'Based on ',
      subtotal: 'Subtotal (excl. VAT)',
      vatLabel: 'VAT 20%',
      grandTotal: 'Total (incl. VAT)',
    },
    cardUi: {
      tabs: ['Overview', 'Contracts', 'Documents', 'Settlements'],
      buyerHeading: 'Customer',
      balanceLabel: 'Balance:',
      balanceHint: 'Positive = receivable, negative = advance',
      reconcileBtn: 'Statement',
      cols: { date: 'Date', doc: 'Document', charged: 'Charged', paid: 'Paid' },
      opening: 'Opening balance',
      closing: 'Closing balance',
    },
    shipUi: {
      title: 'Create shipment',
      desc: 'Optional cutoff date: only order lines due on or before it are included. Leave empty to include all lines.',
      dateLabel: 'Ship up to date',
      datePh: 'Not selected',
      keepBtn: 'Cancel',
      createBtn: 'Create',
    },
    movesUi: {
      title: 'Stock movements',
      desc: 'Inventory movements recorded by the posted document.',
      cols: ['Warehouse', 'Item', 'Quantity'],
      closeBtn: 'Close',
    },
  },
  es: {
    buyer: 'Atlas Muebles S.L.',
    buyerAv: 'AM',
    buyerTag: 'Muebles',
    org: 'Fábrica de Muebles S.L.',
    warehouse: 'Almacén principal',
    priceType: 'Mayorista',
    contract: 'Contrato de suministro nº 41',
    orderDate: '27/10/2026',
    realDate: '29/10/2026',
    orderNum: 'PV-000118',
    realNum: 'AL-000063',
    lines: [
      { name: 'Mesa comedor «Roble» 160×90', qty: 2, price: 600 },
      { name: 'Silla «Clásica»', qty: 8, price: 150 },
      { name: 'Mueble TV «Loft»', qty: 1, price: 360 },
    ],
    words: 'Dos mil setecientos sesenta euros con 00 céntimos',
    journal: [
      { num: 'PV-000118', date: '27/10/2026', who: 'Atlas Muebles S.L.', total: 2760 },
      { num: 'PV-000117', date: '26/10/2026', who: 'Estudio Vega', total: 1200 },
      { num: 'PV-000116', date: '23/10/2026', who: 'Atlant Obra S.L.', total: 6480 },
      { num: 'PV-000115', date: '21/10/2026', who: 'Casa Norte S.L.', total: 1980 },
    ],
    crumbs: {
      sales: 'Ventas',
      journal: 'Pedidos de clientes',
      order: 'Pedido de cliente PV-000118',
      realPosted: 'Albarán AL-000063',
      realDraft: 'Albarán (borrador)',
      settlements: 'Liquidaciones',
    },
    journalUi: {
      title: 'Ventas',
      subtitle: 'Presupuestos, pedidos de clientes, facturas, albaranes, actas y devoluciones.',
      tabs: ['Todos', 'Pedido de cliente', 'Factura', 'Albarán'],
      searchPh: 'Buscar por cliente',
      filter: 'Filtro',
      sort: 'Orden: Fecha',
      cols: { num: 'Número', date: 'Fecha', buyer: 'Cliente', payment: 'Pago', status: 'Estado', vat: 'IVA', total: 'Total' },
      unpaid: 'Impago',
      posted: 'Contabilizado',
      total: 'Total',
    },
    docUi: {
      orderTitle: 'Pedido de cliente',
      realTitle: 'Albarán',
      draftLower: 'borrador',
      postedBadge: 'Contabilizado',
      draftBadge: 'Borrador',
      postedAt: 'Contabilizado 29/10/2026',
      allSaved: 'Todos los cambios guardados',
      movesBtn: 'Movimientos',
      printBtn: 'Imprimir',
      basedBtn: 'Crear desde',
      basedItems: ['Factura', 'Albarán', 'Acta de servicios'],
      unpostBtn: 'Anular',
      postBtn: 'Contabilizar',
      fields: { org: 'Empresa', buyer: 'Cliente', warehouse: 'Almacén', date: 'Fecha', number: 'Número', numberHint: 'Se asigna al contabilizar', priceType: 'Tarifa', contract: 'Contrato' },
      tabs: ['Productos y servicios', 'Pago', 'Envío'],
      lineCols: { item: 'Producto o servicio', qty: 'Cant.', price: 'Precio', vat: 'Importe IVA', total: 'Total' },
      linkedTitle: 'Documentos vinculados',
      noBased: 'No creado a partir de otro documento',
      noCreated: 'Aún no hay documentos creados.',
      basedOn: 'Basado en ',
      subtotal: 'Base imponible',
      vatLabel: 'IVA 20%',
      grandTotal: 'Total (con IVA)',
    },
    cardUi: {
      tabs: ['Resumen', 'Contratos', 'Documentos', 'Liquidaciones'],
      buyerHeading: 'Cliente',
      balanceLabel: 'Saldo:',
      balanceHint: 'Positivo = deuda, negativo = anticipo',
      reconcileBtn: 'Estado de cuenta',
      cols: { date: 'Fecha', doc: 'Documento', charged: 'Cargo', paid: 'Pagado' },
      opening: 'Saldo inicial',
      closing: 'Saldo final',
    },
    shipUi: {
      title: 'Crear albarán',
      desc: 'Puedes elegir una fecha límite: solo se incluirán las líneas con entrega hasta esa fecha. Sin fecha se incluyen todas.',
      dateLabel: 'Enviar hasta fecha',
      datePh: 'Sin seleccionar',
      keepBtn: 'Cancelar',
      createBtn: 'Crear',
    },
    movesUi: {
      title: 'Movimientos de almacén',
      desc: 'Movimientos registrados por el documento contabilizado.',
      cols: ['Almacén', 'Artículo', 'Cantidad'],
      closeBtn: 'Cerrar',
    },
  },
};
