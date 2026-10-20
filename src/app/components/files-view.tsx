/* Файлы проекта — порт filesHtml из views/files.js (+ filePrev, previewFile, renameFile, dupFile, delFile, handleFiles) */
import * as React from 'react';
import { Copy, Ellipsis, Eye, File, FileCode, FileSpreadsheet, FileText, FolderArchive, FolderOpen, Image, LayoutGrid, Link, Link2, List, PenTool, Pencil, Search, SearchX, Trash2, Upload, UploadCloud } from 'lucide-react';
import { Button, ConfirmDialog, ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, Dialog, DialogClose, DialogContent, EmptyState, IconButton, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Progress, Segmented, Select, toast } from '@/components/ui';
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

function KindIcon({ kind, size }: { kind: FileKind; size: number }) {
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
  return (
    <>
      <Item icon={<Eye size={15} />} onSelect={() => api.preview(file)}>
        Preview
      </Item>
      <Item icon={<Pencil size={15} />} onSelect={() => api.rename(file)}>
        Rename
      </Item>
      <Item icon={<Link2 size={15} />} onSelect={() => api.copyLink(file)}>
        Copy link
      </Item>
      <Item icon={<Copy size={15} />} onSelect={() => api.duplicate(file)}>
        Duplicate
      </Item>
      <Sep />
      <Item icon={<Trash2 size={15} />} danger onSelect={() => api.remove(file)}>
        Delete
      </Item>
    </>
  );
}

function FileMore({ file, api, className, size }: { file: ProjectFile; api: MenuApi; className?: string; size: 'xs' | 'sm' }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton size={size} label="File options" tooltip={false} className={className} onClick={stop} onKeyDown={stop}>
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
        toast(`Uploaded ${up.name}`);
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
      toast.info('Link copied', { duration: 1800 });
    },
    duplicate: f => {
      dispatch({ type: 'file/duplicate', id: f.id });
      toast('File duplicated');
    },
    remove: f => setDialog({ kind: 'delete', file: f }),
  };

  const deleteFile = (f: ProjectFile) => {
    const index = data.files.findIndex(x => x.id === f.id);
    dispatch({ type: 'file/delete', id: f.id });
    toast(`Deleted ${f.name}`, { action: { label: 'Undo', onClick: () => dispatch({ type: 'file/restore', file: f, index }) } });
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
      <EmptyState icon={filtered ? <SearchX /> : <FolderOpen />} title={filtered ? 'No results found' : 'No files yet'}>
        {filtered ? 'No files match your search.' : 'Upload designs, documents, and assets to share them with the project.'}
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
              <th style={{ paddingLeft: 14 }}>Name</th>
              <th style={{ textAlign: 'left' }}>Type</th>
              <th style={{ textAlign: 'left' }}>Size</th>
              <th style={{ textAlign: 'left' }}>Uploaded by</th>
              <th style={{ textAlign: 'left' }}>Date</th>
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
        <Input size="sm" icon={<Search size={13} />} className="!w-[200px]" placeholder="Search files" aria-label="Search files" value={q} onChange={e => setQ(e.target.value)} />
        <Select
          aria-label="Filter by type"
          className="!h-[26px] !w-auto [&_.chev]:!mr-[-21px] !text-[12px]"
          value={type}
          onValueChange={v => setType(v as 'all' | FileKind)}
          options={[
            { value: 'all', label: 'All types' },
            ...(Object.entries(FILE_TYPES) as [FileKind, (typeof FILE_TYPES)[FileKind]][]).filter(([k]) => k !== 'other').map(([k, v]) => ({ value: k, label: v.n })),
          ]}
        />
        <Select
          aria-label="Sort"
          className="!h-[26px] !w-auto [&_.chev]:!mr-[-21px] !text-[12px]"
          value={sort}
          onValueChange={v => setSort(v as typeof sort)}
          options={[
            { value: 'date', label: 'Sort: Newest' },
            { value: 'name', label: 'Sort: Name' },
            { value: 'type', label: 'Sort: Type' },
          ]}
        />
        <span className="sp" />
        <Segmented
          aria-label="Layout"
          value={view}
          onValueChange={setView}
          items={[
            { value: 'grid', icon: <LayoutGrid size={13} />, 'aria-label': 'grid view' },
            { value: 'list', icon: <List size={13} />, 'aria-label': 'list view' },
          ]}
        />
        <label className="btn btn-primary btn-sm" style={{ cursor: 'pointer' }}>
          <Upload size={13} />
          Upload
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
            Drop files here or <span className="link">browse</span> — up to 250 MB each
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
                  <Progress value={x.pct} className="mt-1.5" aria-label={`Uploading ${x.name}`} />
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
            description={`${FILE_TYPES[previewing.type].n} · ${previewing.size} · Uploaded by ${member(data, previewing.by)?.name || 'you'} ${ago(previewing.at)}`}
            footer={
              <>
                <Button variant="secondary" onClick={() => api.copyLink(previewing)}>
                  <Link size={14} />
                  Copy link
                </Button>
                <span className="sp" />
                <DialogClose asChild>
                  <Button>Close</Button>
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
                Attached to{' '}
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
          title="Rename file"
          footer={
            <>
              <span className="sp" />
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button onClick={submitRename}>Save</Button>
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
              File name
            </label>
            <input className="input" id="file-name" autoFocus value={newName} onChange={e => setNewName(e.target.value)} />
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={dialog?.kind === 'delete'}
        onOpenChange={o => !o && setDialog(null)}
        danger
        title="Delete file?"
        description={dialog?.kind === 'delete' ? `${dialog.file.name} will be removed from the project${dialog.file.task ? ' and its task' : ''}.` : undefined}
        confirmLabel="Delete file"
        cancelLabel="Cancel"
        onConfirm={() => dialog?.kind === 'delete' && deleteFile(dialog.file)}
      />
    </>
  );
}
