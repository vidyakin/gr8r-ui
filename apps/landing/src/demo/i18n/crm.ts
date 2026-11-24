import type { Locale } from '../../i18n';

export type CrmStage = 'new' | 'qual' | 'kp' | 'won';

export interface DealData {
  id: string;
  title: string;
  co: string;
  c: string;
  sum: number;
  due: string;
  av: [string, string];
}

export interface ChannelRow {
  name: string;
  c: string;
  exp: number;
  leads: number;
  conv: number;
  rev: number;
  hot?: boolean;
}

export interface CrmDict {
  crumbsBoard: [string, string];
  crumbsReport: [string, string];
  dealsTitle: string;
  openDeals: (count: number, total: string) => string;
  channelReportBtn: string;
  newDealBtn: string;
  weighted: (pct: number) => string;
  stages: [CrmStage, string, number, 'backlog' | 'todo' | 'progress' | 'review' | 'done'][];
  initialDeals: Record<CrmStage, DealData[]>;
  wonSum: number;
  adsTitle: string;
  reportTabs: [string, string];
  periodFilter: string;
  breakdownFilter: string;
  cols: [string, string, string, string, string, string, string];
  wasPrefix: string;
  total: string;
  rows: ChannelRow[];
}

const d = (id: string, title: string, co: string, c: string, sum: number, due: string, av: [string, string]): DealData => ({ id, title, co, c, sum, due, av });

