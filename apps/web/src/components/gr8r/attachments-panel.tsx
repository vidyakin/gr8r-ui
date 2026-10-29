/* Вкладка «Файлы» для любого объекта (docs/architecture/attachments.md): список, перетаскивание для загрузки,
   версии в раскрывающейся строке, скачивание, переименование, архив. Права проверяет сервер (как у объекта):
   без права на запись кнопки загрузки скрыты, а отказ сервера показывается тостом. */
import * as React from 'react';
import { Archive, ChevronDown, ChevronRight, Download, Ellipsis, History, Pencil, Undo2, Upload, UploadCloud } from 'lucide-react';
import type { AttachmentEntityType } from '@gr8r/shared';
import { Button, ConfirmDialog, Dialog, DialogClose, DialogContent, EmptyState, IconButton, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { fmtDateTime } from '@/i18n/format';
import { errorMessage } from '@/app/data/api';
import { fmtBytes, useAttachmentActions, useAttachments, useAttachmentVersions, useStorage, type AttachmentRow } from '@/app/data/attachments';
import { useSession } from '@/app/data/session';
import { useWorkspace } from '@/app/data/store';

export interface AttachmentsPanelProps {
  entityType: AttachmentEntityType;
  /** Нет id (запись ещё не сохранена) — панель не показывается */
  entityId: string | undefined;
  /** Скрыть загрузку (например, объект в архиве) */
  readOnly?: boolean;
}

function useMemberName() {
  const { data } = useWorkspace();
  return (id: string | null) => data.members.find(m => m.id === id)?.name ?? '—';
}

export function AttachmentsPanel({ entityType, entityId, readOnly }: AttachmentsPanelProps) {
  const t = useT();
  const { active } = useSession();
  const canWrite = !readOnly && active?.role !== 'guest';
  const [archived, setArchived] = React.useState(false);
  const list = useAttachments(entityType, entityId, archived);
  const storage = useStorage();
  const act = useAttachmentActions();
  const memberName = useMemberName();
  const [over, setOver] = React.useState(false);
  const [busy, setBusy] = React.useState<string[]>([]);
  const [renaming, setRenaming] = React.useState<AttachmentRow | null>(null);
  const [newName, setNewName] = React.useState('');
  const [confirm, setConfirm] = React.useState<AttachmentRow | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const versionInput = React.useRef<HTMLInputElement>(null);
  const versionFor = React.useRef<string | null>(null);

  const max = storage.data?.maxFileBytes;
  const fail = (name: string, e: unknown) => toast.error(t('attachments.uploadFailed', { name, reason: errorMessage(e) }));

  const upload = async (files: FileList | File[] | null) => {
    if (!files || !entityId) return;
    for (const f of [...files]) {
      if (max && f.size > max) {
        toast.error(t('attachments.tooLarge', { name: f.name, size: fmtBytes(max, t) }));
        continue;
      }
      setBusy(b => [...b, f.name]);
      try {
        await act.upload(entityType, entityId, f);
        toast(t('attachments.uploaded', { name: f.name }));
      } catch (e) {
        fail(f.name, e);
      } finally {
        setBusy(b => b.filter(x => x !== f.name));
      }
    }
  };

  const addVersion = async (f: File | undefined) => {
    const id = versionFor.current;
    if (!f || !id) return;
    if (max && f.size > max) return void toast.error(t('attachments.tooLarge', { name: f.name, size: fmtBytes(max, t) }));
    setBusy(b => [...b, f.name]);
    try {
      await act.addVersion(id, f);
      toast(t('attachments.uploaded', { name: f.name }));
      setOpen(id);
    } catch (e) {
      fail(f.name, e);
    } finally {
      setBusy(b => b.filter(x => x !== f.name));
    }
  };

  const guard = (p: Promise<unknown>) => p.catch(e => toast.error(errorMessage(e)));
  const items = list.data ?? [];
  if (!entityId) return null;

  return (
    <div
      className="attachments"
      onDragOver={e => {
        if (!canWrite) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        e.preventDefault();
        setOver(false);
        if (canWrite) void upload(e.dataTransfer.files);
      }}
      style={{ display: 'grid', gap: 10, outline: over ? '2px dashed var(--accent)' : undefined, outlineOffset: 4, borderRadius: 8 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13 }}>{t('attachments.title')}</strong>
        {max && <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{t('attachments.limit', { size: fmtBytes(max, t) })}</span>}
        <span className="sp" style={{ flex: 1 }} />
        <Button variant="ghost" size="sm" onClick={() => setArchived(a => !a)}>
          {t('attachments.showArchived')}
          {archived ? ' ✓' : ''}
        </Button>
        {canWrite && (
          <>
            <input ref={fileInput} type="file" multiple hidden onChange={e => { void upload(e.target.files); e.target.value = ''; }} />
            <Button size="sm" onClick={() => fileInput.current?.click()}>
              <Upload size={14} /> {t('attachments.choose')}
            </Button>
          </>
        )}
      </div>
      <input ref={versionInput} type="file" hidden onChange={e => { void addVersion(e.target.files?.[0]); e.target.value = ''; }} />

      {busy.map(name => (
        <div key={name} role="status" style={{ color: 'var(--text-2)', fontSize: 13 }}>
          {t('attachments.uploading', { name })}
        </div>
      ))}

      {!items.length && !list.isLoading ? (
        <EmptyState icon={<UploadCloud />} title={t('attachments.empty')}>
          {canWrite ? t('attachments.drop') : t('attachments.readOnly')}
        </EmptyState>
      ) : (
        <div style={{ display: 'grid', gap: 2 }}>
          {items.map(a => (
            <AttachmentLine
              key={a.id}
              a={a}
              canWrite={canWrite}
              expanded={open === a.id}
              memberName={memberName}
              onToggle={() => setOpen(open === a.id ? null : a.id)}
              onDownload={(v?: number) => guard(act.download(a.id, a.name, v))}
              onNewVersion={() => {
                versionFor.current = a.id;
                versionInput.current?.click();
              }}
              onRename={() => {
                setNewName(a.name);
                setRenaming(a);
              }}
              onArchive={() => setConfirm(a)}
              onRestore={() => guard(act.restore(a.id))}
            />
          ))}
        </div>
      )}

      <Dialog open={!!renaming} onOpenChange={o => !o && setRenaming(null)}>
        <DialogContent
          size="sm"
          title={t('attachments.renameTitle')}
          footer={
            <>
              <span className="sp" />
              <DialogClose asChild>
                <Button variant="ghost">{t('common.cancel')}</Button>
              </DialogClose>
              <Button
                disabled={!newName.trim()}
                onClick={() => {
                  const id = renaming!.id;
                  setRenaming(null);
                  void guard(act.rename(id, newName.trim()));
                }}
              >
                {t('common.save')}
              </Button>
            </>
          }
        >
          <Input value={newName} onChange={e => setNewName(e.target.value)} aria-label={t('attachments.name')} autoFocus />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={o => !o && setConfirm(null)}
        title={t('attachments.confirmArchive', { name: confirm?.name ?? '' })}
        description={t('attachments.confirmArchiveHint')}
        confirmLabel={t('attachments.archive')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => {
          const a = confirm!;
          setConfirm(null);
          void guard(act.archive(a.id).then(() => toast(t('attachments.archived', { name: a.name }), { action: { label: t('common.undo'), onClick: () => void guard(act.restore(a.id)) } })));
        }}
      />
    </div>
  );
}

interface LineProps {
  a: AttachmentRow;
  canWrite: boolean;
  expanded: boolean;
  memberName: (id: string | null) => string;
  onToggle: () => void;
  onDownload: (version?: number) => void;
  onNewVersion: () => void;
  onRename: () => void;
  onArchive: () => void;
  onRestore: () => void;
}

function AttachmentLine({ a, canWrite, expanded, memberName, onToggle, onDownload, onNewVersion, onRename, onArchive, onRestore }: LineProps) {
  const t = useT();
  const versions = useAttachmentVersions(a.id, expanded);
  const isArchived = !!a.archivedAt;
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px' }}>
        <IconButton size="sm" label={t('attachments.versions', { n: a.versionCount })} tooltip={false} onClick={onToggle} aria-expanded={expanded}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </IconButton>
        <button type="button" className="link" style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', color: 'var(--text)' }} onClick={() => onDownload()}>
          {a.name}
        </button>
        {a.versionCount > 1 && (
          <span style={{ color: 'var(--text-3)', fontSize: 12 }} title={t('attachments.versions', { n: a.versionCount })}>
            <History size={12} style={{ verticalAlign: -1 }} /> {t('attachments.versionNo', { n: a.currentVersion })}
          </span>
        )}
        <span style={{ color: 'var(--text-3)', fontSize: 12, minWidth: 64, textAlign: 'right' }}>{fmtBytes(a.sizeBytes, t)}</span>
        <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{memberName(a.createdBy)}</span>
        <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{fmtDateTime(a.createdAt)}</span>
        <Menu>
          <MenuTrigger asChild>
            <IconButton size="sm" label={t('attachments.options')} tooltip={false}>
              <Ellipsis size={14} />
            </IconButton>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem onSelect={() => onDownload()}>
              <Download size={14} /> {t('attachments.download')}
            </MenuItem>
            {canWrite && !isArchived && (
              <>
                <MenuItem onSelect={onNewVersion}>
                  <Upload size={14} /> {t('attachments.newVersion')}
                </MenuItem>
                <MenuItem onSelect={onRename}>
                  <Pencil size={14} /> {t('attachments.rename')}
                </MenuItem>
                <MenuSeparator />
                <MenuItem onSelect={onArchive} danger>
                  <Archive size={14} /> {t('attachments.archive')}
                </MenuItem>
              </>
            )}
            {canWrite && isArchived && (
              <MenuItem onSelect={onRestore}>
                <Undo2 size={14} /> {t('attachments.restore')}
              </MenuItem>
            )}
          </MenuContent>
        </Menu>
      </div>
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '6px 10px 8px 42px', display: 'grid', gap: 4 }}>
          {(versions.data ?? []).map(v => (
            <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
              <strong>{t('attachments.versionNo', { n: v.version })}</strong>
              {v.version === a.currentVersion && <span style={{ color: 'var(--text-3)' }}>{t('attachments.current')}</span>}
              <span style={{ color: 'var(--text-2)', flex: 1 }}>{v.comment || (v.hasContent ? '' : t('attachments.noContent'))}</span>
              <span style={{ color: 'var(--text-3)' }}>{fmtBytes(v.sizeBytes, t)}</span>
              <span style={{ color: 'var(--text-3)' }}>{memberName(v.createdBy)}</span>
              <span style={{ color: 'var(--text-3)' }}>{fmtDateTime(v.createdAt)}</span>
              <IconButton size="xs" label={t('attachments.downloadVersion')} disabled={!v.hasContent} onClick={() => onDownload(v.version)}>
                <Download size={13} />
              </IconButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
