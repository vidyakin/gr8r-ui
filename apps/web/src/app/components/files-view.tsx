/* Файлы проекта — порт filesHtml из views/files.js (+ filePrev, previewFile, renameFile, dupFile, delFile, handleFiles) */
import * as React from 'react';
import { Copy, Ellipsis, Eye, File, FileCode, FileSpreadsheet, FileText, FolderArchive, FolderOpen, Image, LayoutGrid, Link, Link2, List, PenTool, Pencil, Search, SearchX, Trash2, Upload, UploadCloud } from 'lucide-react';
import { Button, ConfirmDialog, ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, Dialog, DialogClose, DialogContent, EmptyState, IconButton, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Progress, Segmented, Select, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { useWorkspace } from '../data/store';
import { FILE_TYPES, fileKind, fileSize, member, task as findTask } from '../data/selectors';
import type { FileKind, Project, ProjectFile } from '../data/types';
import { ago } from '../lib/dates';
import { MemberAvatar, useTaskActions } from './workspace';

const KIND_ICON: Record<string, typeof File> = {
  'pen-tool': PenTool,
  'file-text': FileText,
  'folder-archive': FolderArchive,
  image: Image,
  'file-spreadsheet': FileSpreadsheet,
  'file-code': FileCode,
  file: File,
};

export function KindIcon({ kind, size }: { kind: FileKind; size: number }) {
  const I = KIND_ICON[FILE_TYPES[kind].i] ?? File;
  return <I size={size} />;
}

const cvar = (c: string) => ({ '--c': c }) as React.CSSProperties;

/** Мини-превью файла (filePrev): условная «страница» нужного вида + расширение */
export function FilePreview({ file, style }: { file: ProjectFile; style?: React.CSSProperties }) {
  const t = FILE_TYPES[file.type] ?? FILE_TYPES.other;
  const mix = (n: number) => `color-mix(in srgb,${t.c} ${n}%,var(--surface))`;
  let art: React.ReactNode;
  if (file.type === 'img')
    art = (
      <div className="art" style={{ padding: 0, overflow: 'hidden', background: `linear-gradient(135deg,${mix(35)},${mix(10)})` }}>
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
          <path d="M0 60 L30 28 L52 46 L70 32 L100 58 L100 60Z" fill={mix(45)} />
          <circle cx="76" cy="16" r="7" fill={mix(30)} />
        </svg>
      </div>
    );
  else if (file.type === 'sheet')
    art = (
      <div className="art" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 3 }}>
        {Array.from({ length: 20 }, (_, i) => (
          <i key={i} />
        ))}
      </div>
    );
  else if (file.type === 'fig')
    art = (
      <div className="art" style={{ flexDirection: 'row', gap: 6 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <i className="h" />
          <i />
          <i style={{ width: '70%' }} />
          <i style={{ height: 18, background: mix(20) }} />
        </div>
        <div style={{ width: '34%', borderRadius: 3, background: mix(14) }} />
      </div>
    );
  else if (file.type === 'zip')
    art = (
      <div style={{ color: t.c }}>
        <FolderArchive size={30} />
      </div>
    );
  else
    art = (
      <div className="art">
        <i className="h" />
        <i />
        <i />
        <i style={{ width: '80%' }} />
        <i />
        <i style={{ width: '60%' }} />
      </div>
    );
  const ext = (file.name.split('.').pop() || '').slice(0, 4);
  return (
    <div className="fprev" style={style}>
      {art}
      <span className="ext" style={cvar(t.c)}>
        {ext}
      </span>
    </div>
  );
}

interface Upload {
  id: string;
  name: string;
  size: string;
  pct: number;
}

type FileDialog = { kind: 'preview' | 'rename' | 'delete'; file: ProjectFile } | null;

interface MenuApi {
  preview: (f: ProjectFile) => void;
  rename: (f: ProjectFile) => void;
  copyLink: (f: ProjectFile) => void;
  duplicate: (f: ProjectFile) => void;
  remove: (f: ProjectFile) => void;
}

/** Пункты меню файла — общие для «⋯» и контекстного меню (ctxMenu('file')) */
function FileMenuItems({ file, api, context }: { file: ProjectFile; api: MenuApi; context?: boolean }) {
  const Item = context ? ContextMenuItem : MenuItem;
  const Sep = context ? ContextMenuSeparator : MenuSeparator;
  const tt = useT();
  return (
    <>
      <Item icon={<Eye size={15} />} onSelect={() => api.preview(file)}>
        {tt('views.files.preview')}
      </Item>
      <Item icon={<Pencil size={15} />} onSelect={() => api.rename(file)}>
        {tt('views.files.rename')}
      </Item>
      <Item icon={<Link2 size={15} />} onSelect={() => api.copyLink(file)}>
        {tt('views.files.copyLink')}
      </Item>
      <Item icon={<Copy size={15} />} onSelect={() => api.duplicate(file)}>
        {tt('views.files.duplicate')}
      </Item>
      <Sep />
      <Item icon={<Trash2 size={15} />} danger onSelect={() => api.remove(file)}>
        {tt('common.delete')}
      </Item>
    </>
  );
}

function FileMore({ file, api, className, size }: { file: ProjectFile; api: MenuApi; className?: string; size: 'xs' | 'sm' }) {
  const tt = useT();
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton size={size} label={tt('views.files.options')} tooltip={false} className={className} onClick={stop} onKeyDown={stop}>
          <Ellipsis size={size === 'xs' ? 13 : 14} />
        </IconButton>
      </MenuTrigger>
      <MenuContent align="end" onClick={stop} onKeyDown={stop}>
        <FileMenuItems file={file} api={api} />
      </MenuContent>
    </Menu>
  );
}

