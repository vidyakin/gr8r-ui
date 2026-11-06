/* Стоимость часа рабочего для табеля прораба (задача 1271, docs/architecture/construction.md).
   Источник — зарплата: почасовая ставка сотрудника (employee_payroll.hourly_rate), иначе оклад
   (действующее на дату работы начисление вида salary) / норма часов месяца по графику сотрудника.
   Сверху — страховые взносы (workspaces.payroll_insurance_rate, %). Нет ни ставки, ни оклада — стоимости нет (null,
   пробел, а не ноль): смена подтверждается, а факт и интерфейс показывают «нет ставки».
   Деньги — decimal (dec/fmt), без float; округление стоимости часа — до копейки. */
import { dec, fmt, div, mul, withPct, type Dec } from './decimal';

/** Предел часов работника за смену (проверяется сервисом: 422 shift_hours_exceed) */
export const SHIFT_HOURS_MAX = '24';

/** Откуда взялась стоимость часа */
export type LaborCostSource = 'hourly' | 'salary';

export interface LaborHourCostInput {
  /** Почасовая ставка сотрудника; пусто — нет */
  hourlyRate?: string | null;
  /** Оклад, действующий на дату работы; пусто — нет */
  salary?: string | null;
  /** Норма часов месяца по графику сотрудника (рабочие дни × часы в день); пусто — посчитать нельзя */
  monthNormHours?: string | null;
  /** Ставка страховых взносов воркспейса, % */
  insuranceRate: string;
}

export interface LaborHourCost {
  /** Источник ставки; null — ни ставки, ни оклада */
  source: LaborCostSource | null;
  /** Ставка часа без взносов; null — стоимости нет */
  gross: string | null;
  /** Стоимость часа для затрат объекта: gross × (1 + взносы/100), до копейки; null — стоимости нет */
  rate: string | null;
  /** Норма часов месяца, по которой считали оклад (для показа и проверки) */
  monthNormHours: string | null;
}

/** Норма часов месяца: рабочие дни месяца по графику × часов в день графика (0 — считать нечего) */
export function monthNormHours(workingDays: number, hoursPerDay: string): string {
  if (workingDays <= 0) return '0.00';
  const perDay = dec(hoursPerDay);
  if (perDay <= 0n) return '0.00';
  return fmt(mul(dec(String(workingDays)), perDay), 2);
}

/** Стоимость часа: почасовая ставка, иначе оклад / норма часов; плюс страховые взносы. Без float */
export function laborHourCost(input: LaborHourCostInput): LaborHourCost {
  const norm = input.monthNormHours ? dec(input.monthNormHours) : 0n;
  const hourly = input.hourlyRate ? dec(input.hourlyRate) : 0n;
  const salary = input.salary ? dec(input.salary) : 0n;
  let source: LaborCostSource | null = null;
  let base: Dec | null = null;
  if (hourly > 0n) {
    source = 'hourly';
    base = hourly;
  } else if (salary > 0n && norm > 0n) {
    source = 'salary';
    // оклад / норма часов месяца: деление с точностью decimal (10⁻⁶), округление до копейки — в итоговой ставке
    base = div(salary, norm);
  }
  if (base === null) return { source: null, gross: null, rate: null, monthNormHours: input.monthNormHours ?? null };
  return {
    source,
    gross: fmt(base, 2),
    rate: fmt(withPct(base, dec(input.insuranceRate)), 2),
    monthNormHours: input.monthNormHours ?? null,
  };
}

/** Сумма строки табеля: часы × стоимость часа, до копейки; нет стоимости — null (пробел, не ноль) */
export function laborCostAmount(hours: string, rate: string | null | undefined): string | null {
  if (rate == null || rate === '') return null;
  return fmt(mul(dec(hours), dec(rate)), 2);
}
