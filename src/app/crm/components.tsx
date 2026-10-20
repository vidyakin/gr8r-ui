/* Общие компоненты CRM: значок этапа, логотип компании, поля сделки, карточка воронки, запись активности и её форма */
import * as React from 'react';
import { Link } from 'react-router';
import { ArrowRightLeft, Calendar as CalendarIcon, Plus } from 'lucide-react';
import { Avatar, Button, Checkbox, Popover, PopoverContent, PopoverTrigger, Segmented, toast } from '@/components/ui';
import { Calendar } from '@/components/shadcn/calendar';
import { cn } from '@/lib/utils';
import { useWorkspace } from '../data/store';
import { member } from '../data/selectors';
import { ago, dOff, diffDays, fmtDate, iso, parse, relDate, today } from '../lib/dates';
import { PillMenu } from '../components/fields';
import { MemberAvatar } from '../components/workspace';
import { ACTIVITY_TYPES, STAGES, activityType, isOpen, stage } from './stages';
import { money, pct } from './format';
import { company as findCompany, contact as findContact, deal as findDeal, isOverdueDeal, probability } from './selectors';
import { useCrm } from './store';
import { useCrmUi } from './ui-context';
import type { ActivityType, CrmActivity, Deal, StageId } from './types';

/** Имя участника воркспейса по id — для сортировки и подписей в таблицах */
export function useOwnerName() {
  const { data } = useWorkspace();
  return React.useCallback((id: string) => member(data, id)?.name ?? 'Unassigned', [data]);
}

