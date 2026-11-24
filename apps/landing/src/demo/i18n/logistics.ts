import type { Locale } from '../../i18n';

export type DelStatus = 'new' | 'assigned' | 'in_transit' | 'delivered';

export interface DelData {
  id: string;
  num: string;
  who: string;
  addr: string;
  contact: string;
  win: [string, string];
  kg: number;
  price: number;
  status: DelStatus;
  trip: 't0' | 't1' | null;
}

export interface VehicleData {
  id: string;
  plate: string;
  name: string;
  cap: number;
}

export interface LogisticsDict {
  crumbsDispatch: [string, string];
  crumbsList: [string, string];
  tripNum: string;
  otherTripNum: string;
  driver: string;
  otherDriver: string;
  kgUnit: string;
  statusLabels: Record<DelStatus, string>;
  tripStatus: { planned: string; in_transit: string };
  toasts: { added: string; created: (num: string) => string; statusChanged: string };
  stopsLabel: (count: number) => string;
  dispatchTitle: string;
  dispatchSubtitle: string;
  dateStr: string;
  todayBtn: string;
  autoAssignBtn: string;
  newTripBtn: string;
  unassignedHeader: (count: number) => string;
  vehiclesHeader: string;
  upToCap: (cap: string) => string;
  dropHereHint: string;
  freeAllDay: string;
  tripHeading: (num: string) => string;
  tripKindLabel: string;
  tripKindVal: string;
  dateLabel: string;
  vehicleLabel: string;
  driverLabel: string;
  stopsTitle: string;
  loadLabel: string;
  deliveryBadge: string;
  plannedBadge: string;
  printRoute: string;
  createWaybill: string;
  cancelTrip: string;
  dispatchBtn: string;
  saveBtn: string;
  listTitle: string;
  listSubtitle: string;
  listTabs: [string, string];
  filters: {
    from: string;
    to: string;
    courier: string;
    allCouriers: string;
    method: string;
    allMethods: string;
    status: string;
    allStatuses: string;
  };
  tableCols: [string, string, string, string, string, string];
  orderPrefix: string;
  unassignedDriver: string;
  vehicles: VehicleData[];
  initialDels: DelData[];
}

const del = (id: string, num: string, who: string, addr: string, contact: string, win: [string, string], kg: number, price: number, status: DelStatus = 'new', trip: DelData['trip'] = null): DelData => ({
  id, num, who, addr, contact, win, kg, price, status, trip,
});

