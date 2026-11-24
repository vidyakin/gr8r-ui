import type { Locale } from '../../i18n';

export interface PayrollRow {
  who: string;
  kind: string;
  isPiece?: boolean;
  base: number;
  days?: string;
  amount: number;
}

export interface PayrollDict {
  crumbsAccrual: [string, string];
  crumbsStatement: [string, string];
  taxRate: number;
  contribRate: number;
  accrualDocNum: string;
  newAccrualTitle: string;
  accrualSubtitle: string;
  postedBadge: string;
  statementBtnCompact: string;
  statementBtn: string;
  unpostBtn: string;
  fillBtn: string;
  createBtn: string;
  postBtn: string;
  periodLabel: string;
  periodVal: string;
  dateLabel: string;
  dateVal: string;
  orgLabel: string;
  orgVal: string;
  accrualCols: {
    num: string;
    employee: string;
    kind: string;
    base: string;
    days: string;
    amount: string;
    tax: string;
    contrib: string;
    posting: string;
  };
  postingSalary: string;
  postingPiece: string;
  emptyHint: string;
  addLineBtn: string;
  accrualSummary: { accrued: string; withheld: string; toPay: string; insurance: string };
  statementDocNum: string;
  statementSubtitle: string;
  paidBadge: string;
  unpaidBadge: string;
  printBtn: string;
  kindLabel: string;
  kindVal: string;
  payMethodLabel: string;
  payMethodVal: string;
  paidCol: string;
  statementSummary: { total: string; paid: string; remaining: string };
  cashDeskLabel: string;
  cashDeskVal: string;
  payFromCashBtn: string;
  payoutsLabel: string;
  payoutDocNum: string;
  rows: PayrollRow[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export const PAYROLL_DICT: Record<Locale, PayrollDict> = {
  ru: {
    crumbsAccrual: ['Деньги', 'Начисление зарплаты'],
    crumbsStatement: ['Деньги', 'Ведомости на выплату'],
    taxRate: 0.13,
    contribRate: 0.3,
    accrualDocNum: 'НЗ-000019',
    newAccrualTitle: 'Новое начисление',
    accrualSubtitle: 'Начисление зарплаты',
    postedBadge: 'Проведён',
    statementBtnCompact: 'Ведомость',
    statementBtn: 'Новая ведомость',
    unpostBtn: 'Отменить проведение',
    fillBtn: 'Заполнить',
    createBtn: 'Создать',
    postBtn: 'Провести',
    periodLabel: 'Период',
    periodVal: 'октябрь 2026',
    dateLabel: 'Дата',
    dateVal: '31.10.2026',
    orgLabel: 'Организация',
    orgVal: 'ООО «Мебельная фабрика»',
    accrualCols: { num: '№', employee: 'Сотрудник', kind: 'Вид начисления', base: 'База', days: 'Дни', amount: 'Сумма', tax: 'НДФЛ', contrib: 'Взносы', posting: 'Способ отражения' },
    postingSalary: 'Зарплата · Цех №1',
    postingPiece: 'Производство · Цех №1',
    emptyHint: 'Строк пока нет — нажмите «Заполнить»',
    addLineBtn: 'Добавить строку',
    accrualSummary: { accrued: 'Начислено', withheld: 'Удержано', toPay: 'К выплате', insurance: 'Страховые взносы' },
    statementDocNum: 'ВЗ-000012',
    statementSubtitle: 'Ведомости на выплату',
    paidBadge: 'Выплачена',
    unpaidBadge: 'Не выплачена',
    printBtn: 'Печать',
    kindLabel: 'Вид',
    kindVal: 'Расчёт',
    payMethodLabel: 'Способ выплаты',
    payMethodVal: 'Касса',
    paidCol: 'Выплачено',
    statementSummary: { total: 'Сумма', paid: 'Выплачено', remaining: 'Осталось' },
    cashDeskLabel: 'Касса',
    cashDeskVal: 'Основная касса',
    payFromCashBtn: 'Выплатить из кассы',
    payoutsLabel: 'Выплаты',
    payoutDocNum: 'РКО-000044',
    rows: [
      { who: 'Ковалёв Игорь', kind: 'Оклад по табелю', base: 50000, days: '22 / 22', amount: 50000 },
      { who: 'Ковалёв Игорь', kind: 'Сдельная', isPiece: true, base: 38400, amount: 38400 },
      { who: 'Соколова Мария', kind: 'Оклад по табелю', base: 45000, days: '21 / 22', amount: r2((45000 * 21) / 22) },
      { who: 'Соколова Мария', kind: 'Сдельная', isPiece: true, base: 29750, amount: 29750 },
      { who: 'Громов Павел', kind: 'Оклад по табелю', base: 40000, days: '22 / 22', amount: 40000 },
      { who: 'Громов Павел', kind: 'Сдельная', isPiece: true, base: 51200, amount: 51200 },
    ],
  },
  en: {
    crumbsAccrual: ['Finance', 'Payroll accrual'],
    crumbsStatement: ['Finance', 'Pay statements'],
    taxRate: 0.2,
    contribRate: 0.15,
    accrualDocNum: 'PA-000019',
    newAccrualTitle: 'New payroll run',
    accrualSubtitle: 'Payroll accrual',
    postedBadge: 'Posted',
    statementBtnCompact: 'Statement',
    statementBtn: 'New pay statement',
    unpostBtn: 'Unpost',
    fillBtn: 'Auto-fill',
    createBtn: 'Create',
    postBtn: 'Post',
    periodLabel: 'Period',
    periodVal: 'October 2026',
    dateLabel: 'Date',
    dateVal: 'Oct 31, 2026',
    orgLabel: 'Company',
    orgVal: 'OakCraft Furniture LLC',
    accrualCols: { num: '#', employee: 'Employee', kind: 'Pay type', base: 'Base', days: 'Days', amount: 'Amount', tax: 'Tax', contrib: 'Contrib.', posting: 'Posting account' },
    postingSalary: 'Payroll · Shop #1',
    postingPiece: 'Production · Shop #1',
    emptyHint: 'No lines yet — click Auto-fill',
    addLineBtn: 'Add line',
    accrualSummary: { accrued: 'Accrued', withheld: 'Withheld', toPay: 'Net pay', insurance: 'Employer taxes' },
    statementDocNum: 'PS-000012',
    statementSubtitle: 'Pay statements',
    paidBadge: 'Paid',
    unpaidBadge: 'Unpaid',
    printBtn: 'Print',
    kindLabel: 'Type',
    kindVal: 'Final pay',
    payMethodLabel: 'Payment method',
    payMethodVal: 'Cash desk',
    paidCol: 'Paid',
    statementSummary: { total: 'Total', paid: 'Paid', remaining: 'Remaining' },
    cashDeskLabel: 'Cash desk',
    cashDeskVal: 'Main cash desk',
    payFromCashBtn: 'Pay from cash desk',
    payoutsLabel: 'Payouts',
    payoutDocNum: 'CO-000044',
    rows: [
      { who: 'Igor Kovalev', kind: 'Base salary', base: 5000, days: '22 / 22', amount: 5000 },
      { who: 'Igor Kovalev', kind: 'Piecework', isPiece: true, base: 3840, amount: 3840 },
      { who: 'Maria Sokolova', kind: 'Base salary', base: 4500, days: '21 / 22', amount: r2((4500 * 21) / 22) },
      { who: 'Maria Sokolova', kind: 'Piecework', isPiece: true, base: 2975, amount: 2975 },
      { who: 'Paul Gromov', kind: 'Base salary', base: 4000, days: '22 / 22', amount: 4000 },
      { who: 'Paul Gromov', kind: 'Piecework', isPiece: true, base: 5120, amount: 5120 },
    ],
  },
  es: {
    crumbsAccrual: ['Finanzas', 'Devengo de nómina'],
    crumbsStatement: ['Finanzas', 'Hojas de pago'],
    taxRate: 0.15,
    contribRate: 0.3,
    accrualDocNum: 'DN-000019',
    newAccrualTitle: 'Nuevo devengo',
    accrualSubtitle: 'Devengo de nómina',
    postedBadge: 'Contabilizado',
    statementBtnCompact: 'Hoja de pago',
    statementBtn: 'Nueva hoja de pago',
    unpostBtn: 'Deshacer',
    fillBtn: 'Rellenar',
    createBtn: 'Crear',
    postBtn: 'Contabilizar',
    periodLabel: 'Periodo',
    periodVal: 'octubre 2026',
    dateLabel: 'Fecha',
    dateVal: '31/10/2026',
    orgLabel: 'Empresa',
    orgVal: 'Fábrica de Muebles Roble S.L.',
    accrualCols: { num: 'N.º', employee: 'Empleado', kind: 'Concepto', base: 'Base', days: 'Días', amount: 'Importe', tax: 'IRPF', contrib: 'Cotiz.', posting: 'Cuenta contable' },
    postingSalary: 'Nómina · Taller N.º 1',
    postingPiece: 'Producción · Taller N.º 1',
    emptyHint: 'Sin líneas aún — pulsa Rellenar',
    addLineBtn: 'Añadir línea',
    accrualSummary: { accrued: 'Devengado', withheld: 'Retenido', toPay: 'A pagar', insurance: 'Seg. Social' },
    statementDocNum: 'HP-000012',
    statementSubtitle: 'Hojas de pago',
    paidBadge: 'Pagada',
    unpaidBadge: 'Pendiente',
    printBtn: 'Imprimir',
    kindLabel: 'Tipo',
    kindVal: 'Liquidación',
    payMethodLabel: 'Método de pago',
    payMethodVal: 'Caja',
    paidCol: 'Pagado',
    statementSummary: { total: 'Total', paid: 'Pagado', remaining: 'Pendiente' },
    cashDeskLabel: 'Caja',
    cashDeskVal: 'Caja principal',
    payFromCashBtn: 'Pagar desde caja',
    payoutsLabel: 'Pagos',
    payoutDocNum: 'PC-000044',
    rows: [
      { who: 'Íñigo Morales', kind: 'Salario base', base: 3200, days: '22 / 22', amount: 3200 },
      { who: 'Íñigo Morales', kind: 'A destajo', isPiece: true, base: 1840, amount: 1840 },
      { who: 'María Serrano', kind: 'Salario base', base: 2900, days: '21 / 22', amount: r2((2900 * 21) / 22) },
      { who: 'María Serrano', kind: 'A destajo', isPiece: true, base: 1450, amount: 1450 },
      { who: 'Pablo Vega', kind: 'Salario base', base: 2600, days: '22 / 22', amount: 2600 },
      { who: 'Pablo Vega', kind: 'A destajo', isPiece: true, base: 2100, amount: 2100 },
    ],
  },
};