/** Значок этапа воронки: кольцо с долей, равной вероятности этапа (как StatusIcon у задач) */
export function StageIcon({ stage: id, size = 14 }: { stage: StageId; size?: number }) {
  const s = stage(id);
  const c = s.c;
  const r = 5.4;
  const f = s.p;
  const a = f * Math.PI * 2;
  const wedge = `M7 7 L7 3.4 A3.6 3.6 0 ${f > 0.5 ? 1 : 0} 1 ${(7 + 3.6 * Math.sin(a)).toFixed(2)} ${(7 - 3.6 * Math.cos(a)).toFixed(2)} Z`;
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden className="shrink-0">
      {id === 'lead' && <circle cx="7" cy="7" r={r} fill="none" stroke={c} strokeWidth="1.5" strokeDasharray="1.9 2.1" />}
      {(id === 'qualified' || id === 'proposal' || id === 'negotiation') && (
        <>
          <circle cx="7" cy="7" r={r} fill="none" stroke={c} strokeWidth="1.5" />
          <path d={wedge} fill={c} />
        </>
      )}
      {id === 'won' && (
        <>
          <circle cx="7" cy="7" r="6.2" fill={c} />
          <path d="M4.4 7.2 6.2 9 9.7 5.3" fill="none" stroke="var(--surface)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {id === 'lost' && (
        <>
          <circle cx="7" cy="7" r="6.2" fill={c} />
          <path d="M4.9 4.9 9.1 9.1M9.1 4.9 4.9 9.1" stroke="var(--surface)" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

const LOGO_COLORS = ['var(--accent)', 'var(--blue)', 'var(--violet)', 'var(--teal)', 'var(--rose)', 'var(--orange)', 'var(--green)'];
const hash = (s: string) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0);

/** Квадратный «логотип» компании: инициал на цветном фоне (по образцу ProjectIcon) */
export function CompanyLogo({ name, size = 22, className }: { name: string; size?: number; className?: string }) {
  return (
    <span className={cn('picon crm-logo', className)} style={{ '--c': LOGO_COLORS[hash(name) % LOGO_COLORS.length], '--sz': `${size}px`, fontSize: Math.round(size * 0.5) } as React.CSSProperties} aria-hidden>
      {name[0]}
    </span>
  );
}

/** Ссылка на страницу компании */
export function CompanyLink({ id, className, logo }: { id: string; className?: string; logo?: boolean }) {
  const { data } = useCrm();
  const co = findCompany(data, id);
  if (!co) return <span className="faint">—</span>;
  return (
    <Link to={`/crm/companies/${co.id}`} className={cn('crm-link', logo && 'row', className)} style={logo ? { gap: 6, display: 'inline-flex' } : undefined} onClick={e => e.stopPropagation()}>
      {logo && <CompanyLogo name={co.name} size={16} />}
      <span className="trunc">{co.name}</span>
    </Link>
  );
}

/** Кнопка-ссылка, открывающая карточку контакта */
export function ContactLink({ id, className }: { id: string; className?: string }) {
  const { data } = useCrm();
  const ui = useCrmUi();
  const c = findContact(data, id);
  if (!c) return null;
  return (
    <button
      type="button"
      className={cn('crm-link', className)}
      onClick={e => {
        e.stopPropagation();
        ui.openContact(c.id);
      }}
    >
      {c.name}
    </button>
  );
}

export function DealLink({ id, className }: { id: string; className?: string }) {
  const { data } = useCrm();
  const ui = useCrmUi();
  const d = findDeal(data, id);
  if (!d) return null;
  return (
    <button
      type="button"
      className={cn('crm-link', className)}
      onClick={e => {
        e.stopPropagation();
        ui.openDeal(d.id);
      }}
    >
      {d.name}
    </button>
  );
}

/** Владелец: аватар и имя */
export function OwnerCell({ id, short }: { id: string; short?: boolean }) {
  const { data } = useWorkspace();
  const m = member(data, id);
  return (
    <span className="row" style={{ gap: 6, minWidth: 0 }}>
      <MemberAvatar id={id} size="sm" tooltip={false} />
      <span className="trunc">{m ? (short ? m.name.split(' ')[0] : m.name) : 'Unassigned'}</span>
    </span>
  );
}

/** Контакт: аватар с инициалами и имя */
export function PersonCell({ name, sub }: { name: string; sub?: string }) {
  return (
    <span className="row" style={{ gap: 8, minWidth: 0 }}>
      <Avatar name={name} size="sm" tooltip={false} />
      <span className="trunc" style={{ fontWeight: 450 }}>
        {name}
      </span>
      {sub && <span className="faint trunc hide-m">{sub}</span>}
    </span>
  );
}

/** Этап: значок и название */
export function StageLabel({ stage: id }: { stage: StageId }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <StageIcon stage={id} />
      {stage(id).name}
    </span>
  );
}

/** Выбор этапа сделки в «таблетке»; смена идёт через useCrmUi().moveDeal (подтверждение Won / причина Lost) */
export function StageField({ deal }: { deal: Deal }) {
  const ui = useCrmUi();
  return (
    <PillMenu<StageId>
      label={`Stage: ${stage(deal.stage).name}`}
      value={deal.stage}
      onChange={s => s !== deal.stage && ui.moveDeal(deal.id, s)}
      options={STAGES.map(s => ({ value: s.id, label: s.name, icon: <StageIcon stage={s.id} /> }))}
      trigger={<StageLabel stage={deal.stage} />}
    />
  );
}

/** Выбор владельца в «таблетке» */
export function OwnerField({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { data } = useWorkspace();
  const people = data.members.filter(m => m.status === 'active');
  return (
    <PillMenu<string>
      label="Owner"
      value={value}
      onChange={onChange}
      options={people.map(m => ({ value: m.id, label: m.name + (m.id === data.me ? ' (you)' : ''), icon: <MemberAvatar id={m.id} size="sm" tooltip={false} /> }))}
      trigger={<OwnerCell id={value} />}
    />
  );
}

/** Дата в «таблетке» с быстрыми значениями и календарём (по образцу DueField) */
export function DateField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [open, setOpen] = React.useState(false);
  const set = (v: string) => {
    onChange(v);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="pillbtn" aria-label={label}>
          <CalendarIcon size={13} />
          <span className="num">{fmtDate(value)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={8} className="!max-w-none !p-1">
        <div className="flex max-w-[248px] flex-wrap gap-1 p-1 pb-0">
          {(
            [
              ['In 2 weeks', 14],
              ['In a month', 30],
              ['In 3 months', 90],
            ] as const
          ).map(([l, n]) => (
            <button key={l} className="btn btn-sm btn-ghost" onClick={() => set(dOff(n))}>
              {l}
            </button>
          ))}
        </div>
        <Calendar mode="single" weekStartsOn={1} selected={parse(value)} defaultMonth={parse(value)} onSelect={d => d && set(iso(d))} />
      </PopoverContent>
    </Popover>
  );
}

/** Ожидаемая дата закрытия: просроченная красная, ближайшая неделя жёлтая; у закрытых — дата закрытия */
export function CloseDate({ deal: d }: { deal: Deal }) {
  if (!isOpen(d.stage)) return <span className="due">{d.closedAt ? fmtDate(d.closedAt) : '—'}</span>;
  const n = diffDays(parse(d.closeDate), today());
  return (
    <span className={cn('due', n < 0 ? 'over' : n <= 7 && 'soon')}>
      <CalendarIcon size={12} />
      {relDate(d.closeDate)}
    </span>
  );
}

/** Карточка сделки в воронке (по образцу KCard задач) */
export function DealCard({ deal: d }: { deal: Deal }) {
  const { data } = useCrm();
  const ui = useCrmUi();
  const co = findCompany(data, d.company);
  const closed = !isOpen(d.stage);
  const open = () => ui.openDeal(d.id);
  return (
    <div className={cn('kcard crm-deal', d.stage === 'lost' && 'lost')} role="button" tabIndex={0} aria-label={`${d.name}, ${money(d.amount)}`} onClick={open} onKeyDown={e => e.key === 'Enter' && e.target === e.currentTarget && open()}>
      <div className="top">
        <div className="title">{d.name}</div>
      </div>
      {co && (
        <div className="crm-co">
          <CompanyLogo name={co.name} size={16} />
          <span className="trunc">{co.name}</span>
        </div>
      )}
      <div className="meta">
        <span className="amt num">{money(d.amount)}</span>
        {!closed && <span className="m num">{pct(probability(d))}</span>}
        <CloseDate deal={d} />
        {d.stage === 'lost' && d.lostReason && <span className="m trunc">{d.lostReason}</span>}
        <MemberAvatar id={d.owner} size="sm" />
      </div>
      {isOverdueDeal(d) && <span className="sr">Overdue</span>}
    </div>
  );
}

/* ---------- активности ---------- */

const ACT_COLORS: Record<ActivityType, string> = { call: 'var(--green)', email: 'var(--blue)', meeting: 'var(--violet)', note: 'var(--amber)', task: 'var(--teal)' };

/** Запись ленты активностей; флаги show* добавляют ссылки на связанные сделку, компанию и контакт */
export function ActivityRow({ a, showDeal, showCompany, showContact = true }: { a: CrmActivity; showDeal?: boolean; showCompany?: boolean; showContact?: boolean }) {
  const { data: ws } = useWorkspace();
  const { dispatch } = useCrm();
  const m = member(ws, a.by);
  const who = m?.id === ws.me ? 'You' : (m?.name ?? 'Someone');
  const t = activityType(a.type);
  const overdue = a.type === 'task' && !a.done && a.due && diffDays(parse(a.due), today()) < 0;
  const ctx: React.ReactNode[] = [];
  if (a.type === 'task' && a.due) ctx.push(<span key="due" className={cn(overdue && 'crm-over')}>Due {relDate(a.due)}</span>);
  if (showContact && a.contact) ctx.push(<span key="c">with <ContactLink id={a.contact} /></span>);
  if (showDeal && a.deal) ctx.push(<DealLink key="d" id={a.deal} />);
  if (showCompany && a.company) ctx.push(<CompanyLink key="co" id={a.company} />);
  return (
    <div className="fitem crm-act">
      {a.type === 'task' ? (
        <span className="crm-ico crm-chk">
          <Checkbox round checked={!!a.done} onChange={() => dispatch({ type: 'activity/toggle', id: a.id })} aria-label={`${a.done ? 'Reopen' : 'Complete'} ${a.subject}`} />
        </span>
      ) : (
        <span className="crm-ico" style={{ '--c': a.system ? 'var(--gray)' : ACT_COLORS[a.type] } as React.CSSProperties} aria-hidden>
          {a.system ? <ArrowRightLeft size={11} /> : <t.icon size={11} />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div>
          <b>{who}</b> <span className="muted">{a.system ? 'updated the deal' : t.verb}</span>
        </div>
        <div className={cn('crm-subj', a.done && 'done', a.system && 'muted')}>{a.subject}</div>
        {a.body && <div className="crm-body">{a.body}</div>}
        {!!ctx.length && (
          <div className="crm-ctx faint">
            {ctx.map((c, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span aria-hidden>·</span>}
                {c}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
      <time>{ago(a.at)}</time>
    </div>
  );
}

/** Форма добавления активности к сделке, компании или контакту: заметка, звонок, письмо, встреча или follow-up */
export function ActivityComposer({ deal, company, contact }: { deal?: string; company?: string; contact?: string }) {
  const { data: ws } = useWorkspace();
  const { dispatch } = useCrm();
  const [type, setType] = React.useState<ActivityType>('note');
  const [text, setText] = React.useState('');
  const [due, setDue] = React.useState(dOff(2));
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const post = () => {
    const subject = text.trim();
    if (!subject) return ref.current?.focus();
    dispatch({ type: 'activity/add', activity: { type, subject, by: ws.me, deal, company, contact, due: type === 'task' ? due : undefined } });
    setText('');
    toast(type === 'task' ? 'Follow-up scheduled' : `${activityType(type).name} logged`, { duration: 1800 });
  };
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 10, marginTop: 10 }}>
      <MemberAvatar id={ws.me} size="md" tooltip={false} />
      <div className="cbox" style={{ flex: 1, minWidth: 0 }}>
        <textarea
          ref={ref}
          rows={2}
          value={text}
          aria-label="Activity text"
          placeholder={type === 'task' ? 'What needs to happen next?' : type === 'note' ? 'Add a note…' : `Summarize the ${type}…`}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              post();
            }
          }}
        />
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <Segmented
            aria-label="Activity type"
            value={type}
            onValueChange={setType}
            items={ACTIVITY_TYPES.map(t => ({ value: t.id, label: <span className="hide-m">{t.name}</span>, icon: <t.icon size={13} />, 'aria-label': t.name }))}
          />
          {type === 'task' && (
            <span className="row" style={{ gap: 4 }}>
              <span className="faint" style={{ fontSize: 12 }}>Due</span>
              <DateField value={due} onChange={setDue} label="Follow-up due date" />
            </span>
          )}
          <span className="sp" />
          <Button size="sm" variant="primary" onClick={post}>
            <Plus size={13} />
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Лента активностей с пустым состоянием */
export function ActivityFeed({ items, ...flags }: { items: CrmActivity[] } & Pick<Parameters<typeof ActivityRow>[0], 'showDeal' | 'showCompany' | 'showContact'>) {
  if (!items.length)
    return (
      <p className="faint" style={{ fontSize: 13, margin: '10px 0' }}>
        No activity yet. Log a call or leave a note below.
      </p>
    );
  return (
    <div className="feed lined">
      {items.map(a => (
        <ActivityRow key={a.id} a={a} {...flags} />
      ))}
    </div>
  );
}
