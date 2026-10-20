/* Уведомления и комментарии: текст с упоминаниями, иконка и строка уведомления,
   комментарий с реакциями, поле ответа. Порт notifText / notifIcon (pages/inbox.js),
   commentHtml (overlays/drawer.js) и fmtComment (ui/helpers.js). */
import * as React from 'react';
import { Clock, SmilePlus, Trash2, TriangleAlert } from 'lucide-react';
import { Button, IconButton, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useWorkspace } from '../data/store';
import { member, notifTarget } from '../data/selectors';
import { ago } from '../lib/dates';
import type { Comment, Notification } from '../data/types';
import { MemberAvatar } from './workspace';
import { MOD } from '../lib/platform';

/** Текст, в котором «@Имя участника» подсвечено как упоминание */
export function MentionText({ text }: { text: string }) {
  const { data } = useWorkspace();
  const names = data.members.map(m => m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = text.split(new RegExp(`(@(?:${names.join('|')}))`));
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <span key={i} className="mention">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  );
}

export function NotifIcon({ n }: { n: Notification }) {
  if (n.by) return <MemberAvatar id={n.by} size="md" tooltip={false} />;
  const Icon = n.type === 'update' && n.project ? TriangleAlert : Clock;
  return (
    <span className="av md" style={{ '--c': n.project ? 'var(--red)' : 'var(--amber)' } as React.CSSProperties}>
      <Icon size={13} />
    </span>
  );
}

export function NotifText({ n }: { n: Notification }) {
  const { data } = useWorkspace();
  const { task: t, project: p } = notifTarget(data, n);
  if (!n.by && p && !t) return <b style={{ fontWeight: 600 }}>{n.text}</b>;
  if (!n.by && t)
    return (
      <>
        <b style={{ fontWeight: 600 }}>{t.title}</b> <span className="muted">{n.text}</span>
      </>
    );
  return (
    <>
      <b style={{ fontWeight: 600 }}>{member(data, n.by)?.name}</b> <span className="muted">{n.text}</span> {t && <b style={{ fontWeight: 500 }}>{t.title}</b>}
    </>
  );
}

const EMOJI = ['👍', '🎉', '❤️', '👀', '🚀', '✅'];

/** onDelete — кнопка «Delete» у собственного комментария (карточка задачи) */
export function CommentItem({ c, onDelete }: { c: Comment; onDelete?: () => void }) {
  const { data, dispatch } = useWorkspace();
  const m = member(data, c.by);
  const react = (emoji: string) => dispatch({ type: 'comment/react', id: c.id, emoji });
  return (
    <div className="cmt">
      <MemberAvatar id={c.by} size="md" tooltip={false} />
      <div className="body">
        <div className="who">
          <b>{m?.name}</b>
          <time>{ago(c.at)}</time>
          {onDelete && c.by === data.me && (
            <>
              <span className="sp" />
              <IconButton size="xs" label="Delete" aria-label="Delete comment" onClick={onDelete}>
                <Trash2 size={12} />
              </IconButton>
            </>
          )}
        </div>
        <div className="txt">
          <MentionText text={c.text} />
        </div>
        <div className="reacts">
          {Object.entries(c.re)
            .filter(([, v]) => v.length)
            .map(([e, v]) => (
              <Tooltip key={e} content={v.map(id => member(data, id)?.name).join(', ')}>
                <button className={cn('react', v.includes(data.me) && 'mine')} aria-label={`${e} ${v.length}`} aria-pressed={v.includes(data.me)} onClick={() => react(e)}>
                  {e}
                  <span className="num">{v.length}</span>
                </button>
              </Tooltip>
            ))}
          <Popover>
            <PopoverTrigger asChild>
              <button className="react" aria-label="Add reaction" style={{ color: 'var(--text-3)' }}>
                <SmilePlus size={13} />
              </button>
            </PopoverTrigger>
            <PopoverContent className="!min-w-0 !p-1">
              <div className="flex gap-0.5">
                {EMOJI.map(e => (
                  <button key={e} className="ibtn text-base" aria-label={`React ${e}`} onClick={() => react(e)}>
                    {e}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}

/** Поле ответа: Ctrl/⌘+Enter отправляет комментарий к задаче */
export function ReplyBox({ taskId, placeholder = 'Reply… use @ to mention' }: { taskId: string; placeholder?: string }) {
  const { dispatch } = useWorkspace();
  const [text, setText] = React.useState('');
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const send = () => {
    if (!text.trim()) return ref.current?.focus();
    dispatch({ type: 'comment/add', task: taskId, text });
    setText('');
  };
  return (
    <div className="cbox" style={{ marginTop: 10 }}>
      <textarea
        ref={ref}
        value={text}
        placeholder={placeholder}
        aria-label="Reply"
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div className="row">
        <span className="faint" style={{ fontSize: 11.5 }}>
          {MOD}+Enter to send
        </span>
        <span className="sp" />
        <Button size="sm" variant="primary" onClick={send}>
          Reply
        </Button>
      </div>
    </div>
  );
}
