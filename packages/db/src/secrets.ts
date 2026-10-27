/* Хранилище секретов воркспейса (задача 1174а, docs/architecture/secrets.md). AES-256-GCM, ключ — `SECRETS_KEY` из окружения
   (32 байта: 64 hex-символа или base64). Нет ключа — секреты недоступны (422 `secrets_unavailable`). Открытое значение отдаёт только
   `readSecret` для воркера/сервера; список и маршруты API показывают лишь факт наличия и дату. Права записи (admin+) — в маршрутах. */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { SECRET_KEY_RE } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import type { DocCtx } from './documents';
import { workspaceSecrets } from './schema';

const PREFIX = 'v1:';

/** Ключ шифрования из окружения; null — не задан или неверной длины */
export function secretsKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  const raw = env.SECRETS_KEY?.trim();
  if (!raw) return null;
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  return buf.length === 32 ? buf : null;
}

export function secretsAvailable(env: Record<string, string | undefined> = process.env): boolean {
  return secretsKey(env) !== null;
}

function needKey(env?: Record<string, string | undefined>): Buffer {
  const k = secretsKey(env);
  if (!k) throw new DomainError(422, 'secrets_unavailable', 'SECRETS_KEY is not set or is not 32 bytes (64 hex chars or base64)');
  return k;
}

const aad = (workspaceId: string, key: string) => Buffer.from(`${workspaceId}:${key}`);

/** Шифрование значения; AAD привязывает шифртекст к воркспейсу и имени (строку нельзя подменить другой) */
export function encryptSecret(workspaceId: string, key: string, value: string, env?: Record<string, string | undefined>): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', needKey(env), iv);
  c.setAAD(aad(workspaceId, key));
  const ct = Buffer.concat([c.update(value, 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

export function decryptSecret(workspaceId: string, key: string, ciphertext: string, env?: Record<string, string | undefined>): string {
  const k = needKey(env);
  if (!ciphertext.startsWith(PREFIX)) throw new DomainError(422, 'secret_corrupted', 'Unknown secret format');
  const buf = Buffer.from(ciphertext.slice(PREFIX.length), 'base64');
  try {
    const d = createDecipheriv('aes-256-gcm', k, buf.subarray(0, 12));
    d.setAAD(aad(workspaceId, key));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
  } catch {
    // неверный ключ окружения или испорченные данные — значение не раскрываем
    throw new DomainError(422, 'secret_corrupted', 'Secret cannot be decrypted with the current SECRETS_KEY');
  }
}

function checkKey(key: string): void {
  if (!SECRET_KEY_RE.test(key)) throw new DomainError(400, 'invalid_secret_key', 'Secret key must be lowercase latin, digits, . _ - (up to 64 chars)');
}

export interface SecretInfo {
  key: string;
  updatedAt: Date;
  createdBy: string | null;
}

/** Список без значений и шифртекста */
export async function listSecrets(db: Db): Promise<SecretInfo[]> {
  return db
    .select({ key: workspaceSecrets.key, updatedAt: workspaceSecrets.updatedAt, createdBy: workspaceSecrets.createdBy })
    .from(workspaceSecrets)
    .orderBy(asc(workspaceSecrets.key));
}

export async function setSecret(db: Db, ctx: DocCtx, key: string, value: string, env?: Record<string, string | undefined>): Promise<SecretInfo> {
  checkKey(key);
  const ciphertext = encryptSecret(ctx.workspaceId, key, value, env);
  const now = new Date();
  const [row] = await db
    .insert(workspaceSecrets)
    .values({ workspaceId: ctx.workspaceId, key, ciphertext, createdBy: ctx.memberId, updatedAt: now })
    .onConflictDoUpdate({ target: [workspaceSecrets.workspaceId, workspaceSecrets.key], set: { ciphertext, createdBy: ctx.memberId, updatedAt: now } })
    .returning({ key: workspaceSecrets.key, updatedAt: workspaceSecrets.updatedAt, createdBy: workspaceSecrets.createdBy });
  // в событие и аудит попадает только имя секрета
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'secret.updated', entity: 'secret', actorId: ctx.memberId, payload: { key } });
  return row!;
}

export async function deleteSecret(db: Db, ctx: DocCtx, key: string): Promise<void> {
  const rows = await db.delete(workspaceSecrets).where(and(eq(workspaceSecrets.workspaceId, ctx.workspaceId), eq(workspaceSecrets.key, key))).returning({ key: workspaceSecrets.key });
  if (!rows.length) throw new DomainError(404, 'not_found', 'Secret not found');
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'secret.deleted', entity: 'secret', actorId: ctx.memberId, payload: { key } });
}

/** Открытое значение секрета — только для воркера и серверного кода; null, если секрета нет. Никогда не отдавать в API и журналы */
export async function readSecret(db: Db, workspaceId: string, key: string, env?: Record<string, string | undefined>): Promise<string | null> {
  const [row] = await db
    .select({ ciphertext: workspaceSecrets.ciphertext })
    .from(workspaceSecrets)
    .where(and(eq(workspaceSecrets.workspaceId, workspaceId), eq(workspaceSecrets.key, key)))
    .limit(1);
  if (!row) return null;
  return decryptSecret(workspaceId, key, row.ciphertext, env);
}
