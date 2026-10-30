/* zod-схемы зарплаты (задача 1184): кадровые данные, виды и способы отражения, документы начисления и ведомости, отчёты. */
import { z } from 'zod';
import { ADVANCE_KINDS, PAYOUT_METHODS, PAYROLL_BASE_TYPES, PERCENT_BASES } from '../payroll';
import { clientId, decimal, isoDate, listQuery, shortText, toPatch, uuid } from './common';

const percent = decimal.refine(v => Number(v) >= 0 && Number(v) <= 100, 'Percent must be between 0 and 100');
const money = decimal.refine(v => Number(v) >= 0, 'Amount must not be negative');

/* ---------------- справочники ---------------- */

export const payrollKindCreate = z.object({
  id: clientId,
  name: shortText,
  baseType: z.enum(PAYROLL_BASE_TYPES),
  /** Облагается страховыми взносами */
  insurable: z.boolean().default(true),
});
export const payrollKindUpdate = toPatch(payrollKindCreate.omit({ id: true, baseType: true }));

export const payrollReflectionCreate = z.object({
  id: clientId,
  name: shortText,
  costItemId: uuid,
  workCenterId: uuid.nullish(),
});
export const payrollReflectionUpdate = toPatch(payrollReflectionCreate.omit({ id: true }));

export const payrollSettingsUpdate = z.object({
  insuranceRate: percent.optional(),
  /** Ставки оплаты водителям по рейсам (задача 1224): за рейс, за км, за точку, суточные за день междугороднего рейса */
  tripPieceworkRate: money.optional(),
  tripKmRate: money.optional(),
  tripStopRate: money.optional(),
  tripPerdiemRate: money.optional(),
});

/* ---------------- кадровые данные ---------------- */

export const employeePayrollUpdate = z.object({
  hiredAt: isoDate.nullish(),
  firedAt: isoDate.nullish(),
  organizationId: uuid.nullish(),
  workCenterId: uuid.nullish(),
  reflectionId: uuid.nullish(),
  ndflRate: percent.optional(),
  /** Счёт или карта для зарплатного реестра (не секрет, видят admin и owner) */
  cardAccount: z.string().trim().max(40).optional(),
  advanceAmount: money.nullish(),
  advancePercent: percent.nullish(),
});

/** Плановое начисление сотрудника: с даты действует (история); нулевое значение прекращает начисление */
export const employeeAccrualCreate = z.object({
  id: clientId,
  memberId: uuid,
  kindId: uuid,
  validFrom: isoDate,
  /** Оклад или сумма премии */
  amount: money.nullish(),
  /** Процент от продаж */
  percent: percent.nullish(),
  percentBasis: z.enum(PERCENT_BASES).default('revenue'),
});
export const employeeAccrualQuery = z.object({ memberId: uuid.optional() });

/* ---------------- документ «Начисление зарплаты» ---------------- */

export const payrollLineInput = z.object({
  id: clientId,
  memberId: uuid,
  kindId: uuid,
  /** База: оклад, сумма выработки, выручка (для удержаний и разовых — пусто) */
  base: money.default('0'),
  /** Процент (для процента от продаж) */
  rate: percent.default('0'),
  workedDays: z.coerce.number().int().min(0).max(31).default(0),
  normDays: z.coerce.number().int().min(0).max(31).default(0),
  amount: money,
  /** НДФЛ и взносы: пусто — пересчитать по ставке сотрудника и воркспейса */
  ndfl: money.optional(),
  insurance: money.optional(),
  reflectionId: uuid.nullish(),
  comment: z.string().trim().max(500).default(''),
});
export type PayrollLineInput = z.infer<typeof payrollLineInput>;

export const payrollCreate = z.object({
  id: clientId,
  organizationId: uuid.nullish(),
  /** Первый день месяца или любая дата месяца */
  period: isoDate,
  workCenterId: uuid.nullish(),
  /** Пусто — конец месяца периода */
  date: isoDate.optional(),
  comment: z.string().trim().max(2000).default(''),
  lines: z.array(payrollLineInput).max(2000).default([]),
});
export type PayrollCreate = z.infer<typeof payrollCreate>;
export const payrollUpdate = toPatch(payrollCreate.omit({ id: true }));
export const payrollFillBody = z.object({ memberIds: z.array(uuid).max(500).optional() });
export const payrollQuery = listQuery.extend({ status: z.string().optional(), period: isoDate.optional() });

/* ---------------- ведомость на выплату ---------------- */

export const statementLineInput = z.object({
  id: clientId,
  memberId: uuid,
  amount: decimal.refine(v => Number(v) > 0, 'Amount must be greater than zero'),
  comment: z.string().trim().max(500).default(''),
});
export type StatementLineInput = z.infer<typeof statementLineInput>;

export const statementCreate = z.object({
  id: clientId,
  organizationId: uuid.nullish(),
  period: isoDate,
  kind: z.enum(ADVANCE_KINDS),
  method: z.enum(PAYOUT_METHODS),
  date: isoDate.optional(),
  comment: z.string().trim().max(2000).default(''),
  lines: z.array(statementLineInput).max(2000).default([]),
});
export type StatementCreate = z.infer<typeof statementCreate>;
export const statementUpdate = toPatch(statementCreate.omit({ id: true }));
export const statementQuery = listQuery.extend({ status: z.string().optional(), period: isoDate.optional() });
export const statementPayBody = z.object({
  /** Касса или банковский счёт организации; пусто — по умолчанию */
  cashRegisterId: uuid.nullish(),
  bankAccountId: uuid.nullish(),
});

/* ---------------- отчёты ---------------- */

export const payrollReportQuery = z.object({ from: isoDate, to: isoDate, memberId: uuid.optional() });
export const payslipQuery = z.object({ period: isoDate, memberId: uuid.optional() });
