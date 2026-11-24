import type { Locale } from '../../i18n';

export type ApptSt = 'booked' | 'confirmed' | 'came';

export interface ApptData {
  id: string;
  col: number;
  at: number;
  len: number;
  name: string;
  svc: string;
  st: ApptSt;
}

export interface ServicesDict {
  crumbs: [string, string];
  title: string;
  subtitle: string;
  newBookingBtn: string;
  tabs: [string, string, string, string];
  date: string;
  todayBtn: string;
  cols: [string, string, string];
  status: Record<ApptSt, string>;
  initialAppts: ApptData[];
  newAppt: ApptData;
  modalNewTitle: string;
  clientLabel: string;
  clientPh: string;
  svcLabel: string;
  svcPh: string;
  priceLabel: string;
  bookingPrice: number;
  durationText: string;
  cancelBtn: string;
  bookBtn: string;
  cardPrice: number;
  cameBtn: string;
  noShowBtn: string;
  rescheduleBtn: string;
  cancelApptBtn: string;
}

export const SERVICES_DICT: Record<Locale, ServicesDict> = {
  ru: {
    crumbs: ['Услуги', 'Запись'],
    title: 'Запись',
    subtitle: 'Запись клиентов к специалистам: кто свободен, кто пришёл, закрытие дня.',
    newBookingBtn: 'Новая запись',
    tabs: ['День', 'Специалист', 'Незакрытые дни', 'Графики'],
    date: '30.10.2026',
    todayBtn: 'Сегодня',
    cols: ['Ковалёв Дмитрий', 'Орлова Анна', 'Сафин Ринат'],
    status: { booked: 'Записан', confirmed: 'Подтверждён', came: 'Пришёл' },
    initialAppts: [
      { id: 'a1', col: 0, at: 0, len: 2, name: 'Петров Андрей', svc: 'Замер кухни', st: 'came' },
      { id: 'a2', col: 0, at: 4, len: 3, name: 'Лебедева Ирина', svc: 'Сборка шкафа', st: 'confirmed' },
      { id: 'a3', col: 1, at: 1, len: 2, name: 'Громов Сергей', svc: 'Ремонт фасада', st: 'confirmed' },
      { id: 'a4', col: 1, at: 7, len: 2, name: 'Кузнецова Ольга', svc: 'Гарантийный осмотр', st: 'booked' },
      { id: 'a5', col: 2, at: 2, len: 4, name: 'ООО «Северстрой»', svc: 'Монтаж гардеробной', st: 'confirmed' },
    ],
    newAppt: { id: 'a6', col: 1, at: 4, len: 2, name: 'Соколова Мария', svc: 'Замер кухни', st: 'booked' },
    modalNewTitle: 'Новая запись',
    clientLabel: 'Клиент',
    clientPh: 'Имя или телефон',
    svcLabel: 'Услуга',
    svcPh: 'Выберите услугу',
    priceLabel: 'Цена',
    bookingPrice: 1500,
    durationText: '· 60 мин',
    cancelBtn: 'Отмена',
    bookBtn: 'Записать',
    cardPrice: 2400,
    cameBtn: 'Пришёл',
    noShowBtn: 'Не пришёл',
    rescheduleBtn: 'Перенести',
    cancelApptBtn: 'Отменить запись',
  },
  en: {
    crumbs: ['Services', 'Bookings'],
    title: 'Bookings',
    subtitle: 'Client bookings with specialists: availability, check-ins, and end-of-day closing.',
    newBookingBtn: 'New booking',
    tabs: ['Day', 'Specialist', 'Open days', 'Schedules'],
    date: 'Oct 30, 2026',
    todayBtn: 'Today',
    cols: ['Daniel Brooks', 'Anna Miller', 'Ryan Carter'],
    status: { booked: 'Booked', confirmed: 'Confirmed', came: 'Arrived' },
    initialAppts: [
      { id: 'a1', col: 0, at: 0, len: 2, name: 'Andrew Miller', svc: 'Kitchen measure', st: 'came' },
      { id: 'a2', col: 0, at: 4, len: 3, name: 'Irene Foster', svc: 'Wardrobe assembly', st: 'confirmed' },
      { id: 'a3', col: 1, at: 1, len: 2, name: 'Serge Gromov', svc: 'Front panel repair', st: 'confirmed' },
      { id: 'a4', col: 1, at: 7, len: 2, name: 'Olga Carter', svc: 'Warranty inspection', st: 'booked' },
      { id: 'a5', col: 2, at: 2, len: 4, name: 'NorthBuild LLC', svc: 'Closet installation', st: 'confirmed' },
    ],
    newAppt: { id: 'a6', col: 1, at: 4, len: 2, name: 'Maria Evans', svc: 'Kitchen measure', st: 'booked' },
    modalNewTitle: 'New booking',
    clientLabel: 'Client',
    clientPh: 'Name or phone',
    svcLabel: 'Service',
    svcPh: 'Select a service',
    priceLabel: 'Price',
    bookingPrice: 45,
    durationText: '· 60 min',
    cancelBtn: 'Cancel',
    bookBtn: 'Book',
    cardPrice: 75,
    cameBtn: 'Arrived',
    noShowBtn: 'No show',
    rescheduleBtn: 'Reschedule',
    cancelApptBtn: 'Cancel booking',
  },
  es: {
    crumbs: ['Servicios', 'Citas'],
    title: 'Citas',
    subtitle: 'Reservas de clientes con especialistas: disponibilidad, llegadas y cierre del día.',
    newBookingBtn: 'Nueva cita',
    tabs: ['Día', 'Especialista', 'Días abiertos', 'Horarios'],
    date: '30/10/2026',
    todayBtn: 'Hoy',
    cols: ['Daniel Morales', 'Ana Navarro', 'Mateo Vega'],
    status: { booked: 'Reservado', confirmed: 'Confirmado', came: 'Llegó' },
    initialAppts: [
      { id: 'a1', col: 0, at: 0, len: 2, name: 'Andrés Morales', svc: 'Medición de cocina', st: 'came' },
      { id: 'a2', col: 0, at: 4, len: 3, name: 'Irene Castro', svc: 'Montaje de armario', st: 'confirmed' },
      { id: 'a3', col: 1, at: 1, len: 2, name: 'Sergio Vega', svc: 'Reparación de frente', st: 'confirmed' },
      { id: 'a4', col: 1, at: 7, len: 2, name: 'Olga Navarro', svc: 'Revisión de garantía', st: 'booked' },
      { id: 'a5', col: 2, at: 2, len: 4, name: 'NorteObra S.L.', svc: 'Instalación de vestidor', st: 'confirmed' },
    ],
    newAppt: { id: 'a6', col: 1, at: 4, len: 2, name: 'María Ruiz', svc: 'Medición de cocina', st: 'booked' },
    modalNewTitle: 'Nueva cita',
    clientLabel: 'Cliente',
    clientPh: 'Nombre o teléfono',
    svcLabel: 'Servicio',
    svcPh: 'Selecciona un servicio',
    priceLabel: 'Precio',
    bookingPrice: 45,
    durationText: '· 60 min',
    cancelBtn: 'Cancelar',
    bookBtn: 'Reservar',
    cardPrice: 75,
    cameBtn: 'Llegó',
    noShowBtn: 'No asistió',
    rescheduleBtn: 'Reprogramar',
    cancelApptBtn: 'Cancelar cita',
  },
};
