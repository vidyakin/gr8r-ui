import { z } from 'zod';
import { TOTP_CODE_RE } from '../security';

export const totpVerifyBody = z.object({ code: z.string().trim().regex(TOTP_CODE_RE) });
export const totpDisableBody = z.union([
  z.object({ password: z.string().min(1).max(1024) }).strict(),
  totpVerifyBody.strict(),
]);
export const loginFactorBody = z.object({
  challengeToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code: z.string().trim().min(1).max(32),
});
export const workspaceSecurityBody = z.object({
  require2fa: z.boolean().optional(),
  ipAllowlist: z.array(z.string().trim().min(1).max(64)).max(100).optional(),
}).strict();
