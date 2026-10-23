/* Панель карточки задачи — порт drawerHtml / commentHtml из overlays/drawer.js.
   Состояние (какая задача открыта, режим, черновики, загрузки) живёт в TaskDrawerProvider (overlays/task-drawer.tsx). */
import * as React from 'react';
import {
  AtSign,
  Bold,
  Building2,
  CalendarArrowUp,
  Calendar as CalendarIcon,
  Circle,
  CircleCheck,
  CircleDot,
  ClockAlert,
  Ellipsis,
  Folder,
  GitBranch,
  Heading,
  Italic,
  Link as LinkIcon,
  Link2,
  List,
  ListOrdered,
  Maximize2,
  Minimize2,
  Paperclip,
  Plus,
  Repeat,
  SignalHigh,
  Star,
  Tag,
  Upload as UploadIcon,
  User,
  X,
  PictureInPicture2,
  PenTool,
  FileText,
  FolderArchive,
  Image as ImageIcon,
  FileSpreadsheet,
  FileCode,
  File as FileIcon,
} from 'lucide-react';
import { Button, Dialog, DialogClose, DialogContent, IconButton, Label, Menu, MenuContent, MenuTrigger, Progress, Tab, TabsList, Tabs, TabsContent, toast } from '@/components/ui';
import { StatusIcon } from '@/components/gr8r/task';
import { cn } from '@/lib/utils';
import { useWorkspace, type TaskPatch } from '../../data/store';
import { FILE_TYPES, LABELS, commentsOf, isOverdue, member, project, projectColor, task as findTask, fileKind } from '../../data/selectors';
import { ago, diffDays, fmtDate, parse, today } from '../../lib/dates';
import { MOD } from '../../lib/platform';
import type { FileKind, LabelId, Project, ProjectFile, Task } from '../../data/types';
import { AssigneeField, CustomerField, DueField, PriorityField, StatusField } from '../fields';
import { useCustomRows } from '../../meta/custom-fields';
import { CommentItem } from '../conversation';
import { FilePreview } from '../files-view';
import { ProjectDot } from '../project';
import { MemberAvatar, useTaskActions } from '../workspace';
import { AutoTextarea, DatePopover, ListPopover, RichText, runFormat } from './pickers';
import { SubtaskView } from './subtask-view';
import { SubtaskSection } from './subtask-tree';
import { TimeBlock } from './time-block';
import { OperationBlock } from '../../production/OperationBlock';
import { findSub } from '../../data/subtasks';
import { TaskMenuItems } from './task-menu';
import { useT } from '@/i18n';

export interface UploadItem {
  id: string;
  name: string;
  size: string;
  task: string;
  pct: number;
}

const FILE_ICON: Record<string, typeof FileIcon> = {
  'pen-tool': PenTool,
  'file-text': FileText,
  'folder-archive': FolderArchive,
  image: ImageIcon,
  'file-spreadsheet': FileSpreadsheet,
  'file-code': FileCode,
  file: FileIcon,
};
const KindIcon = ({ kind, size }: { kind: FileKind; size: number }) => {
  const I = FILE_ICON[FILE_TYPES[kind]?.i ?? 'file'] ?? FileIcon;
  return <I size={size} />;
};

type FormatCmd = 'bold' | 'italic' | 'insertUnorderedList' | 'insertOrderedList' | 'formatBlock:h4' | 'createLink';
type FormatTuple = readonly [FormatCmd, typeof Bold, string];

function getFormat(tt: ReturnType<typeof useT>): readonly FormatTuple[] {
  return [
    ['bold', Bold, tt('views.drawer.fmtBold')],
    ['italic', Italic, tt('views.drawer.fmtItalic')],
    ['insertUnorderedList', List, tt('views.drawer.fmtBulletedList')],
    ['insertOrderedList', ListOrdered, tt('views.drawer.fmtNumberedList')],
    ['formatBlock:h4', Heading, tt('views.drawer.fmtHeading')],
    ['createLink', LinkIcon, tt('views.drawer.fmtLink')],
  ] as const;
}

