/* Вложения к объектам на клиенте (docs/architecture/attachments.md): запросы /attachments, загрузка multipart, скачивание.
   Ключи кэша ['ws', id, 'attachments', …]: событие attachment (data/realtime.ts) обновляет их и коллекцию файлов задач и проектов. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AttachmentEntityType } from '@gr8r/shared';
import type { TKey, TParams } from '@/i18n';
import { fmtNumber } from '@/i18n/format';
import { toast } from '@/components/ui';
import { API_BASE, ApiError, errorMessage, ok } from './api';
import { engineFor } from './engine';
import { useWsId } from '../meta/data';

export interface AttachmentRow {
  id: string;
  entityType: AttachmentEntityType;
  entityId: string;
  name: string;
  kind: string;
  currentVersion: number;
  createdBy: string | null;
  createdAt: string;
  archivedAt: string | null;
  sizeBytes: number;
  mime: string | null;
  versionCount: number;
  projectId: string | null;
}

export interface AttachmentVersionRow {
  id: string;
  version: number;
  sizeBytes: number;
  mime: string | null;
  sha256: string | null;
  comment: string;
  createdBy: string | null;
  createdAt: string;
  hasContent: boolean;
}

export interface StorageInfo {
  usedBytes: number;
  quotaBytes: number | null;
  custom: boolean;
  maxFileBytes: number;
}

const headers = (ws: string) => ({ 'X-Workspace-Id': ws });
const req = <T>(ws: string, method: string, path: string, body?: BodyInit | object) =>
  ok<T>(
    fetch(`${API_BASE()}/attachments${path}`, {
      method,
      credentials: 'include',
      headers: body !== undefined && !(body instanceof FormData) ? { ...headers(ws), 'Content-Type': 'application/json' } : headers(ws),
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    }),
  );

export const attachmentsKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'attachments', ...rest] as const;

/** Вложения объекта (по умолчанию живые, archived — архивные) */
export function useAttachments(entityType: AttachmentEntityType, entityId: string | undefined, archived = false) {
  const ws = useWsId();
  return useQuery({
    queryKey: attachmentsKey(ws, 'list', entityType, entityId ?? '', archived),
    enabled: !!entityId,
    queryFn: async () => (await req<{ items: AttachmentRow[] }>(ws, 'GET', `?entityType=${entityType}&entityId=${entityId}${archived ? '&archived=1' : ''}`)).items,
  });
}

export function useAttachmentVersions(id: string, enabled: boolean) {
  const ws = useWsId();
  return useQuery({ queryKey: attachmentsKey(ws, 'versions', id), enabled, queryFn: async () => (await req<{ versions: AttachmentVersionRow[] }>(ws, 'GET', `/${id}`)).versions });
}

export function useStorage() {
  const ws = useWsId();
  return useQuery({ queryKey: attachmentsKey(ws, 'storage'), queryFn: () => req<StorageInfo>(ws, 'GET', '/storage') });
}

/** Набор действий над вложениями; после каждого кэш вложений перечитывается */
export function useAttachmentActions() {
  const ws = useWsId();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: attachmentsKey(ws) });
    void qc.invalidateQueries({ queryKey: ['ws', ws, 'files'] }); // файлы задач и проектов в данных воркспейса
  };
  const after = <T,>(p: Promise<T>) => p.finally(refresh);
  return {
    upload: (entityType: AttachmentEntityType, entityId: string, file: File, comment?: string) => {
      const f = new FormData();
      f.set('entityType', entityType);
      f.set('entityId', entityId);
      if (comment) f.set('comment', comment);
      f.set('file', file);
      return after(req<AttachmentRow>(ws, 'POST', '', f));
    },
    addVersion: (id: string, file: File, comment?: string) => {
      const f = new FormData();
      if (comment) f.set('comment', comment);
      f.set('file', file);
      return after(req(ws, 'POST', `/${id}/versions`, f));
    },
    rename: (id: string, name: string) => after(req(ws, 'PATCH', `/${id}`, { name })),
    archive: (id: string) => after(req(ws, 'DELETE', `/${id}`)),
    restore: (id: string) => after(req(ws, 'POST', `/${id}/restore`)),
    setQuota: (storageQuotaBytes: number | null) => after(req<StorageInfo>(ws, 'PATCH', '/storage', { storageQuotaBytes })),
    /** Скачивание: файл берётся запросом с cookie и заголовком воркспейса и отдаётся браузеру через blob */
    download: async (id: string, name: string, version?: number) => {
      const res = await fetch(`${API_BASE()}/attachments/${id}/content${version ? `?version=${version}` : ''}`, { credentials: 'include', headers: headers(ws) });
      if (!res.ok) {
        let code = 'error';
        let message = res.statusText;
        try {
          const b = (await res.json()) as { error?: { code?: string; message?: string } };
          code = b.error?.code ?? code;
          message = b.error?.message ?? message;
        } catch {
          /* не JSON */
        }
        throw new ApiError(res.status, code, message);
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  };
}

type Tr = (key: TKey, params?: TParams) => string;

/** Размер файла для подписи: «4,2 МБ» по языку интерфейса */
export function fmtBytes(n: number, t: Tr): string {
  if (n < 1024) return `${fmtNumber(n)} ${t('attachments.units.b')}`;
  if (n < 1024 ** 2) return `${fmtNumber(n / 1024, { maximumFractionDigits: 0 })} ${t('attachments.units.kb')}`;
  if (n < 1024 ** 3) return `${fmtNumber(n / 1024 ** 2, { maximumFractionDigits: 1 })} ${t('attachments.units.mb')}`;
  return `${fmtNumber(n / 1024 ** 3, { maximumFractionDigits: 2 })} ${t('attachments.units.gb')}`;
}

/** Загрузка файлов задачи сразу после её создания/сохранения: ждём очередь движка (задача появится на сервере), затем POST /attachments */
export function useUploadToTask() {
  const ws = useWsId();
  const qc = useQueryClient();
  const act = useAttachmentActions();
  return async (taskId: string, files: File[]) => {
    if (!files.length) return;
    await engineFor(qc, ws).settled();
    for (const f of files) {
      try {
        await act.upload('task', taskId, f);
      } catch (e) {
        toast.error(errorMessage(e));
      }
    }
  };
}
