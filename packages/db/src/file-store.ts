/* Хранилище содержимого вложений (docs/architecture/attachments.md): интерфейс FileStore, S3-совместимая реализация
   на встроенном в Bun S3Client (SigV4, MinIO / Yandex Object Storage / AWS) и стор в памяти для тестов.
   Ключ объекта — <workspace>/<attachment>/<version>: имя файла живёт в БД, в ключе его нет. */
import { createHash } from 'node:crypto';
import { FILE_MAX_BYTES_DEFAULT } from '@gr8r/shared';

export interface StoredObject {
  key: string;
  size: number;
  lastModified: Date;
}

export interface FileStore {
  put(key: string, data: Uint8Array, mime?: string | null): Promise<void>;
  /** null — объекта нет */
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  /** Объекты с префиксом (для сборки мусора); постранично сам обходит стор */
  list(prefix: string): Promise<StoredObject[]>;
}

export const attachmentKey = (workspaceId: string, attachmentId: string, version: number) => `${workspaceId}/${attachmentId}/${version}`;

export const sha256Hex = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

/** Стор в памяти: тесты и запуск без S3 (данные теряются при перезапуске) */
export class MemoryFileStore implements FileStore {
  readonly objects = new Map<string, { data: Uint8Array; at: Date }>();
  async put(key: string, data: Uint8Array) {
    this.objects.set(key, { data: new Uint8Array(data), at: new Date() });
  }
  async get(key: string) {
    return this.objects.get(key)?.data ?? null;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  async list(prefix: string) {
    return [...this.objects].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.data.length, lastModified: o.at }));
  }
}

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  /** MinIO — да (адрес вида endpoint/bucket/key); Yandex и AWS — нет */
  forcePathStyle: boolean;
}

export class S3FileStore implements FileStore {
  private readonly client: Bun.S3Client;
  constructor(cfg: S3Config) {
    this.client = new Bun.S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      bucket: cfg.bucket,
      accessKeyId: cfg.accessKey,
      secretAccessKey: cfg.secretKey,
      virtualHostedStyle: !cfg.forcePathStyle,
    });
  }
  async put(key: string, data: Uint8Array, mime?: string | null) {
    await this.client.write(key, data, { type: mime || 'application/octet-stream' });
  }
  async get(key: string) {
    const f = this.client.file(key);
    if (!(await f.exists())) return null;
    return new Uint8Array(await f.arrayBuffer());
  }
  async delete(key: string) {
    await this.client.delete(key);
  }
  async list(prefix: string) {
    const out: StoredObject[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.list({ prefix, maxKeys: 1000, continuationToken: token });
      for (const o of res.contents ?? []) out.push({ key: o.key, size: o.size ?? 0, lastModified: o.lastModified ? new Date(o.lastModified) : new Date(0) });
      token = res.isTruncated ? res.nextContinuationToken : undefined;
    } while (token);
    return out;
  }
}

/** Настройки хранилища из окружения. Без S3_ENDPOINT / S3_BUCKET хранилища нет: загрузка отвечает 503 storage_unavailable */
export interface StorageSettings {
  maxFileBytes: number;
  /** Квота воркспейса по умолчанию, байт (STORAGE_QUOTA_BYTES; null — без ограничения) */
  defaultQuotaBytes: number | null;
  /** Через сколько дней после архива вложения воркер удаляет объекты из S3 */
  archiveRetentionDays: number;
}

const int = (v: string | undefined) => {
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function storageSettings(env: Record<string, string | undefined> = process.env): StorageSettings {
  return {
    maxFileBytes: int(env.FILE_MAX_BYTES) || FILE_MAX_BYTES_DEFAULT,
    defaultQuotaBytes: int(env.STORAGE_QUOTA_BYTES),
    archiveRetentionDays: int(env.ATTACHMENT_RETENTION_DAYS) ?? 30,
  };
}

export function s3ConfigFromEnv(env: Record<string, string | undefined> = process.env): S3Config | null {
  if (!env.S3_ENDPOINT || !env.S3_BUCKET) return null;
  return {
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION || 'us-east-1',
    bucket: env.S3_BUCKET,
    accessKey: env.S3_ACCESS_KEY ?? '',
    secretKey: env.S3_SECRET_KEY ?? '',
    forcePathStyle: !(env.S3_FORCE_PATH_STYLE === '0' || env.S3_FORCE_PATH_STYLE === 'false'),
  };
}

let current: FileStore | null | undefined;

/** Общий стор процесса: S3 из окружения или null. Тесты подставляют MemoryFileStore через setFileStore */
export function getFileStore(): FileStore | null {
  if (current === undefined) {
    const cfg = s3ConfigFromEnv();
    current = cfg ? new S3FileStore(cfg) : null;
  }
  return current;
}

export function setFileStore(store: FileStore | null): void {
  current = store;
}