function getRecur(tt: ReturnType<typeof useT>): string[] {
  return [
    tt('views.drawer.doesNotRepeat'),
    tt('views.drawer.recurDaily'),
    tt('views.drawer.recurWeekly'),
    tt('views.drawer.recurEvery2Weeks'),
    tt('views.drawer.recurMonthly'),
  ];
}

export interface DrawerPanelProps {
  task: Task;
  subId: string | null;
  full: boolean;
  tab: 'comments' | 'activity';
  enter: boolean;
  draft: string;
  uploads: UploadItem[];
  panelRef: React.Ref<HTMLElement>;
  onDraft: (v: string) => void;
  onTab: (t: 'comments' | 'activity') => void;
  onClose: () => void;
  onToggleFull: () => void;
  onOpenSub: (id: string | null) => void;
  onOpenTask: (id: string) => void;
  onProject: (p: Project) => void;
  onFiles: (files: FileList | null, t: Task) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  /** Внутри плавающего окна: без собственной рамки и кнопок закрытия — их даёт шапка окна */
  inWindow?: boolean;
  /** Вынести задачу в плавающее окно (кнопка «Pop out» в шапке карточки) */
  onPopOut?: () => void;
}

export function DrawerPanel(p: DrawerPanelProps) {
  const tt = useT();
  const { task: t, full } = p;
  const { data, dispatch } = useWorkspace();
  const actions = useTaskActions();
  const pr = project(data, t.project);
  const sub = findSub(t.subtasks, p.subId);
  const done = t.status === 'done';
  const update = (patch: TaskPatch) => dispatch({ type: 'task/update', id: t.id, patch });

  const Root = p.inWindow ? 'div' : 'aside';
  return (
    <Root
      ref={p.panelRef as React.Ref<never>}
      className={cn('drawer', full && 'full', p.enter && 'enter', p.inWindow && 'in-win')}
      {...(p.inWindow ? {} : { role: 'dialog', 'aria-modal': full, 'aria-labelledby': 'd-h', tabIndex: -1 })}
      onKeyDown={p.onKeyDown}
    >
      {!p.inWindow && (
        <h2 className="sr" id="d-h">
          {sub ? `${tt('views.drawer.subtaskAria')}: ${sub.title}` : `${tt('views.drawer.taskAria')}: ${t.title}`}
        </h2>
      )}
      <div className="drawer-h">
        {pr && (
          <button className="pillbtn" style={{ fontSize: 12.5 }} onClick={() => p.onProject(pr)}>
            <ProjectDot project={pr} />
            {pr.name}
          </button>
        )}
        <span className="faint">/</span>
        <span className="mono faint" style={{ fontSize: 11.5, padding: '0 6px' }}>
          {t.key}
        </span>
        <span className="sp" />
        <button className={cn('btn btn-sm', done ? 'btn-secondary' : 'btn-ghost')} style={done ? { color: 'var(--green)' } : undefined} onClick={() => actions.toggleDone(t)}>
          {done ? <CircleCheck size={14} /> : <Circle size={14} />}
          <span className="hide-m">{done ? tt('views.drawer.completed') : tt('views.drawer.markComplete')}</span>
        </button>
        <IconButton size="sm" label={t.fav ? tt('views.drawer.unfavorite') : tt('views.drawer.favorite')} aria-label={tt('views.drawer.favorite')} aria-pressed={t.fav} style={t.fav ? { color: 'var(--amber)' } : undefined} onClick={() => actions.toggleFav(t)}>
          <Star size={15} />
        </IconButton>
        <IconButton size="sm" label={tt('views.drawer.copyLink')} onClick={() => actionsCopy(data.ws.url, t, tt)}>
          <Link2 size={15} />
        </IconButton>
        {!p.inWindow && p.onPopOut && (
          <IconButton size="sm" label={tt('views.drawer.popOutLabel')} aria-label={tt('views.drawer.popOut')} onClick={p.onPopOut}>
            <PictureInPicture2 size={15} />
          </IconButton>
        )}
        {!p.inWindow && (
          <IconButton size="sm" className="hide-m" label={full ? tt('views.drawer.minimize') : tt('views.drawer.maximize')} aria-label={tt('views.drawer.toggleFull')} onClick={p.onToggleFull}>
            {full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </IconButton>
        )}
        <Menu>
          <MenuTrigger asChild>
            <IconButton size="sm" label={tt('views.drawer.more')} tooltip={false}>
              <Ellipsis size={15} />
            </IconButton>
          </MenuTrigger>
          <MenuContent align="end">
            <TaskMenuItems task={t} hideOpen hideWindow={p.inWindow} />
          </MenuContent>
        </Menu>
        {!p.inWindow && (
          <IconButton size="sm" label={tt('common.close')} shortcut="Esc" onClick={p.onClose}>
            <X size={16} />
          </IconButton>
        )}
      </div>
      <div className="drawer-b">
        {sub ? (
          <SubtaskView task={t} sub={sub} onClose={() => p.onOpenSub(null)} onOpenSub={p.onOpenSub} onOpenTask={p.onOpenTask} />
        ) : (
          <TaskBody {...p} tt={tt} update={update} />
        )}
      </div>
    </Root>
  );
}

function actionsCopy(wsUrl: string, t: Task, tt: ReturnType<typeof useT>) {
  const url = `https://gr8rstudio.com/${wsUrl}/task/${t.key}`;
  Promise.resolve()
    .then(() => navigator.clipboard.writeText(url))
    .then(() => toast(tt('common.linkCopied')))
    .catch(() => toast.info(tt('views.drawer.copyNotAvailable', { url }), { duration: 6000 }));
}

function Prop({ icon: I, label, children }: { icon: typeof User; label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>
        <I size={14} />
        {label}
      </dt>
      <dd>{children}</dd>
    </>
  );
}

function TaskBody(p: DrawerPanelProps & { tt: ReturnType<typeof useT>; update: (patch: TaskPatch) => void }) {
  // задача операции производства: исполнитель отмечает выполненное в своей задаче
  const operationId = typeof p.task.custom?.productionOperationId === 'string' ? p.task.custom.productionOperationId : null;
  const { task: t, full, update } = p;
  const { data, dispatch } = useWorkspace();
  const actions = useTaskActions();
  const customRows = useCustomRows('task', t.custom, patch => update({ custom: { ...t.custom, ...patch } }));
  const pr = project(data, t.project);
  const cs = commentsOf(data, t.id);
  const acts = data.activity.filter(a => a.task === t.id);
  const ups = p.uploads.filter(u => u.task === t.id);
  const [preview, setPreview] = React.useState<ProjectFile | null>(null);
  const [over, setOver] = React.useState(false);
  const overdue = isOverdue(t) ? diffDays(today(), parse(t.due!)) : 0;
  const toFile = (f: Task['attachments'][number]): ProjectFile => ({ ...f, type: f.type as FileKind, project: t.project, task: t.id });
  const projects = data.projects.filter(x => !x.archived && (!x.private || x.members.includes(data.me)) && x.status !== 'complete');
  const candidates = data.tasks.filter(x => x.project === t.project && x.id !== t.id && !x.archived);

  return (
    <>
      {isDone(t) ? (
        <div className="alert ok" style={{ marginBottom: 12 }}>
          <CircleCheck size={15} />
          <span>
            {p.tt('views.drawer.completedAgo', { ago: t.completedAt ? ago(t.completedAt) : '' })}{' '}
            <button className="link" onClick={() => actions.toggleDone(t)}>
              {p.tt('views.drawer.reopenTask')}
            </button>
          </span>
        </div>
      ) : overdue > 0 ? (
        <div className="alert danger" style={{ marginBottom: 12 }}>
          <ClockAlert size={15} />
          <span>
            {p.tt('views.drawer.overdueBy', { count: overdue })}{' '}
            <DatePopover value={t.due} onChange={due => update({ due })} trigger={<button className="link">{p.tt('views.drawer.reschedule')}</button>} />
          </span>
        </div>
      ) : null}
      <AutoTextarea
        key={`${t.id}:${t.title}`}
        className="ttl-edit"
        id="d-title"
        rows={1}
        defaultValue={t.title}
        aria-label={p.tt('views.drawer.titleField')}
        onBlur={e => {
          const v = e.currentTarget.value.trim();
          if (v && v !== t.title) update({ title: v });
          else e.currentTarget.value = t.title;
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
      <dl className="kv" style={{ marginTop: 12, ...(full ? { gridTemplateColumns: '112px minmax(0,1fr) 112px minmax(0,1fr)' } : null) }}>
        <Prop icon={CircleDot} label={p.tt('views.drawer.fieldStatus')}>
          <StatusField task={t} />
        </Prop>
        <Prop icon={SignalHigh} label={p.tt('views.drawer.fieldPriority')}>
          <PriorityField task={t} />
        </Prop>
        <Prop icon={User} label={p.tt('views.drawer.fieldAssignee')}>
          <AssigneeField task={t} />
        </Prop>
        {/* Заказчик бывает только у задач модуля services (время по заказчику без заказ-наряда) */}
        {t.module === 'services' && (
          <Prop icon={Building2} label={p.tt('views.drawer.fieldCustomer')}>
            <CustomerField task={t} />
          </Prop>
        )}
        <Prop icon={CalendarIcon} label={p.tt('views.drawer.fieldDue')}>
          <DueField task={t} />
        </Prop>
        <Prop icon={CalendarArrowUp} label={p.tt('views.drawer.fieldStart')}>
          <DatePopover
            value={t.start}
            onChange={start => update({ start })}
            trigger={
              <button className={cn('pillbtn', !t.start && 'empty')} aria-label={p.tt('views.drawer.fieldStart')}>
                <CalendarIcon size={13} />
                {t.start ? fmtDate(t.start) : p.tt('views.field.setDate')}
              </button>
            }
          />
        </Prop>
        <Prop icon={Folder} label={p.tt('views.drawer.fieldProject')}>
          <ListPopover
            search={p.tt('views.drawer.moveToProject')}
            items={projects.map(x => ({ id: x.id, name: x.name, icon: <span className="pdot" style={{ '--c': projectColor(x) } as React.CSSProperties} />, on: t.project === x.id }))}
            onPick={id => id !== t.project && update({ project: id })}
            trigger={
              <button className="pillbtn" aria-label={p.tt('views.drawer.fieldProject')}>
                <ProjectDot project={pr} />
                <span className="trunc">{pr?.name}</span>
              </button>
            }
          />
        </Prop>
        <Prop icon={Tag} label={p.tt('views.drawer.fieldLabels')}>
          <ListPopover
            multi
            search={p.tt('views.drawer.filterLabels')}
            items={(Object.entries(LABELS) as [LabelId, { name: string; c: string }][]).map(([id, l]) => ({
              id,
              name: l.name,
              icon: <span className="pdot" style={{ '--c': l.c } as React.CSSProperties} />,
              on: t.labels.includes(id),
            }))}
            onPick={id => update({ labels: t.labels.includes(id as LabelId) ? t.labels.filter(x => x !== id) : [...t.labels, id as LabelId] })}
            trigger={
              <button className={cn('pillbtn', !t.labels.length && 'empty')} aria-label={p.tt('views.drawer.fieldLabels')} style={{ flexWrap: 'wrap', height: 'auto', minHeight: 26, padding: '3px 7px' }}>
                {t.labels.length ? (
                  t.labels.map(id => (
                    <Label key={id} color={LABELS[id].c}>
                      {LABELS[id].name}
                    </Label>
                  ))
                ) : (
                  <>
                    <Tag size={13} />
                    {p.tt('views.drawer.addLabels')}
                  </>
                )}
              </button>
            }
          />
        </Prop>
        <Prop icon={Repeat} label={p.tt('views.drawer.fieldRepeat')}>
          <ListPopover
            items={getRecur(p.tt).map(x => ({ id: x, name: x, icon: <Repeat size={14} />, on: (t.recur || p.tt('views.drawer.doesNotRepeat')) === x }))}
            onPick={id => update({ recur: id === p.tt('views.drawer.doesNotRepeat') ? null : id })}
            trigger={
              <button className={cn('pillbtn', !t.recur && 'empty')} aria-label={p.tt('views.drawer.fieldRepeat')}>
                <Repeat size={13} />
                {t.recur || p.tt('views.drawer.doesNotRepeat')}
              </button>
            }
          />
        </Prop>
        <Prop icon={GitBranch} label={p.tt('views.drawer.fieldBlockedBy')}>
          <ListPopover
            multi
            search={p.tt('views.drawer.blockedBy')}
            width={300}
            items={candidates.map(x => ({ id: x.id, name: `${x.key}  ${x.title}`, icon: <StatusIcon status={x.status} />, on: t.deps.includes(x.id) }))}
            onPick={id => update({ deps: t.deps.includes(id) ? t.deps.filter(x => x !== id) : [...t.deps, id] })}
            trigger={
              <button className={cn('pillbtn', !t.deps.length && 'empty')} aria-label={p.tt('views.drawer.fieldBlockedBy')} style={{ height: 'auto', minHeight: 26, flexWrap: 'wrap' }}>
                {t.deps.length ? (
                  t.deps.map(d => {
                    const x = findTask(data, d);
                    return x ? (
                      <React.Fragment key={d}>
                        <span className="depchip mono" style={{ fontSize: 11, padding: '1px 5px', borderRadius: 4, background: 'var(--surface-3)' }}>
                          {x.key}
                        </span>
                        <span className="trunc" style={{ maxWidth: 160 }}>
                          {x.title}
                        </span>
                      </React.Fragment>
                    ) : null;
                  })
                ) : (
                  <>
                    <GitBranch size={13} />
                    {p.tt('views.drawer.none')}
                  </>
                )}
              </button>
            }
          />
        </Prop>
        {customRows.map(r => (
          <Prop key={r.field.key} icon={r.icon} label={r.label}>
            {r.node}
          </Prop>
        ))}
      </dl>

      <TimeBlock task={t} />

      {!!operationId && <OperationBlock assignmentId={operationId} />}

      <div className="dsec">
        <div className="dsec-h">
          <h3 id="d-desc-l">{p.tt('views.drawer.description')}</h3>
          <div className="rte-tb" role="toolbar" aria-label={p.tt('views.drawer.formattingToolbar')} aria-controls="d-desc">
            {getFormat(p.tt).map(([cmd, I, name]) => (
              <IconButton
                key={cmd}
                size="xs"
                label={name}
                // mousedown не должен забирать выделение у редактора
                onMouseDown={e => {
                  e.preventDefault();
                  const html = runFormat(cmd, p.tt);
                  if (html != null) update({ desc: html });
                }}
              >
                <I size={13} />
              </IconButton>
            ))}
          </div>
        </div>
        <div className="rte">
          <RichText html={t.desc} onChange={desc => update({ desc })} labelledBy="d-desc-l" />
        </div>
      </div>

      <SubtaskSection task={t} list={t.subtasks} onOpenSub={p.onOpenSub} />

      <div className="dsec">
        <div className="dsec-h">
          <h3>{p.tt('views.drawer.attachments')}</h3>
          <span className="cnt">{t.attachments.length}</span>
          <div className="acts">
            <label className="btn btn-sm btn-ghost" style={{ cursor: 'pointer' }}>
              <UploadIcon size={13} />
              {p.tt('views.drawer.upload')}
              <input type="file" multiple hidden onChange={e => { p.onFiles(e.target.files, t); e.target.value = ''; }} />
            </label>
          </div>
        </div>
        {ups.map(u => (
          <div key={u.id} className="upl" style={{ marginBottom: 6 }}>
            <span className="ftype" style={{ '--c': FILE_TYPES[fileKindOf(u.name)].c } as React.CSSProperties}>
              <KindIcon kind={fileKindOf(u.name)} size={14} />
            </span>
            <div className="grow">
              <div className="row">
                <span className="trunc">{u.name}</span>
                <span className="sp" />
                <span className="faint num" style={{ fontSize: 11 }}>
                  {u.pct}%
                </span>
              </div>
              <Progress value={u.pct} className="mt-[5px]" aria-label={p.tt('views.drawer.uploadingAria', { name: u.name })} />
            </div>
          </div>
        ))}
        {t.attachments.length ? (
          <div className="att">
            {t.attachments.map(f => (
              <div
                key={f.id}
                className="attc"
                role="button"
                tabIndex={0}
                onClick={() => setPreview(toFile(f))}
                onKeyDown={e => {
                  if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
                    e.preventDefault();
                    setPreview(toFile(f));
                  }
                }}
              >
                <FilePreview file={toFile(f)} />
                <div className="fi">
                  <div className="trunc" style={{ fontWeight: 500 }}>
                    {f.name}
                  </div>
                  <div className="faint">
                    {FILE_TYPES[f.type as FileKind]?.n || 'File'} · {f.size}
                  </div>
                </div>
                <IconButton
                  size="xs"
                  className="x"
                  label={p.tt('views.drawer.removeAttachment')}
                  tooltip={false}
                  onClick={e => {
                    e.stopPropagation();
                    dispatch({ type: 'task/detach', id: t.id, attachment: f.id });
                    toast(p.tt('views.drawer.removedFile', { name: f.name }));
                  }}
                >
                  <X size={12} />
                </IconButton>
              </div>
            ))}
          </div>
        ) : (
          !ups.length && (
            <label
              className={cn('dropzone', over && 'over')}
              style={{ padding: 12 }}
              onDragOver={e => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={e => {
                e.preventDefault();
                setOver(false);
                p.onFiles(e.dataTransfer.files, t);
              }}
            >
              <Paperclip size={15} />
              <span>{p.tt('views.drawer.dropFilesOrAttach')}</span>
              <input type="file" multiple hidden onChange={e => { p.onFiles(e.target.files, t); e.target.value = ''; }} />
            </label>
          )
        )}
      </div>

      <div className="dsec">
        <Tabs value={p.tab} onValueChange={v => p.onTab(v as 'comments' | 'activity')}>
          <TabsList style={{ marginBottom: 6 }}>
            <Tab value="comments" count={cs.length}>
              {p.tt('views.drawer.tabComments')}
            </Tab>
            <Tab value="activity" count={acts.length}>
              {p.tt('views.drawer.tabActivity')}
            </Tab>
          </TabsList>
          <TabsContent value="comments">
            {cs.length ? (
              cs.map(c => (
                <CommentItem
                  key={c.id}
                  c={c}
                  onDelete={() => {
                    const snap = data;
                    dispatch({ type: 'comment/delete', id: c.id });
                    toast(p.tt('views.drawer.commentDeleted'), { action: { label: p.tt('common.undo'), onClick: () => dispatch({ type: 'data/restore', data: snap }) } });
                  }}
                />
              ))
            ) : (
              <p className="faint" style={{ fontSize: 13, margin: '10px 0' }}>
                {p.tt('views.drawer.noComments')}
              </p>
            )}
            <CommentBox task={t} draft={p.draft} onDraft={p.onDraft} onFiles={p.onFiles} tt={p.tt} />
          </TabsContent>
          <TabsContent value="activity">
            <div style={{ paddingTop: 4 }}>
              {acts.map(a => {
                const m = member(data, a.by);
                return (
                  <div key={a.id} className="act-line">
                    <span className="ico">
                      <MemberAvatar id={a.by} size="sm" tooltip={false} />
                    </span>
                    <span className="grow">
                      <b>{m?.id === data.me ? p.tt('views.activity.you') : m?.name}</b> {a.verb.replace(/ of$/, '')}
                      {a.extra ? ' ' + a.extra : ''}
                    </span>
                    <time className="faint" style={{ fontSize: 11.5 }}>
                      {ago(a.at)}
                    </time>
                  </div>
                );
              })}
              <div className="act-line">
                <span className="ico">
                  <Plus size={13} />
                </span>
                <span className="grow">{p.tt('views.drawer.taskCreated')}</span>
                <time className="faint" style={{ fontSize: 11.5 }}>
                  {ago(t.created)}
                </time>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={!!preview} onOpenChange={o => !o && setPreview(null)}>
        {preview && (
          <DialogContent
            size="lg"
            title={preview.name}
            description={`${FILE_TYPES[preview.type]?.n ?? 'File'} · ${preview.size} · ${p.tt('views.drawer.fileDialogDesc', { type: FILE_TYPES[preview.type]?.n ?? 'File', size: preview.size, who: member(data, preview.by)?.name || p.tt('views.activity.you'), when: ago(preview.at) })}`}
            footer={
              <>
                <Button variant="secondary" onClick={() => actionsCopy(data.ws.url, t, p.tt)}>
                  <LinkIcon size={14} />
                  {p.tt('views.drawer.copyLink')}
                </Button>
                <span className="sp" />
                <DialogClose asChild>
                  <Button>{p.tt('common.close')}</Button>
                </DialogClose>
              </>
            }
          >
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
              <FilePreview file={preview} style={{ aspectRatio: '16/9' }} />
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

const isDone = (t: Task) => t.status === 'done';
const fileKindOf = (name: string): FileKind => fileKind(name);

/** Поле комментария: упоминания по «@», ⌘/Ctrl+Enter отправляет */
function CommentBox({ task: t, draft, onDraft, onFiles, tt }: { task: Task; draft: string; onDraft: (v: string) => void; onFiles: (f: FileList | null, t: Task) => void; tt: ReturnType<typeof useT> }) {
  const { data, dispatch } = useWorkspace();
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const [mq, setMq] = React.useState<string | null>(null);
  const ment =
    mq == null
      ? []
      : data.members
          .filter(m => m.name.toLowerCase().startsWith(mq.toLowerCase()) || m.name.split(' ')[1]?.toLowerCase().startsWith(mq.toLowerCase()))
          .slice(0, 5);
  const setCaretEnd = () =>
    requestAnimationFrame(() => {
      const ta = ref.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
  const post = () => {
    const txt = draft.trim();
    if (!txt) return ref.current?.focus();
    dispatch({ type: 'comment/add', task: t.id, text: txt });
    onDraft('');
    setMq(null);
  };
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 10, marginTop: 8 }}>
      <MemberAvatar id={data.me} size="md" tooltip={false} />
      <div className="grow" style={{ position: 'relative', flex: 1, minWidth: 0 }}>
        <div className="cbox">
          <AutoTextarea
            ref={ref}
            id="d-cmt"
            rows={2}
            value={draft}
            placeholder={tt('views.drawer.commentBoxPlaceholder')}
            aria-label={tt('views.drawer.commentAria')}
            onChange={e => {
              onDraft(e.target.value);
              const m = e.target.value.slice(0, e.target.selectionStart).match(/(?:^|\s)@([A-Za-z]*)$/);
              setMq(m ? m[1] : null);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                post();
              } else if (e.key === 'Escape' && mq != null) {
                // первый Esc закрывает список упоминаний, а не карточку
                e.preventDefault();
                setMq(null);
              }
            }}
          />
          <div className="row">
            <IconButton
              size="xs"
              label={tt('views.drawer.mentionSomeone')}
              aria-label={tt('views.drawer.mention')}
              onClick={() => {
                onDraft(draft + (draft && !draft.endsWith(' ') ? ' @' : '@'));
                setMq('');
                setCaretEnd();
              }}
            >
              <AtSign size={14} />
            </IconButton>
            <label className="ibtn ibtn-xs" title={tt('views.drawer.attachFile')} style={{ cursor: 'pointer' }}>
              <Paperclip size={14} />
              <input type="file" multiple hidden onChange={e => { onFiles(e.target.files, t); e.target.value = ''; }} />
            </label>
            <span className="sp" />
            <span className="faint hide-m" style={{ fontSize: 11 }}>
              {MOD}+Enter
            </span>
            <Button variant="primary" size="sm" onClick={post}>
              {tt('views.drawer.comment')}
            </Button>
          </div>
        </div>
        {ment.length > 0 && (
          <div className="pop mention-pop" role="menu">
            {ment.map(m => (
              <button
                key={m.id}
                className="mi"
                onClick={() => {
                  onDraft(draft.replace(/@([A-Za-z]*)$/, '@' + m.name + ' '));
                  setMq(null);
                  setCaretEnd();
                }}
              >
                <MemberAvatar id={m.id} size="sm" tooltip={false} />
                {m.name}
                <span className="r">{m.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
