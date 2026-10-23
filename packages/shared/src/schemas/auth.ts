import { z } from 'zod';
import { ROLES } from '../constants';
import { clientId, uuid } from './common';
import { localeSchema } from '../i18n';

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
export const inviteAcceptBody = z.object({ token: z.string().min(10).max(200) });
export const roleChangeBody = z.object({ role: z.enum(ROLES) });
export const workspaceParam = z.object({ id: uuid });
export const memberParam = z.object({ id: uuid, memberId: uuid });
