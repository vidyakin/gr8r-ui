/* Токены доступа агентов (задача 1285): тела запросов /api-tokens. */
import { z } from 'zod';
import { POSITION_SECTIONS } from '../positions';
import { uuid } from './common';

const name = z.string().trim().min(1).max(120);
const isoDateTime = z.string().datetime({ offset: true });

/** Выпуск токена: readOnly по умолчанию true; sections null/нет — все разделы сотрудника, [] — только открытые пути */
export const apiTokenCreate = z.object({
  name,
  /** Чей токен: по умолчанию — сам выпускающий; другого участника назначает только admin/owner */
  memberId: uuid.optional(),
  readOnly: z.boolean().default(true),
  sections: z
    .array(z.enum(POSITION_SECTIONS))
    .max(POSITION_SECTIONS.length)
    .nullable()
    .optional(),
  /** Право проводить, оплачивать, удалять (несовместимо с readOnly) */
  canPost: z.boolean().default(false),
  expiresAt: isoDateTime.nullable().optional(),
});
export type ApiTokenCreateBody = z.infer<typeof apiTokenCreate>;

/** Служебный сотрудник для агента без человека (только admin/owner) */
export const serviceMemberCreate = z.object({
  name,
  role: z.enum(['member', 'guest']).default('member'),
  positionIds: z.array(uuid).max(50).optional(),
});
export type ServiceMemberCreateBody = z.infer<typeof serviceMemberCreate>;
