/* Дерево подзадач в карточке задачи и в карточке подзадачи: отступы по глубине, сворачивание веток,
   «Add subtask» на любом уровне, часы «факт/план» справа. Новая функциональность — оригинала для сравнения нет. */
import * as React from 'react';
import { Calendar as CalendarIcon, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { Checkbox, IconButton, Progress } from '@/components/ui';
import { cn } from '@/lib/utils';
import { newId, useWorkspace } from '../../data/store';
import { fmtTimePair, subTime } from '../../data/selectors';
import { countSubs } from '../../data/subtasks';
import { diffDays, parse, relDate, today } from '../../lib/dates';
import type { Subtask, Task } from '../../data/types';
import { MemberAvatar } from '../workspace';

/** Шапка секции: «Subtasks 3/9» и полоса прогресса по всему поддереву */
function SubtaskHeader({ list }: { list: Subtask[] }) {
  const { done, total } = countSubs(list);
  return (
    <div className="dsec-h">
      <h3>Subtasks</h3>
      <span className="cnt num">
        {done}/{total}
      </span>
      {total > 0 && (
        <span style={{ width: 90, display: 'flex' }}>
          <Progress value={Math.round((done / total) * 100)} tone={done === total ? 'green' : undefined} />
        </span>
      )}
    </div>
  );
}

/** Поле «Add subtask»: Enter добавляет и оставляет фокус; parent — id подзадачи, куда вкладываем */
export function AddSubtask({ task: t, parent, depth = 0, nested, onAdded, onDone }: { task: Task; parent?: string; depth?: number; nested?: boolean; onAdded?: (id: string) => void; onDone?: () => void }) {
  const { dispatch } = useWorkspace();
  return (
    <div className="subt tree" style={{ color: 'var(--text-3)', paddingLeft: 6 + depth * 20 }}>
      <span className="tg-sp" />
      <Plus size={15} />
      <input
        className="inline-in"
        id={nested ? undefined : 'd-sub'}
        autoFocus={nested}
        placeholder={nested ? 'Nested subtask — Enter to add, Esc to close' : 'Add subtask'}
        aria-label={nested ? 'Add nested subtask' : 'Add subtask'}
        style={{ fontSize: 13.5 }}
        onBlur={e => nested && !e.currentTarget.value.trim() && onDone?.()}
        onKeyDown={e => {
          if (e.key === 'Escape' && nested) {
            e.stopPropagation();
            onDone?.();
          }
          if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
          e.preventDefault();
          const title = e.currentTarget.value.trim();
          if (!title) return;
          const id = newId('s');
          onAdded?.(id);
          dispatch({ type: 'subtask/add', id: t.id, sub: id, title, parent });
          e.currentTarget.value = '';
        }}
      />
    </div>
  );
}

/** Секция «Subtasks»: шапка, дерево подзадач списка list (корневой список задачи или дети подзадачи parent) и поле добавления */
export function SubtaskSection({ task: t, list, parent, onOpenSub }: { task: Task; list: Subtask[]; parent?: string; onOpenSub: (id: string) => void }) {
  const [shut, setShut] = React.useState<Record<string, boolean>>({});
  const [adding, setAdding] = React.useState<string | null>(null);
  const [added, setAdded] = React.useState<string | null>(null);
  return (
    <div className="dsec">
      <SubtaskHeader list={list} />
      {list.map(s => (
        <Node key={s.id} task={t} sub={s} depth={0} shut={shut} setShut={setShut} adding={adding} setAdding={setAdding} added={added} setAdded={setAdded} onOpenSub={onOpenSub} />
      ))}
      <AddSubtask task={t} parent={parent} onAdded={setAdded} />
    </div>
  );
}

interface NodeProps {
  task: Task;
  sub: Subtask;
  depth: number;
  shut: Record<string, boolean>;
  setShut: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  adding: string | null;
  setAdding: (id: string | null) => void;
  added: string | null;
  setAdded: (id: string | null) => void;
  onOpenSub: (id: string) => void;
}

function Node({ task: t, sub: s, depth, shut, setShut, adding, setAdding, added, setAdded, onOpenSub }: NodeProps) {
  const { data, dispatch } = useWorkspace();
  const kids = s.subtasks.length;
  const closed = !!shut[s.id];
  const x = subTime(data.timeLogs, t.id, s);
  const time = fmtTimePair(x);
  const sc = countSubs(s.subtasks);
  const pad = 6 + depth * 20;
  const common = { task: t, shut, setShut, adding, setAdding, added, setAdded, onOpenSub };
  return (
    <>
      <div className={cn('subt tree', s.done && 'done', added === s.id && 'fx-added')} style={{ paddingLeft: pad }}>
        {kids ? (
          <button type="button" className="tg" aria-expanded={!closed} aria-label={`${closed ? 'Expand' : 'Collapse'} ${s.title}`} onClick={() => setShut(m => ({ ...m, [s.id]: !closed }))}>
            {closed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button>
        ) : (
          <span className="tg-sp" />
        )}
        <Checkbox checked={s.done} onChange={() => dispatch({ type: 'task/toggleSubtask', id: t.id, subtask: s.id })} aria-label={`${s.done ? 'Reopen' : 'Complete'} subtask ${s.title}`} />
        <button className="s" data-sid={s.id} onClick={() => onOpenSub(s.id)}>
          {s.title}
        </button>
        {kids > 0 && (
          <span className="faint num mini-cnt" title="Nested subtasks done">
            {sc.done}/{sc.total}
          </span>
        )}
        {time && (
          <span className={cn('tmv num', x.over && 'bad')} title={x.over ? 'Over plan' : 'Actual / plan'}>
            {time}
          </span>
        )}
        {s.due && (
          <span className={cn('due', !s.done && diffDays(parse(s.due), today()) < 0 && 'over')}>
            <CalendarIcon size={12} />
            {relDate(s.due)}
          </span>
        )}
        {s.assignee && <MemberAvatar id={s.assignee} size="sm" />}
        <IconButton
          size="xs"
          className="x"
          label="Add nested subtask"
          tooltip={false}
          onClick={() => {
            setShut(m => ({ ...m, [s.id]: false }));
            setAdding(s.id);
          }}
        >
          <Plus size={14} />
        </IconButton>
        <IconButton size="xs" className="x" label="Open subtask details" tooltip={false} tabIndex={-1} onClick={() => onOpenSub(s.id)}>
          <ChevronRight size={14} />
        </IconButton>
      </div>
      {!closed && s.subtasks.map(c => <Node key={c.id} sub={c} depth={depth + 1} {...common} />)}
      {adding === s.id && !closed && <AddSubtask task={t} parent={s.id} depth={depth + 1} nested onAdded={setAdded} onDone={() => setAdding(null)} />}
    </>
  );
}