export const CRM_DICT: Record<Locale, CrmDict> = {
  ru: {
    crumbsBoard: ['CRM', 'Сделки'],
    crumbsReport: ['CRM', 'Реклама'],
    dealsTitle: 'Сделки',
    openDeals: (n, sum) => `${n} открытых сделок · ${sum} в воронке`,
    channelReportBtn: 'Отчёт по каналам',
    newDealBtn: 'Новая сделка',
    weighted: p => `Взвешено · ${p}%`,
    stages: [['new', 'Новая', 10, 'todo'], ['qual', 'Квалификация', 25, 'progress'], ['kp', 'КП отправлено', 60, 'review'], ['won', 'Выиграна', 100, 'done']],
    initialDeals: {
      new: [d('d1', 'Шкаф-купе, ул. Ленина', 'Иванова Елена', 'rose', 84000, '12 нояб.', ['АК', '#5A67D8'])],
      qual: [d('d2', 'Гардеробная «Лофт»', 'ООО «Северстрой»', 'teal', 236000, '19 нояб.', ['МЛ', '#8662C9']), d('d3', 'Мебель для офиса', 'ИП Громов', 'orange', 410000, '2 дек.', ['АК', '#5A67D8'])],
      kp: [d('d4', 'Кухня, ЖК Северный', 'Петров Андрей', 'blue', 318000, '5 нояб.', ['ЕС', '#23918A']), d('d5', 'Прихожая', 'Смирнова Ольга', 'violet', 96000, '9 нояб.', ['МЛ', '#8662C9'])],
      won: [d('d6', 'Детская', 'Семья Кузнецовых', 'green', 152000, '24 окт.', ['ЕС', '#23918A'])],
    },
    wonSum: 318000,
    adsTitle: 'Реклама',
    reportTabs: ['Отчёт по каналам', 'Кампании'],
    periodFilter: 'Период: октябрь 2026',
    breakdownFilter: 'Разрез: источник',
    cols: ['Источник', 'Расход', 'Лиды', 'Конверсия', 'CPL', 'Выручка', 'ROMI'],
    wasPrefix: 'было',
    total: 'Итого',
    rows: [
      { name: 'Яндекс Директ', c: 'var(--red)', exp: 120000, leads: 46, conv: 15, rev: 730000, hot: true },
      { name: 'Авито', c: 'var(--green)', exp: 45000, leads: 31, conv: 10, rev: 152000 },
      { name: 'Рекомендации', c: 'var(--violet)', exp: 0, leads: 12, conv: 42, rev: 520000 },
    ],
  },
  en: {
    crumbsBoard: ['CRM', 'Deals'],
    crumbsReport: ['CRM', 'Marketing'],
    dealsTitle: 'Deals',
    openDeals: (n, sum) => `${n} open deals · ${sum} in pipeline`,
    channelReportBtn: 'Channel report',
    newDealBtn: 'New deal',
    weighted: p => `Weighted · ${p}%`,
    stages: [['new', 'New', 10, 'todo'], ['qual', 'Qualification', 25, 'progress'], ['kp', 'Proposal sent', 60, 'review'], ['won', 'Won', 100, 'done']],
    initialDeals: {
      new: [d('d1', 'Sliding wardrobe, Oak St', 'Elena Brooks', 'rose', 8400, 'Nov 12', ['AK', '#5A67D8'])],
      qual: [d('d2', 'Loft walk-in closet', 'NorthBuild LLC', 'teal', 23600, 'Nov 19', ['ML', '#8662C9']), d('d3', 'Office furniture set', 'Gromov Studio', 'orange', 41000, 'Dec 2', ['AK', '#5A67D8'])],
      kp: [d('d4', 'Kitchen, North Park', 'Andrew Miller', 'blue', 31800, 'Nov 5', ['ES', '#23918A']), d('d5', 'Entryway storage', 'Clara Evans', 'violet', 9600, 'Nov 9', ['ML', '#8662C9'])],
      won: [d('d6', 'Kids room set', 'Carter Family', 'green', 15200, 'Oct 24', ['ES', '#23918A'])],
    },
    wonSum: 31800,
    adsTitle: 'Marketing',
    reportTabs: ['Channel report', 'Campaigns'],
    periodFilter: 'Period: Oct 2026',
    breakdownFilter: 'Group by: source',
    cols: ['Source', 'Spend', 'Leads', 'Conv.', 'CPL', 'Revenue', 'ROMI'],
    wasPrefix: 'was',
    total: 'Total',
    rows: [
      { name: 'Google Ads', c: 'var(--red)', exp: 12000, leads: 46, conv: 15, rev: 73000, hot: true },
      { name: 'Meta Ads', c: 'var(--green)', exp: 4500, leads: 31, conv: 10, rev: 15200 },
      { name: 'Referrals', c: 'var(--violet)', exp: 0, leads: 12, conv: 42, rev: 52000 },
    ],
  },
  es: {
    crumbsBoard: ['CRM', 'Tratos'],
    crumbsReport: ['CRM', 'Publicidad'],
    dealsTitle: 'Tratos',
    openDeals: (n, sum) => `${n} tratos abiertos · ${sum} en embudo`,
    channelReportBtn: 'Informe por canal',
    newDealBtn: 'Nuevo trato',
    weighted: p => `Ponderado · ${p}%`,
    stages: [['new', 'Nuevo', 10, 'todo'], ['qual', 'Calificación', 25, 'progress'], ['kp', 'Propuesta enviada', 60, 'review'], ['won', 'Ganado', 100, 'done']],
    initialDeals: {
      new: [d('d1', 'Armario empotrado, C/ Mayor', 'Elena Ruiz', 'rose', 8400, '12 nov', ['AC', '#5A67D8'])],
      qual: [d('d2', 'Vestidor «Loft»', 'NorteObra S.L.', 'teal', 23600, '19 nov', ['ML', '#8662C9']), d('d3', 'Mobiliario de oficina', 'Estudio Vega', 'orange', 41000, '2 dic', ['AC', '#5A67D8'])],
      kp: [d('d4', 'Cocina, Res. Norte', 'Andrés Morales', 'blue', 31800, '5 nov', ['ES', '#23918A']), d('d5', 'Recibidor', 'Olga Navarro', 'violet', 9600, '9 nov', ['ML', '#8662C9'])],
      won: [d('d6', 'Dormitorio infantil', 'Familia Castro', 'green', 15200, '24 oct', ['ES', '#23918A'])],
    },
    wonSum: 31800,
    adsTitle: 'Publicidad',
    reportTabs: ['Informe por canal', 'Campañas'],
    periodFilter: 'Periodo: oct 2026',
    breakdownFilter: 'Desglose: fuente',
    cols: ['Fuente', 'Gasto', 'Leads', 'Conv.', 'CPL', 'Ingresos', 'ROMI'],
    wasPrefix: 'antes',
    total: 'Total',
    rows: [
      { name: 'Google Ads', c: 'var(--red)', exp: 12000, leads: 46, conv: 15, rev: 73000, hot: true },
      { name: 'Meta Ads', c: 'var(--green)', exp: 4500, leads: 31, conv: 10, rev: 15200 },
      { name: 'Recomendaciones', c: 'var(--violet)', exp: 0, leads: 12, conv: 42, rev: 52000 },
    ],
  },
};
