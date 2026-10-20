/* Карточка подзадачи внутри карточки задачи — порт subtaskHtml из features/subtasks.js и действий из actions/subtasks.js.
   Подзадачи вложенные: сверху хлебные крошки пути, ниже её дети, Previous/Next ходят по соседям одного уровня. */
import * as React from 'react';
import { ArrowLeft, ArrowUpRight, Calendar, ChevronLeft, ChevronRight, Folder, Trash2, User } from 'lucide-react';
import { Button, Checkbox, Textarea, toast } from '@/components/ui';
import { cn } from '@/lib/utils';
import { newId, nextKey, useWorkspace } from '../../data/store';
import { member } from '../../data/selectors';
import { siblingsOf, subPath } from '../../data/subtasks';
import { relDate } from '../../lib/dates';
import type { Subtask, Task } from '../../data/types';
import { MemberAvatar } from '../workspace';
import { AutoTextarea, DatePopover, ListPopover } from './pickers';
import { SubtaskSection } from './subtask-tree';
import { TimeBlock } from './time-block';

export function SubtaskView({ task: t, sub: s, onClose, onOpenSub, onOpenTask }: { task: Task; sub: Subtask; onClose: () => void; onOpenSub: (id: string | null) => void; onOpenTask: (id: string) => void }) {
  const { data, dispatch } = useWorkspace();
  const path = subPath(t.subtasks, s.id);
  const parent = path.length > 1 ? path[path.length - 2] : undefined;
  const sibs = siblingsOf(t.subtasks, s.id);
  const i = sibs.findIndex(x => x.id === s.id);
  const m = member(data, s.assignee);
  const patch = (p: Partial<Pick<Subtask, 'title' | 'assignee' | 'due' | 'note'>>) => dispatch({ type: 'subtask/update', id: t.id, sub: s.id, patch: p });
  const toggle = () => dispatch({ type: 'task/toggleSubtask', id: t.id, subtask: s.id });
  const go = (d: number) => sibs[i + d] && onOpenSub(sibs[i + d].id);

  const promote = () => {
    const id = newId('t');
    const key = nextKey(data, t.project);
    dispatch({ type: 'subtask/promote', id: t.id, sub: s.id, newId: id });
    onClose();
    toast(`Converted to ${key}`, { action: { label: 'Open', onClick: () => onOpenTask(id) } });
  };
  const remove = () => {
    const snap = data;
    dispatch({ type: 'subtask/remove', id: t.id, sub: s.id });
    onOpenSub(parent?.id ?? null);
    toast(`Deleted “${s.title}”`, { action: { label: 'Undo', onClick: () => dispatch({ type: 'data/restore', data: snap }) } });
  };

  return (
    <div className="subview">
      {/* Хлебные крошки: задача › родительские подзадачи (текущая — в заголовке ниже) */}
      <nav className="crumbs-sub" aria-label="Subtask path">
        <button className="pillbtn" onClick={onClose} style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
          <ArrowLeft size={14} />
          <span className="trunc" style={{ maxWidth: 220 }}>
            {t.title}
          </span>
        </button>
        {path.slice(0, -1).map(a => (
          <React.Fragment key={a.id}>
            <ChevronRight size={12} className="faint" aria-hidden />
            <button className="pillbtn" onClick={() => onOpenSub(a.id)} style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
              <span className="trunc" style={{ maxWidth: 160 }}>
                {a.title}
              </span>
            </button>
          </React.Fragment>
        ))}
      </nav>
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <Checkbox round style={{ marginTop: 9 }} checked={s.done} onChange={toggle} aria-label={s.done ? 'Mark subtask not done' : 'Mark subtask done'} />
        <AutoTextarea
          key={`${s.id}:${s.title}`}
          className="ttl-edit"
          id="s-title"
          rows={1}
          defaultValue={s.title}
          aria-label="Subtask title"
          style={s.done ? { textDecoration: 'line-through', color: 'var(--text-3)' } : undefined}
          onBlur={e => {
            const v = e.currentTarget.value.trim();
            if (v && v !== s.title) patch({ title: v });
            else e.currentTarget.value = s.title;
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
      </div>
      <div className="faint" style={{ fontSize: 12, margin: '4px 0 0 26px' }}>
        Subtask {i + 1} of {sibs.length}
        {path.length > 1 ? ` · Level ${path.length}` : ''} · {s.done ? 'Done' : 'Open'}
      </div>
      <dl className="kv" style={{ marginTop: 16 }}>
        <dt>
          <User size={14} />
          Assignee
        </dt>
        <dd>
          <ListPopover
            search="Assign subtask to…"
            items={[
              { id: '', name: 'Unassigned', icon: <MemberAvatar id={null} size="sm" tooltip={false} />, on: !s.assignee },
              ...data.members.map(x => ({ id: x.id, name: x.name + (x.id === data.me ? ' (you)' : ''), icon: <MemberAvatar id={x.id} size="sm" tooltip={false} />, on: s.assignee === x.id })),
            ]}
            onPick={id => patch({ assignee: id || null })}
            trigger={
              <button className={cn('pillbtn', !s.assignee && 'empty')} aria-label="Subtask assignee">
                <MemberAvatar id={s.assignee} size="sm" tooltip={false} />
                <span>{m ? m.name : 'Unassigned'}</span>
              </button>
            }
          />
        </dd>
        <dt>
          <Calendar size={14} />
          Due date
        </dt>
        <dd>
          <DatePopover
            value={s.due}
            onChange={v => patch({ due: v })}
            trigger={
              <button className={cn('pillbtn', !s.due && 'empty')} aria-label="Subtask due date">
                <Calendar size={13} />
                <span className="num">{s.due ? relDate(s.due) : 'Set date'}</span>
              </button>
            }
          />
        </dd>
        <dt>
          <Folder size={14} />
          Parent
        </dt>
        <dd>
          <button className="pillbtn" onClick={() => (parent ? onOpenSub(parent.id) : onClose())}>
            {parent ? (
              <span className="trunc" style={{ maxWidth: 300 }}>
                {parent.title}
              </span>
            ) : (
              <>
                <span className="mono faint" style={{ fontSize: 11 }}>
                  {t.key}
                </span>
                {t.title}
              </>
            )}
          </button>
        </dd>
      </dl>
      <TimeBlock task={t} sub={s} />
      <SubtaskSection task={t} list={s.subtasks} parent={s.id} onOpenSub={onOpenSub} />
      <div className="dsec">
        <div className="dsec-h">
          <h3 id="s-note-l">Notes</h3>
        </div>
        <Textarea id="s-note" rows={4} value={s.note ?? ''} onChange={e => patch({ note: e.target.value })} placeholder="Add details, links, or acceptance criteria…" aria-labelledby="s-note-l" />
      </div>
      <div className="dsec row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <Button size="sm" variant="secondary" onClick={promote}>
          <ArrowUpRight size={13} />
          Convert to task
        </Button>
        <span className="sp" />
        <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => go(-1)} aria-label="Previous subtask">
          <ChevronLeft size={14} />
          Previous
        </Button>
        <Button size="sm" variant="ghost" disabled={i === sibs.length - 1} onClick={() => go(1)} aria-label="Next subtask">
          Next
          <ChevronRight size={14} />
        </Button>
        <Button size="sm" variant="danger-ghost" onClick={remove}>
          <Trash2 size={13} />
          Delete
        </Button>
      </div>
    </div>
  );
}
