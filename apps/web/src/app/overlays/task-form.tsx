/* Форма задачи (создание и редактирование) — порт taskModal / submitTask / editTask из overlays/modals.js и actions/actions.js */
import * as React from 'react';
import { useLocation } from 'react-router';
import { CircleAlert, Circle, Paperclip, Plus, X } from 'lucide-react';
import { Button, Dialog, DialogClose, DialogContent, Input, Switch, Textarea, toast } from '@/components/ui';
import type { Task } from '../data/types';
import { nextKey, useWorkspace } from '../data/store';
import { FILE_TYPES, canSee, fileKind, fileSize, project, visibleProjects } from '../data/selectors';
import { MOD } from '../lib/platform';
import { KindIcon } from '../components/files-view';
import { FormChips, type TaskFormState } from './task-form-chips';
import { TaskEditorCtx, useTaskDrawer } from './task-drawer';

export type TaskDefaults = Partial<Pick<Task, 'project' | 'status' | 'assignee' | 'priority' | 'due' | 'labels'>>;

export interface TaskFormApi {
  /** Открыть форму новой задачи с предзаполненными полями */
  open(defaults?: TaskDefaults): void;
  /** Открыть ту же форму в режиме редактирования существующей задачи */
  edit(taskId: string): void;
}

const Ctx = React.createContext<TaskFormApi | null>(null);
const uid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function TaskFormProvider({ children }: { children: React.ReactNode }) {
  const { data, dispatch } = useWorkspace();
  const drawer = useTaskDrawer();
  const location = useLocation();
  const [isOpen, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<TaskFormState | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // «Create more» помнится между открытиями, как S.ui.form.more
  const [more, setMore] = React.useState(false);
  // id редактируемой задачи; null — форма создания
  const [editId, setEditId] = React.useState<string | null>(null);
  const editorRef = React.useContext(TaskEditorCtx);
  const titleRef = React.useRef<HTMLInputElement>(null);
  const openedAt = React.useRef(0);
  const subRef = React.useRef<HTMLInputElement>(null);
  const latest = React.useRef({ data, pathname: location.pathname });
  latest.current = { data, pathname: location.pathname };

  const open = React.useCallback((defaults: TaskDefaults = {}) => {
    const { data: d, pathname } = latest.current;
    const visible = visibleProjects(d).filter(p => canSee(d, p));
    const cur = pathname.match(/^\/projects\/([^/]+)/)?.[1];
    const want = defaults.project ?? cur ?? visible.find(p => p.status !== 'complete')?.id;
    const pid = canSee(d, project(d, want)) ? want! : (visible[0]?.id ?? 'p1');
    setForm({
      title: '',
      desc: '',
      project: pid,
      status: defaults.status ?? 'todo',
      assignee: defaults.assignee !== undefined ? defaults.assignee : d.me,
      priority: defaults.priority === undefined ? 5 : defaults.priority,
      due: defaults.due ?? null,
      start: null,
      labels: defaults.labels ?? [],
      recur: null,
      subtasks: [],
      files: [],
    });
    setError(null);
    setEditId(null);
    setOpen(true);
  }, []);

  const edit = React.useCallback((taskId: string) => {
    const t = latest.current.data.tasks.find(x => x.id === taskId);
    if (!t) return;
    setForm({
      title: t.title,
      desc: plain(t.desc || ''),
      project: t.project,
      status: t.status,
      assignee: t.assignee,
      priority: t.priority,
      due: t.due,
      start: t.start,
      labels: [...t.labels],
      recur: t.recur,
      subtasks: t.subtasks.map(x => ({ id: x.id, title: x.title })),
      files: [],
    });
    setError(null);
    setEditId(taskId);
    setOpen(true);
  }, []);
  const api = React.useMemo<TaskFormApi>(() => ({ open, edit }), [open, edit]);
  // «Edit» и клавиша E в карточке задачи вызывают форму через мост из TaskDrawerProvider
  React.useEffect(() => {
    if (!editorRef) return;
    editorRef.current = edit;
    return () => {
      editorRef.current = null;
    };
  }, [editorRef, edit]);

  // Горячая клавиша N — новая задача (не в полях ввода и не поверх другого окна)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable]') || document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      open();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const set = (patch: Partial<TaskFormState>) => setForm(f => f && { ...f, ...patch });

  const submit = () => {
    if (!form) return;
    const title = form.title.trim();
    if (!title) {
      setError('Give the task a name');
      titleRef.current?.focus();
      return;
    }
    if (editId) {
      const t = data.tasks.find(x => x.id === editId);
      if (!t) return setOpen(false);
      const same = t.subtasks.length === form.subtasks.length && t.subtasks.every((x, i) => x.id === form.subtasks[i].id);
      dispatch({
        type: 'task/update',
        id: t.id,
        patch: {
          title,
          project: form.project,
          status: form.status,
          assignee: form.assignee,
          priority: form.priority,
          due: form.due,
          start: form.start && form.due && form.start > form.due ? form.due : form.start,
          labels: form.labels,
          recur: form.recur,
          // Оставленные подзадачи сохраняют своё состояние и вложенность, новые добавляются открытыми
          ...(same ? {} : { subtasks: form.subtasks.map(s => t.subtasks.find(x => x.id === s.id) ?? { ...s, done: false, subtasks: [] }) }),
          ...(form.desc !== plain(t.desc || '') ? { desc: form.desc ? `<p>${esc(form.desc)}</p>` : '' } : {}),
        },
      });
      form.files.forEach(f => dispatch({ type: 'task/attach', id: t.id, file: f }));
      setOpen(false);
      toast('Changes saved');
      return;
    }
    const id = uid('t');
    const key = nextKey(data, form.project);
    const attachments = form.files.map(x => ({ id: uid('a'), name: x.name, type: fileKind(x.name), size: x.size, by: data.me, at: Date.now() }));
    dispatch({
      type: 'task/create',
      task: {
        id,
        key,
        title,
        project: form.project,
        status: form.status,
        assignee: form.assignee,
        priority: form.priority,
        due: form.due,
        start: form.start && form.due && form.start > form.due ? form.due : form.start,
        labels: form.labels,
        recur: form.recur,
        subtasks: form.subtasks.map(s => ({ ...s, done: false, subtasks: [] })),
        desc: form.desc ? `<p>${esc(form.desc)}</p>` : '',
        attachments,
      },
    });
    attachments.forEach(a => dispatch({ type: 'file/add', file: { project: form.project, name: a.name, size: a.size, task: id } }));
    if (more) {
      setForm({ ...form, title: '', desc: '', subtasks: [], files: [] });
      setError(null);
      setTimeout(() => titleRef.current?.focus(), 0);
      toast(`Created ${key}`, { duration: 2000 });
      return;
    }
    setOpen(false);
    toast(`Created ${key} in ${project(data, form.project)?.name}`, { action: { label: 'Open', onClick: () => drawer.open(id) } });
  };

  const addSub = () => {
    const v = subRef.current?.value.trim();
    if (!v || !form) return;
    set({ subtasks: [...form.subtasks, { id: uid('s'), title: v }] });
    subRef.current!.value = '';
    subRef.current!.focus();
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      <Dialog open={isOpen} onOpenChange={setOpen}>
        {form && (
          <DialogContent
            title={editId ? 'Edit task' : 'New task'}
            description={editId ? <span className="mono">{data.tasks.find(x => x.id === editId)?.key}</span> : undefined}
            className="[&>.modal-b]:!gap-3"
            onOpenAutoFocus={e => {
              e.preventDefault();
              titleRef.current?.focus();
              openedAt.current = Date.now();
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                submit();
              }
            }}
            footer={
              <>
                {!editId && (
                  <label className="row" style={{ gap: 8, fontSize: 12.5, color: 'var(--text-2)', cursor: 'pointer' }}>
                    <Switch id="f-more" checked={more} onChange={e => setMore(e.target.checked)} />
                    Create more
                  </label>
                )}
                <span className="sp" />
                <span className="faint hide-m" style={{ fontSize: 11.5 }}>
                  <kbd>{MOD}</kbd> <kbd>↵</kbd>
                </span>
                <DialogClose asChild>
                  <Button variant="secondary">Cancel</Button>
                </DialogClose>
                <Button variant="primary" onClick={submit} id="f-submit">
                  {editId ? 'Save changes' : 'Create task'}
                </Button>
              </>
            }
          >
            <form className="contents" onSubmit={e => e.preventDefault()}>
              <div className="field">
                <label className="sr-only" htmlFor="f-title">
                  Task name
                </label>
                <Input
                  ref={titleRef}
                  id="f-title"
                  size="lg"
                  invalid={!!error}
                  aria-describedby="f-title-err"
                  placeholder="Task name"
                  value={form.title}
                  onFocus={e => {
                    // Фокус-ловушка Radix выделяет весь текст при возврате фокуса; сразу после открытия редактирования ставим курсор в конец
                    const el = e.currentTarget;
                    if (editId && Date.now() - openedAt.current < 600) requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
                  }}
                  style={{ fontSize: 15, fontWeight: 500 }}
                  onChange={e => {
                    set({ title: e.target.value });
                    if (error && e.target.value.trim()) setError(null);
                  }}
                />
                {error && (
                  <span className="err" id="f-title-err">
                    <CircleAlert size={12} />
                    {error}
                  </span>
                )}
              </div>
              <div className="field">
                <label className="sr-only" htmlFor="f-desc">
                  Description
                </label>
                <Textarea id="f-desc" placeholder="Add a description… (optional)" rows={3} value={form.desc} onChange={e => set({ desc: e.target.value })} />
              </div>
              <FormChips form={form} set={set} />
              <div className="field">
                <span className="label">Subtasks</span>
                {form.subtasks.map(s => (
                  <div key={s.id} className="subt" style={{ padding: '0 4px' }}>
                    <Circle size={13} />
                    <span className="s">{s.title}</span>
                    <button type="button" className="ibtn ibtn-xs x" style={{ opacity: 1 }} aria-label="Remove" onClick={() => set({ subtasks: form.subtasks.filter(x => x.id !== s.id) })}>
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <div className="inwrap">
                  <Plus size={14} />
                  <input
                    ref={subRef}
                    className="input"
                    id="f-sub"
                    placeholder="Add a subtask and press Enter"
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                        e.preventDefault();
                        addSub();
                      }
                    }}
                  />
                </div>
              </div>
              <div className="field">
                <span className="label">Attachments</span>
                {form.files.length > 0 && (
                  <div className="col" style={{ gap: 4 }}>
                    {form.files.map((x, i) => {
                      const k = fileKind(x.name);
                      return (
                        <div key={i} className="upl" style={{ padding: '6px 10px' }}>
                          <span className="ftype" style={{ '--c': FILE_TYPES[k].c, width: 22, height: 22 } as React.CSSProperties}>
                            <KindIcon kind={k} size={12} />
                          </span>
                          <span className="grow trunc">{x.name}</span>
                          <span className="faint" style={{ fontSize: 11.5 }}>
                            {x.size}
                          </span>
                          <button type="button" className="ibtn ibtn-xs" aria-label="Remove" onClick={() => set({ files: form.files.filter((_, j) => j !== i) })}>
                            <X size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <label className="dropzone" style={{ padding: 10 }}>
                  <Paperclip size={14} />
                  <span>Attach files</span>
                  <input
                    type="file"
                    multiple
                    hidden
                    onChange={e => {
                      const added = [...(e.target.files ?? [])].map(f => ({ name: f.name, size: fileSize(f.size) }));
                      e.target.value = '';
                      set({ files: [...form.files, ...added] });
                    }}
                  />
                </label>
              </div>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </Ctx.Provider>
  );
}

export function useTaskForm() {
  const api = React.useContext(Ctx);
  if (!api) throw new Error('useTaskForm: нет TaskFormProvider');
  return api;
}
