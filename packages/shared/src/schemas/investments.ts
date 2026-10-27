/* Инвестпроекты: тела запросов API. Строки плана и статьи проекта заменяются списком целиком */
import { z } from 'zod';
import { INVESTMENT_PERIOD_KINDS, INVESTMENT_STATUSES } from '../investments';
import { clientId, decimal, isoDate, listQuery, uuid } from './common';

export const investmentPlanLineInput = z.object({
  id: clientId,
  periodIndex: z.number().int().min(0).max(239),
  costItemId: uuid,
  amount: decimal,
  comment: z.string().max(500).default(''),
});

const head = {
  name: z.string().trim().min(1).max(200),
  periodKind: z.enum(INVESTMENT_PERIOD_KINDS),
  startDate: isoDate,
  periods: z.number().int().min(1).max(240),
  /** Годовая ставка дисконтирования, % */
  discountRate: decimal,
  projectId: uuid.nullish(),
  organizationId: uuid.nullish(),
  responsibleId: uuid.nullish(),
  comment: z.string().max(5000),
};

export const investmentCreate = z.object({
  id: clientId,
  ...head,
  periodKind: head.periodKind.default('quarter'),
  discountRate: head.discountRate.default('0'),
  comment: head.comment.default(''),
  lines: z.array(investmentPlanLineInput).max(2000).default([]),
  costItemIds: z.array(uuid).max(200).default([]),
  /** База факта: начисление (документы) или оплаты (движения денег) */
  factBasis: z.enum(['accrual', 'payments']).default('accrual'),
});

export const investmentUpdate = z.object({
  name: head.name.optional(),
  periodKind: head.periodKind.optional(),
  startDate: head.startDate.optional(),
  periods: head.periods.optional(),
  discountRate: head.discountRate.optional(),
  projectId: head.projectId,
  organizationId: head.organizationId,
  responsibleId: head.responsibleId,
  comment: head.comment.optional(),
  lines: z.array(investmentPlanLineInput).max(2000).optional(),
  costItemIds: z.array(uuid).max(200).optional(),
  factBasis: z.enum(['accrual', 'payments']).optional(),
});

export const investmentQuery = listQuery.extend({ status: z.enum(INVESTMENT_STATUSES).optional() });

export const investmentStatusAction = z.object({ action: z.enum(['approve', 'unapprove', 'close', 'reopen']) });

export type InvestmentCreate = z.infer<typeof investmentCreate>;
export type InvestmentUpdate = z.infer<typeof investmentUpdate>;
export type InvestmentPlanLineInput = z.infer<typeof investmentPlanLineInput>;
