import { z } from 'zod';
import { ROLES } from '../constants';
import { clientId, uuid } from './common';
import { localeSchema } from '../i18n';
import { isLimitKey, MODULE_IDS } from '../licensing';

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const password = z.string().min(8, 'Password must be at least 8 characters').max(200);

export const signupBody = z.object({
  email,
  password,
  name: z.string().trim().min(1).max(100),
  /** Если задано — сразу создаётся воркспейс с таким названием, пользователь становится owner */
  workspaceName: z.string().trim().min(1).max(100).optional(),
});
export const signinBody = z.object({ email, password: z.string().min(1).max(200) });

export const workspaceCreateBody = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, 'Slug: 3-40 chars, lowercase letters, digits and dashes')
    .optional(),
  color: z.string().max(32).optional(),
});
/** locale — язык воркспейса по умолчанию (workspaces.settings.locale), null — снять */
export const workspaceUpdateBody = workspaceCreateBody.partial().extend({ locale: localeSchema.nullable().optional() });

export const inviteCreateBody = z.object({
  email,
  role: z.enum(['admin', 'member', 'guest']).default('member'),
  /** Id профиля участника (status invited), если его выбирает клиент: на него сразу можно ссылаться (проекты, задачи) */
  memberId: clientId,
});
/** Новая ссылка для неотвеченного приглашения (почта пока не подключена — ссылку передают вручную) */
export const inviteLinkBody = z.object({ email });
export const inviteAcceptBody = z.object({ token: z.string().min(10).max(200) });
export const roleChangeBody = z.object({ role: z.enum(ROLES) });
export const workspaceParam = z.object({ id: uuid });
export const memberParam = z.object({ id: uuid, memberId: uuid });

/** Оператор установки создаёт арендатора: пустого или демо со сроком жизни (docs/architecture/deploy.md) */
export const tenantCreateBody = z.object({
  name: workspaceCreateBody.shape.name,
  slug: workspaceCreateBody.shape.slug,
  ownerEmail: email,
  ownerName: z.string().trim().min(1).max(100).optional(),
  demo: z.boolean().default(false),
  ttlDays: z.number().int().min(1).max(365).optional(),
  /** Тариф нового арендатора (по умолчанию — тариф по умолчанию); если у тарифа задан пробный период, он начинается сразу */
  planId: uuid.optional(),
});

/* Тарифы и лицензии арендаторов (задача 1205, docs/architecture/licensing.md): тела запросов оператора */
const moduleIdSchema = z.enum(MODULE_IDS);
const isoDate = z.string().datetime({ offset: true });
const limitsSchema = z.record(z.string(), z.number().int().min(0)).refine(r => Object.keys(r).every(isLimitKey), 'unknown limit');

export const licensePlanBody = z.object({
  key: z.string().trim().min(1).max(40).regex(/^[a-z0-9_-]+$/).optional(),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).nullable().optional(),
  modules: z.array(moduleIdSchema).max(20).default([]),
  allModules: z.boolean().default(false),
  limits: limitsSchema.default({}),
  trialDays: z.number().int().min(1).max(365).nullable().optional(),
  isDefault: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});
export type LicensePlanBody = z.infer<typeof licensePlanBody>;

export const tenantLicenseBody = z.object({
  planId: uuid,
  planExpiresAt: isoDate.nullable().default(null),
  isTrial: z.boolean().default(false),
  limits: limitsSchema.default({}),
  grants: z.array(z.object({ module: moduleIdSchema, expiresAt: isoDate.nullable().default(null) })).max(20).default([]),
});
export type TenantLicenseBody = z.infer<typeof tenantLicenseBody>;

/* Заявки арендатора на модули («Нужно больше?», задача 1208) */
export const REQUEST_STATUSES = ['new', 'in_progress', 'done', 'rejected'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const moduleRequestBody = z.object({
  modules: z.array(moduleIdSchema.exclude(['core'])).min(1).max(20),
  comment: z.string().trim().max(2000).nullish(),
  contact: z.string().trim().min(3).max(200),
});
export type ModuleRequestBody = z.infer<typeof moduleRequestBody>;

export const moduleRequestStatusBody = z.object({
  status: z.enum(REQUEST_STATUSES),
  note: z.string().trim().max(2000).nullish(),
});

/** Заявка в ответах API: арендатору — свои, оператору — все (с названием арендатора) */
export interface ModuleRequestRow {
  id: string;
  modules: string[];
  comment: string | null;
  contact: string;
  status: RequestStatus;
  createdAt: string;
}
export interface OperatorModuleRequest extends ModuleRequestRow {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  requestedBy: string | null;
  requestedByEmail: string | null;
  note: string | null;
  handledAt: string | null;
  handledByEmail: string | null;
  hookSentAt: string | null;
}
