import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { generateRecoveryCodes, generateTotpSecret, isIpAllowed, isValidIpRange, matchTotpStep, RECOVERY_CODE_RE, TOTP_CODE_RE, totpUri } from '@erp/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { loginEvents, memberships, sessions, users, workspaces } from './schema';
import { decryptSecret, encryptSecret } from './secrets';

const SECRET_NAME = 'totp';
const recoveryDigest = (code: string, salt: string) => createHash('sha256').update(salt).update(':').update(code).digest();

function hashRecoveryCode(code: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${recoveryDigest(code, salt).toString('hex')}`;
}

type TotpUser = Pick<typeof users.$inferSelect, 'id' | 'totpEnabled' | 'totpSecretCiphertext' | 'totpLastStep' | 'recoveryCodesHashes'>;

async function findTotpStep(user: TotpUser, code: string): Promise<number | null> {
  if (!user.totpSecretCiphertext || !TOTP_CODE_RE.test(code)) return null;
  const secret = decryptSecret(user.id, SECRET_NAME, user.totpSecretCiphertext);
  return matchTotpStep(secret, code);
}

export async function redeemLoginFactor(db: Db, user: TotpUser, code: string): Promise<'totp' | 'recovery' | null> {
  // The caller holds the user row lock until the challenge and session are committed.
  if (RECOVERY_CODE_RE.test(code)) {
    const index = user.recoveryCodesHashes.findIndex(entry => {
      const [salt, hash] = entry.split(':');
      return !!salt && !!hash && /^[0-9a-f]{64}$/.test(hash)
        && timingSafeEqual(recoveryDigest(code.toUpperCase(), salt), Buffer.from(hash, 'hex'));
    });
    if (index < 0) return null;
    await db.update(users).set({ recoveryCodesHashes: user.recoveryCodesHashes.filter((_, i) => i !== index) }).where(eq(users.id, user.id));
    return 'recovery';
  }
  const step = await findTotpStep(user, code);
  if (step === null || (user.totpLastStep !== null && step <= user.totpLastStep)) return null;
  await db.update(users).set({ totpLastStep: step }).where(eq(users.id, user.id));
  return 'totp';
}

export async function setupTotp(db: Db, userId: string, email: string) {
  const secret = generateTotpSecret();
  const [updated] = await db.update(users)
    .set({ totpSecretCiphertext: encryptSecret(userId, SECRET_NAME, secret) })
    .where(and(eq(users.id, userId), eq(users.totpEnabled, false)))
    .returning({ id: users.id });
  if (!updated) throw new DomainError(409, 'totp_already_enabled', 'Two-factor authentication is already enabled');
  return { secret, otpauthUri: totpUri(secret, email) };
}

export async function enableTotp(db: Db, userId: string, code: string): Promise<string[]> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).for('update');
  if (user?.totpEnabled) throw new DomainError(409, 'totp_already_enabled', 'Two-factor authentication is already enabled');
  if (!user?.totpSecretCiphertext) throw new DomainError(409, 'totp_setup_required', 'Start two-factor setup first');
  const step = await findTotpStep(user, code);
  if (step === null) throw new DomainError(400, 'invalid_totp', 'The authentication code is incorrect or has expired');
  const codes = generateRecoveryCodes();
  await db.update(users).set({
    totpEnabled: true,
    totpVerifiedAt: new Date(),
    totpLastStep: step,
    recoveryCodesHashes: codes.map(hashRecoveryCode),
  }).where(eq(users.id, userId));
  return codes;
}

export const clearLoginChallenge = { totpChallengeHash: null, totpChallengeExpiresAt: null } as const;

export async function disableTotp(db: Db, userId: string, proof: { password: string } | { code: string }) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).for('update');
  if (!user?.totpEnabled) return;
  if ('password' in proof) {
    if (!(await Bun.password.verify(proof.password, user.passwordHash)))
      throw new DomainError(400, 'wrong_password', 'The current password is incorrect');
  } else if (await findTotpStep(user, proof.code) === null) {
    throw new DomainError(400, 'invalid_totp', 'The authentication code is incorrect or has expired');
  }
  await db.update(users).set({
    totpEnabled: false,
    totpSecretCiphertext: null,
    totpVerifiedAt: null,
    totpLastStep: null,
    recoveryCodesHashes: [],
    ...clearLoginChallenge,
  }).where(eq(users.id, userId));
}

type LoginEvent = Pick<typeof loginEvents.$inferInsert, 'userId' | 'email' | 'ip' | 'userAgent' | 'method' | 'status'>;

/** Account-level attempts are copied to the workspaces the account belongs to at the time of the attempt. */
export async function recordLoginAttempt(db: Db, attempt: LoginEvent): Promise<void> {
  const rows = attempt.userId
    ? await db.select({ id: workspaces.id }).from(memberships)
      .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
      .where(and(eq(memberships.userId, attempt.userId), isNull(workspaces.deleteRequestedAt)))
    : [];
  await db.insert(loginEvents).values(rows.length
    ? rows.map(({ id }) => ({ ...attempt, workspaceId: id }))
    : [attempt]);
}

export async function workspaceSecurity(db: Db, workspaceId: string) {
  const [settings] = await db.select({ require2fa: workspaces.require2fa, ipAllowlist: workspaces.ipAllowlist })
    .from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!settings) throw new DomainError(404, 'not_found', 'Workspace not found');
  return settings;
}

export async function updateWorkspaceSecurity(
  db: Db,
  ctx: { workspaceId: string; memberId: string },
  ip: string,
  patch: { require2fa?: boolean; ipAllowlist?: string[] },
) {
  const { ipAllowlist } = patch;
  if (ipAllowlist) {
    const invalid = ipAllowlist.find(entry => !isValidIpRange(entry));
    if (invalid !== undefined) throw new DomainError(400, 'invalid_ip_range', 'Enter a valid IP address or CIDR range', { entry: invalid });
    if (!isIpAllowed(ip, ipAllowlist))
      throw new DomainError(400, 'ip_self_lockout', 'The allowlist must include your current IP address');
  }
  if (patch.require2fa === undefined && ipAllowlist === undefined) return workspaceSecurity(db, ctx.workspaceId);
  const [updated] = await db.update(workspaces)
    .set({ ...patch, ...(ipAllowlist && { ipAllowlist: [...new Set(ipAllowlist)] }), updatedAt: new Date() })
    .where(eq(workspaces.id, ctx.workspaceId))
    .returning({ require2fa: workspaces.require2fa, ipAllowlist: workspaces.ipAllowlist });
  if (!updated) throw new DomainError(404, 'not_found', 'Workspace not found');
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'workspace.security_updated', entity: 'workspace_security', actorId: ctx.memberId });
  return updated;
}

export function listLoginEvents(db: Db, workspaceId: string, offset: number) {
  return db.select().from(loginEvents).where(eq(loginEvents.workspaceId, workspaceId))
    .orderBy(desc(loginEvents.createdAt), desc(loginEvents.id)).limit(51).offset(offset);
}

export async function auditBlockedIp(db: Db, workspaceId: string, sessionId: string, identity: Omit<LoginEvent, 'status' | 'method'>) {
  const [session] = sessionId ? await db.select({ method: sessions.loginMethod }).from(sessions).where(eq(sessions.id, sessionId)) : [];
  await db.insert(loginEvents).values({
    ...identity, workspaceId, status: 'blocked_ip', method: session?.method ?? 'password', viaApiToken: !sessionId,
  });
}