export const LOGISTICS_DICT: Record<Locale, LogisticsDict> = {
  ru: {
    crumbsDispatch: ['Транспорт', 'Диспетчер'],
    crumbsList: ['Услуги', 'Доставки'],
    tripNum: 'РС-2026-00024',
    otherTripNum: 'РС-2026-00023',
    driver: 'Сафин Ринат',
    otherDriver: 'Ковалёв Дмитрий',
    kgUnit: 'кг',
    statusLabels: { new: 'Новая', assigned: 'Назначена', in_transit: 'В пути', delivered: 'Доставлена' },
    tripStatus: { planned: 'План', in_transit: 'В пути' },
    toasts: { added: 'Доставка добавлена в рейс', created: n => `Рейс ${n} создан`, statusChanged: 'Статус изменён' },
    stopsLabel: n => `точек: ${n}`,
    dispatchTitle: 'Диспетчер',
    dispatchSubtitle: 'Нераспределённые доставки, машины на день и таймлайн. Перетащите доставку на рейс или на машину.',
    dateStr: '05.11.2026',
    todayBtn: 'Сегодня',
    autoAssignBtn: 'Распределить',
    newTripBtn: 'Новый рейс',
    unassignedHeader: n => `Нераспределённые доставки · ${n}`,
    vehiclesHeader: 'Машины на день · 5 ноября',
    upToCap: c => `до ${c} кг`,
    dropHereHint: 'Бросьте доставку сюда, чтобы создать рейс',
    freeAllDay: 'Свободна весь день',
    tripHeading: n => `Рейс ${n}`,
    tripKindLabel: 'Вид рейса',
    tripKindVal: 'Городской',
    dateLabel: 'Дата',
    vehicleLabel: 'Машина',
    driverLabel: 'Водитель',
    stopsTitle: 'Точки рейса',
    loadLabel: 'Загрузка',
    deliveryBadge: 'Доставка',
    plannedBadge: 'В плане',
    printRoute: 'Печать маршрутного листа',
    createWaybill: 'Создать путевой лист',
    cancelTrip: 'Отменить рейс',
    dispatchBtn: 'Отправить',
    saveBtn: 'Сохранить',
    listTitle: 'Доставки',
    listSubtitle: 'Доставки по дням и курьерам: назначение курьеров, смена статусов, отчёт.',
    listTabs: ['Доставки', 'Отчёт'],
    filters: { from: 'С', to: 'По', courier: 'Курьер', allCouriers: 'Все курьеры', method: 'Способ', allMethods: 'Все способы', status: 'Статус', allStatuses: 'Все статусы' },
    tableCols: ['Время', 'Адрес', 'Документ', 'Курьер', 'Цена', 'Статус'],
    orderPrefix: 'Заказ ',
    unassignedDriver: 'Не назначен',
    vehicles: [
      { id: 'v1', plate: 'А 482 ВС 77', name: 'ГАЗель NEXT', cap: 1500 },
      { id: 'v2', plate: 'Е 117 ОК 50', name: 'Ford Transit', cap: 1100 },
      { id: 'v3', plate: 'М 905 РТ 77', name: 'Hyundai Porter', cap: 900 },
    ],
    initialDels: [
      del('d1', 'ЗК-000131', 'Петров Андрей', 'ул. Лесная, 14, кв. 52', 'Петров А. · +7 916 204-18-30', ['10:00', '12:00'], 86, 600),
      del('d2', 'ЗК-000132', 'ООО «Атлас Мебель»', 'Ленинградский пр-т, 37к2', 'Фролова Е. · +7 495 120-44-09', ['12:00', '14:00'], 240, 900),
      del('d3', 'ЗК-000134', 'Кузнецова Ольга', 'ул. Новочерёмушкинская, 21', 'Кузнецова О. · +7 903 551-02-76', ['14:00', '16:00'], 54, 450),
      del('d4', 'ЗК-000135', 'ИП Громов С. В.', 'Варшавское ш., 125Ж', 'Громов С. · +7 925 707-33-18', ['15:00', '18:00'], 310, 1200),
      del('d6', 'ЗК-000127', 'ООО «Северстрой»', 'Волгоградский пр-т, 32к5', 'Миронов Д. · +7 495 777-12-50', ['09:00', '11:00'], 420, 1200, 'in_transit', 't0'),
      del('d7', 'ЗК-000129', 'Орлова Анна', 'ул. Профсоюзная, 56', 'Орлова А. · +7 926 318-90-04', ['11:00', '13:00'], 95, 600, 'in_transit', 't0'),
    ],
  },
  en: {
    crumbsDispatch: ['Transport', 'Dispatch'],
    crumbsList: ['Services', 'Deliveries'],
    tripNum: 'TR-2026-00024',
    otherTripNum: 'TR-2026-00023',
    driver: 'Rinat Safin',
    otherDriver: 'Dmitry Kovalev',
    kgUnit: 'kg',
    statusLabels: { new: 'New', assigned: 'Assigned', in_transit: 'In transit', delivered: 'Delivered' },
    tripStatus: { planned: 'Planned', in_transit: 'In transit' },
    toasts: { added: 'Delivery added to trip', created: n => `Trip ${n} created`, statusChanged: 'Status updated' },
    stopsLabel: n => `stops: ${n}`,
    dispatchTitle: 'Dispatch',
    dispatchSubtitle: 'Unassigned deliveries, daily vehicles, and timeline. Drag a delivery onto a trip or vehicle.',
    dateStr: 'Nov 5, 2026',
    todayBtn: 'Today',
    autoAssignBtn: 'Auto-assign',
    newTripBtn: 'New trip',
    unassignedHeader: n => `Unassigned deliveries · ${n}`,
    vehiclesHeader: 'Daily vehicles · Nov 5',
    upToCap: c => `up to ${c} kg`,
    dropHereHint: 'Drop delivery here to create a trip',
    freeAllDay: 'Available all day',
    tripHeading: n => `Trip ${n}`,
    tripKindLabel: 'Trip type',
    tripKindVal: 'Local',
    dateLabel: 'Date',
    vehicleLabel: 'Vehicle',
    driverLabel: 'Driver',
    stopsTitle: 'Trip stops',
    loadLabel: 'Load',
    deliveryBadge: 'Delivery',
    plannedBadge: 'Planned',
    printRoute: 'Print route sheet',
    createWaybill: 'Create waybill',
    cancelTrip: 'Cancel trip',
    dispatchBtn: 'Dispatch',
    saveBtn: 'Save',
    listTitle: 'Deliveries',
    listSubtitle: 'Deliveries by day and driver: driver assignment, status updates, report.',
    listTabs: ['Deliveries', 'Report'],
    filters: { from: 'From', to: 'To', courier: 'Driver', allCouriers: 'All drivers', method: 'Method', allMethods: 'All methods', status: 'Status', allStatuses: 'All statuses' },
    tableCols: ['Time', 'Address', 'Document', 'Driver', 'Price', 'Status'],
    orderPrefix: 'Order ',
    unassignedDriver: 'Unassigned',
    vehicles: [
      { id: 'v1', plate: 'NY-482-BC', name: 'Ford E-Transit', cap: 1500 },
      { id: 'v2', plate: 'NY-117-OK', name: 'Mercedes Sprinter', cap: 1100 },
      { id: 'v3', plate: 'NY-905-RT', name: 'Isuzu NPR', cap: 900 },
    ],
    initialDels: [
      del('d1', 'ORD-000131', 'Andrew Miller', '14 Forest St, Apt 52', 'Miller A. · +1 415 204-1830', ['10:00', '12:00'], 86, 60),
      del('d2', 'ORD-000132', 'Atlas Furniture LLC', '372 Madison Ave, Ste 2', 'Frolova E. · +1 212 120-4409', ['12:00', '14:00'], 240, 90),
      del('d3', 'ORD-000134', 'Clara Evans', '21 Maplewood Dr', 'Evans C. · +1 646 551-0276', ['14:00', '16:00'], 54, 45),
      del('d4', 'ORD-000135', 'Gromov Studio', '125 Harbor Blvd', 'Gromov S. · +1 347 707-3318', ['15:00', '18:00'], 310, 120),
      del('d6', 'ORD-000127', 'NorthBuild LLC', '325 Queens Plaza', 'Mironov D. · +1 212 777-1250', ['09:00', '11:00'], 420, 120, 'in_transit', 't0'),
      del('d7', 'ORD-000129', 'Anna Brooks', '56 Oak Ridge Ave', 'Brooks A. · +1 917 318-9004', ['11:00', '13:00'], 95, 60, 'in_transit', 't0'),
    ],
  },
  es: {
    crumbsDispatch: ['Transporte', 'Despacho'],
    crumbsList: ['Servicios', 'Entregas'],
    tripNum: 'RT-2026-00024',
    otherTripNum: 'RT-2026-00023',
    driver: 'Rinat Safin',
    otherDriver: 'Diego Morales',
    kgUnit: 'kg',
    statusLabels: { new: 'Nueva', assigned: 'Asignada', in_transit: 'En camino', delivered: 'Entregada' },
    tripStatus: { planned: 'Planificada', in_transit: 'En camino' },
    toasts: { added: 'Entrega añadida a la ruta', created: n => `Ruta ${n} creada`, statusChanged: 'Estado actualizado' },
    stopsLabel: n => `paradas: ${n}`,
    dispatchTitle: 'Despacho',
    dispatchSubtitle: 'Entregas sin asignar, vehículos del día y cronograma. Arrastra una entrega a una ruta o vehículo.',
    dateStr: '05/11/2026',
    todayBtn: 'Hoy',
    autoAssignBtn: 'Asignar',
    newTripBtn: 'Nueva ruta',
    unassignedHeader: n => `Entregas sin asignar · ${n}`,
    vehiclesHeader: 'Vehículos del día · 5 nov',
    upToCap: c => `hasta ${c} kg`,
    dropHereHint: 'Suelta aquí para crear una ruta',
    freeAllDay: 'Disponible todo el día',
    tripHeading: n => `Ruta ${n}`,
    tripKindLabel: 'Tipo de ruta',
    tripKindVal: 'Urbana',
    dateLabel: 'Fecha',
    vehicleLabel: 'Vehículo',
    driverLabel: 'Conductor',
    stopsTitle: 'Paradas de la ruta',
    loadLabel: 'Carga',
    deliveryBadge: 'Entrega',
    plannedBadge: 'Planificada',
    printRoute: 'Imprimir hoja de ruta',
    createWaybill: 'Crear carta de porte',
    cancelTrip: 'Cancelar ruta',
    dispatchBtn: 'Enviar',
    saveBtn: 'Guardar',
    listTitle: 'Entregas',
    listSubtitle: 'Entregas por día y repartidor: asignación, estados e informe.',
    listTabs: ['Entregas', 'Informe'],
    filters: { from: 'Desde', to: 'Hasta', courier: 'Repartidor', allCouriers: 'Todos', method: 'Método', allMethods: 'Todos', status: 'Estado', allStatuses: 'Todos' },
    tableCols: ['Horario', 'Dirección', 'Documento', 'Repartidor', 'Precio', 'Estado'],
    orderPrefix: 'Pedido ',
    unassignedDriver: 'Sin asignar',
    vehicles: [
      { id: 'v1', plate: '4821 BCD', name: 'Renault Master', cap: 1500 },
      { id: 'v2', plate: '1174 FKL', name: 'Ford Transit', cap: 1100 },
      { id: 'v3', plate: '9052 MRT', name: 'Iveco Daily', cap: 900 },
    ],
    initialDels: [
      del('d1', 'PED-000131', 'Andrés Morales', 'C/ Bosque 14, 5º B', 'Morales A. · +34 616 204 183', ['10:00', '12:00'], 86, 55),
      del('d2', 'PED-000132', 'Atlas Muebles S.L.', 'Av. Diagonal 372', 'Frolova E. · +34 931 204 409', ['12:00', '14:00'], 240, 85),
      del('d3', 'PED-000134', 'Olga Navarro', 'C/ Mayor 21', 'Navarro O. · +34 603 551 027', ['14:00', '16:00'], 54, 40),
      del('d4', 'PED-000135', 'Estudio Vega', 'Paseo Marítimo 125', 'Vega S. · +34 625 707 331', ['15:00', '18:00'], 310, 110),
      del('d6', 'PED-000127', 'NorteObra S.L.', 'C/ Alcalá 325', 'Mirón D. · +34 917 771 250', ['09:00', '11:00'], 420, 110, 'in_transit', 't0'),
      del('d7', 'PED-000129', 'Ana Ruiz', 'Av. América 56', 'Ruiz A. · +34 626 318 900', ['11:00', '13:00'], 95, 55, 'in_transit', 't0'),
    ],
  },
};