/** Вкладка Files страницы проекта: поиск, фильтр по типу, сортировка, сетка/список, загрузка, превью и меню файла */
export function ProjectFilesTab({ project }: { project: Project }) {
  const { data, dispatch } = useWorkspace();
  const tt = useT();
  const taskActions = useTaskActions();
  const [q, setQ] = React.useState('');
  const [type, setType] = React.useState<'all' | FileKind>('all');
  const [sort, setSort] = React.useState<'date' | 'name' | 'type'>('date');
  const [view, setView] = React.useState<'grid' | 'list'>('grid');
  const [uploads, setUploads] = React.useState<Upload[]>([]);
  const [over, setOver] = React.useState(false);
  const [dialog, setDialog] = React.useState<FileDialog>(null);
  const [newName, setNewName] = React.useState('');
  const timers = React.useRef<number[]>([]);
  React.useEffect(() => () => timers.current.forEach(clearInterval), []);

  const needle = q.toLowerCase();
  const files = data.files
    .filter(f => f.project === project.id && (!needle || f.name.toLowerCase().includes(needle)) && (type === 'all' || f.type === type))
    .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'type' ? a.type.localeCompare(b.type) : b.at - a.at));
  const filtered = !!q || type !== 'all';

  // Загрузка в оригинале — имитация прогресса, по завершении файл попадает в данные
  const handleFiles = (list: FileList | null) => {
    if (!list || !list.length) return;
    [...list].forEach(file => {
      const up: Upload = { id: `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: file.name, size: fileSize(file.size), pct: 0 };
      setUploads(u => [...u, up]);
      let pct = 0;
      const iv = window.setInterval(() => {
        pct = Math.min(100, pct + 9 + Math.round(Math.random() * 22));
        if (pct < 100) return setUploads(u => u.map(x => (x.id === up.id ? { ...x, pct } : x)));
        clearInterval(iv);
        setUploads(u => u.filter(x => x.id !== up.id));
        dispatch({ type: 'file/add', file: { project: project.id, name: up.name, size: up.size } });
        toast(tt('views.files.uploaded', { name: up.name }));
      }, 220);
      timers.current.push(iv);
    });
  };

  const api: MenuApi = {
    preview: f => setDialog({ kind: 'preview', file: f }),
    rename: f => {
      setNewName(f.name);
      setDialog({ kind: 'rename', file: f });
    },
    copyLink: f => {
      navigator.clipboard?.writeText(`${location.origin}${location.pathname}#/file/${f.id}`).catch(() => {});
      toast.info(tt('common.linkCopied'), { duration: 1800 });
    },
    duplicate: f => {
      dispatch({ type: 'file/duplicate', id: f.id });
      toast(tt('views.files.duplicated'));
    },
    remove: f => setDialog({ kind: 'delete', file: f }),
  };

  const deleteFile = (f: ProjectFile) => {
    const index = data.files.findIndex(x => x.id === f.id);
    dispatch({ type: 'file/delete', id: f.id });
    toast(tt('views.files.deleted', { name: f.name }), { action: { label: tt('common.undo'), onClick: () => dispatch({ type: 'file/restore', file: f, index }) } });
  };
  const submitRename = () => {
    const v = newName.trim();
    if (dialog?.kind === 'rename' && v) dispatch({ type: 'file/rename', id: dialog.file.id, name: v });
    setDialog(null);
  };
  const openTask = (id: string) => {
    const t = findTask(data, id);
    if (t) taskActions.open(t);
  };

  const first = (id: string) => member(data, id)?.name.split(' ')[0];
  const onKey = (f: ProjectFile) => (e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
      e.preventDefault();
      api.preview(f);
    }
  };

  let body: React.ReactNode;
  if (!files.length)
    body = (
      <EmptyState icon={filtered ? <SearchX /> : <FolderOpen />} title={filtered ? tt('common.noResults') : tt('views.files.empty')}>
        {filtered ? tt('views.files.emptyFiltered') : tt('views.files.emptyHint')}
      </EmptyState>
    );
  else if (view === 'grid')
    body = (
      <div className="fgrid">
        {files.map(f => (
          <ContextMenu key={f.id}>
            <ContextMenuTrigger asChild>
              <div className="fcard" role="button" tabIndex={0} onClick={() => api.preview(f)} onKeyDown={onKey(f)}>
                <FilePreview file={f} />
                <div className="fi">
                  <span className="fn trunc">{f.name}</span>
                  <span className="fm">
                    {f.size} · {first(f.by)} · {ago(f.at)}
                  </span>
                </div>
                <FileMore file={f} api={api} size="xs" className="more" />
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <FileMenuItems file={f} api={api} context />
            </ContextMenuContent>
          </ContextMenu>
        ))}
      </div>
    );
  else
    body = (
      <div className="panel" style={{ overflowX: 'auto' }}>
        <table className="perm-t" style={{ minWidth: 680 }}>
          <thead>
            <tr>
              <th style={{ paddingLeft: 14 }}>{tt('views.files.name')}</th>
              <th style={{ textAlign: 'left' }}>{tt('views.files.type')}</th>
              <th style={{ textAlign: 'left' }}>{tt('views.files.size')}</th>
              <th style={{ textAlign: 'left' }}>{tt('views.files.uploadedBy')}</th>
              <th style={{ textAlign: 'left' }}>{tt('views.files.date')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {files.map(f => {
              const t = f.task ? findTask(data, f.task) : undefined;
              return (
                <ContextMenu key={f.id}>
                  <ContextMenuTrigger asChild>
                    <tr>
                      <td style={{ paddingLeft: 14 }}>
                        <span className="row">
                          <span className="ftype" style={cvar(FILE_TYPES[f.type].c)}>
                            <KindIcon kind={f.type} size={14} />
                          </span>
                          <span style={{ fontWeight: 500 }}>{f.name}</span>
                          {t && (
                            <button className="badge" onClick={() => openTask(t.id)}>
                              <Link size={10} />
                              {t.key}
                            </button>
                          )}
                        </span>
                      </td>
                      <td style={{ textAlign: 'left' }} className="muted">
                        {FILE_TYPES[f.type].n}
                      </td>
                      <td style={{ textAlign: 'left' }} className="num muted">
                        {f.size}
                      </td>
                      <td style={{ textAlign: 'left' }}>
                        <span className="row">
                          <MemberAvatar id={f.by} size="sm" tooltip={false} />
                          {member(data, f.by)?.name}
                        </span>
                      </td>
                      <td style={{ textAlign: 'left' }} className="muted">
                        {ago(f.at)}
                      </td>
                      <td>
                        <FileMore file={f} api={api} size="sm" />
                      </td>
                    </tr>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <FileMenuItems file={f} api={api} context />
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </tbody>
        </table>
      </div>
    );

  const previewing = dialog?.kind === 'preview' ? dialog.file : null;
  const previewTask = previewing?.task ? findTask(data, previewing.task) : undefined;
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
    e.target.value = '';
  };
  return (
    <>
      <div className="toolbar">
        <Input size="sm" icon={<Search size={13} />} className="!w-[200px]" placeholder={tt('views.files.searchPlaceholder')} aria-label={tt('views.files.searchPlaceholder')} value={q} onChange={e => setQ(e.target.value)} />
        <Select
          aria-label={tt('views.files.filterByType')}
          className="!h-[26px] !w-auto [&_.chev]:!mr-[-21px] !text-[12px]"
          value={type}
          onValueChange={v => setType(v as 'all' | FileKind)}
          options={[
            { value: 'all', label: tt('views.files.allTypes') },
            ...(Object.entries(FILE_TYPES) as [FileKind, (typeof FILE_TYPES)[FileKind]][]).filter(([k]) => k !== 'other').map(([k, v]) => ({ value: k, label: v.n })),
          ]}
        />
        <Select
          aria-label={tt('views.files.sort')}
          className="!h-[26px] !w-auto [&_.chev]:!mr-[-21px] !text-[12px]"
          value={sort}
          onValueChange={v => setSort(v as typeof sort)}
          options={[
            { value: 'date', label: tt('views.files.sortNewest') },
            { value: 'name', label: tt('views.files.sortName') },
            { value: 'type', label: tt('views.files.sortType') },
          ]}
        />
        <span className="sp" />
        <Segmented
          aria-label={tt('views.files.layout')}
          value={view}
          onValueChange={setView}
          items={[
            { value: 'grid', icon: <LayoutGrid size={13} />, 'aria-label': tt('views.files.viewGrid') },
            { value: 'list', icon: <List size={13} />, 'aria-label': tt('views.files.viewList') },
          ]}
        />
        <label className="btn btn-primary btn-sm" style={{ cursor: 'pointer' }}>
          <Upload size={13} />
          {tt('views.files.upload')}
          <input type="file" multiple hidden onChange={pick} />
        </label>
      </div>
      <div className="page wide" style={{ paddingTop: 16 }}>
        <label
          className={'dropzone' + (over ? ' over' : '')}
          style={{ marginBottom: 16 }}
          onDragOver={e => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={e => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
          onDrop={e => {
            e.preventDefault();
            setOver(false);
            handleFiles(e.dataTransfer.files);
          }}
        >
          <UploadCloud size={18} />
          <span>
            {tt('views.files.dropHint')}{' '}
            <span className="link">{tt('views.files.browse')}</span> — {tt('views.files.maxSize')}
          </span>
          <input type="file" multiple hidden onChange={pick} />
        </label>
        {!!uploads.length && (
          <div className="col" style={{ gap: 6, marginBottom: 16 }}>
            {uploads.map(x => (
              <div key={x.id} className="upl">
                <span className="ftype" style={cvar(FILE_TYPES[fileKind(x.name)].c)}>
                  <KindIcon kind={fileKind(x.name)} size={14} />
                </span>
                <div className="grow">
                  <div className="row">
                    <span className="trunc" style={{ fontWeight: 500 }}>
                      {x.name}
                    </span>
                    <span className="sp" />
                    <span className="faint num" style={{ fontSize: 11.5 }}>
                      {x.pct}%
                    </span>
                  </div>
                  <Progress value={x.pct} className="mt-1.5" aria-label={tt('views.files.uploading', { name: x.name })} />
                </div>
              </div>
            ))}
          </div>
        )}
        {body}
      </div>

      <Dialog open={!!previewing} onOpenChange={o => !o && setDialog(null)}>
        {previewing && (
          <DialogContent
            size="lg"
            title={previewing.name}
            description={tt('views.files.previewDesc', { type: FILE_TYPES[previewing.type].n, size: previewing.size, who: member(data, previewing.by)?.name || tt('views.activity.you'), when: ago(previewing.at) })}
            footer={
              <>
                <Button variant="secondary" onClick={() => api.copyLink(previewing)}>
                  <Link size={14} />
                  {tt('views.files.copyLink')}
                </Button>
                <span className="sp" />
                <DialogClose asChild>
                  <Button>{tt('common.close')}</Button>
                </DialogClose>
              </>
            }
          >
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
              <FilePreview file={previewing} style={{ aspectRatio: '16/9' }} />
            </div>
            {previewTask && (
              <div className="row faint" style={{ fontSize: 12.5 }}>
                <Link size={13} />
                {tt('views.files.attachedTo')}{' '}
                <button className="link" onClick={() => openTask(previewTask.id)}>
                  {previewTask.title}
                </button>
              </div>
            )}
          </DialogContent>
        )}
      </Dialog>
      <Dialog open={dialog?.kind === 'rename'} onOpenChange={o => !o && setDialog(null)}>
        <DialogContent
          size="sm"
          title={tt('views.files.renameTitle')}
          footer={
            <>
              <span className="sp" />
              <DialogClose asChild>
                <Button variant="ghost">{tt('common.cancel')}</Button>
              </DialogClose>
              <Button onClick={submitRename}>{tt('common.save')}</Button>
            </>
          }
        >
          <form
            className="field"
            onSubmit={e => {
              e.preventDefault();
              submitRename();
            }}
          >
            <label className="label" htmlFor="file-name">
              {tt('views.files.name')}
            </label>
            <input className="input" id="file-name" autoFocus value={newName} onChange={e => setNewName(e.target.value)} />
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={dialog?.kind === 'delete'}
        onOpenChange={o => !o && setDialog(null)}
        danger
        title={tt('views.files.deleteTitle')}
        description={
          dialog?.kind === 'delete'
            ? dialog.file.task
              ? tt('views.files.deleteDescTask', { name: dialog.file.name })
              : tt('views.files.deleteDesc', { name: dialog.file.name })
            : undefined
        }
        confirmLabel={tt('views.files.deleteConfirm')}
        cancelLabel={tt('common.cancel')}
        onConfirm={() => dialog?.kind === 'delete' && deleteFile(dialog.file)}
      />
    </>
  );
}
