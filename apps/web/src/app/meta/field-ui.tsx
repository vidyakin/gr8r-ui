/* Отображение и редактирование значений полей конструктора по их типам: FieldValue (только чтение) и FieldInput (правка).
   ref-поля — выбор записи с поиском и ссылка-переход. Одни и те же компоненты работают в карточках, таблицах и формах. */
import * as React from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AtSign, Calendar, CalendarClock, CircleDollarSign, Check, CheckSquare, CircleDot, Hash, Link as LinkIcon, ListChecks, Percent, Phone, Text, TextCursorInput, User, X, type LucideIcon } from 'lucide-react';
import type { FieldChoice, FieldType } from '@gr8r/shared';
import { Checkbox, Input, Label, Popover, PopoverContent, PopoverTrigger, Textarea } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useWorkspace } from '../data/store';
import { fmtDate } from '../lib/dates';
import { useEntities, searchRefs, useRefTitle, useWsId, type MetaField } from './data';
import { entityIcon } from './icons';
import { fmtCurrency, fmtDateTime, fmtNumber } from '@/i18n';

export const FIELD_ICONS: Record<FieldType, LucideIcon> = {
  text: TextCursorInput,
  long_text: Text,
  number: Hash,
  money: CircleDollarSign,
  percent: Percent,
  date: Calendar,
  datetime: CalendarClock,
  boolean: CheckSquare,
  select: CircleDot,
  multi_select: ListChecks,
  user: User,
  ref: LinkIcon,
  refs: LinkIcon,
  url: LinkIcon,
  email: AtSign,
  phone: Phone,
};

/** Цвета вариантов → токены интерфейса */
export const choiceColor = (c: string) => (c === 'gray' ? 'var(--text-3)' : c === 'indigo' ? 'var(--accent)' : `var(--${c})`);

export function ChoiceLabel({ choice }: { choice: Pick<FieldChoice, 'label' | 'color'> }) {
  return <Label color={choiceColor(choice.color)}>{choice.label}</Label>;
}

export const choiceOf = (f: Pick<MetaField, 'options'>, value: unknown) => f.options.choices?.find(c => c.value === value);

const dash = <span className="faint">—</span>;
const isBlank = (v: unknown) => v == null || v === '' || (Array.isArray(v) && !v.length);

/* ---------------- ссылки ---------------- */

/** Куда ведёт ссылка на запись; null — страницы у записи нет */
export function refPath(entityKey: string, id: string): string | null {
  switch (entityKey) {
    case 'company':
      return `/crm/companies/${id}`;
    case 'project':
      return `/projects/${id}`;
    case 'deal':
      return '/crm/deals';
    case 'contact':
      return '/crm/contacts';
    case 'task':
      return null;
    default:
      return `/data/${entityKey}/${id}`;
  }
}

function RefLink({ entityKey, id }: { entityKey: string; id: string }) {
  const title = useRefTitle(entityKey, id);
  const path = refPath(entityKey, id);
  if (title === undefined) return <span className="faint">…</span>;
  const label = <span className="trunc">{title || 'Untitled'}</span>;
  return path ? (
    <Link to={path} className="crm-link" onClick={e => e.stopPropagation()}>
      {label}
    </Link>
  ) : (
    label
  );
}

function MemberName({ id }: { id: string }) {
  const { data } = useWorkspace();
  const m = data.members.find(x => x.id === id);
  return m ? (
    <Link to={`/members/${id}`} className="crm-link" onClick={e => e.stopPropagation()}>
      {m.name}
    </Link>
  ) : (
    <span className="faint">Unknown member</span>
  );
}

/* ---------------- значение (чтение) ---------------- */

export function FieldValue({ field: f, value }: { field: Pick<MetaField, 'type' | 'options'>; value: unknown }) {
  if (isBlank(value) && f.type !== 'boolean') return dash;
  switch (f.type) {
    case 'boolean':
      return value ? <Check size={14} aria-label="Yes" /> : dash;
    case 'select': {
      const c = choiceOf(f, value);
      return c ? <ChoiceLabel choice={c} /> : <span>{String(value)}</span>;
    }
    case 'multi_select':
      return (
        <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {(value as string[]).map(v => {
            const c = choiceOf(f, v);
            return c ? <ChoiceLabel key={v} choice={c} /> : <span key={v}>{v}</span>;
          })}
        </span>
      );
    case 'number':
      return <span className="num">{fmtNumber(value as number)}</span>;
    case 'percent':
      return <span className="num">{fmtNumber(value as number)}%</span>;
    case 'money':
      return <span className="num">{fmtCurrency(value as number, f.options.currency ?? 'USD')}</span>;
    case 'date':
      return <span className="num">{fmtDate(String(value))}</span>;
    case 'datetime':
      return <span className="num">{fmtDateTime(String(value))}</span>;
    case 'url':
      return (
        <a className="crm-link trunc" href={String(value)} target="_blank" rel="noreferrer noopener" onClick={e => e.stopPropagation()}>
          {String(value).replace(/^https?:\/\//, '')}
        </a>
      );
    case 'email':
      return (
        <a className="crm-link trunc" href={`mailto:${value}`} onClick={e => e.stopPropagation()}>
          {String(value)}
        </a>
      );
    case 'phone':
      return <span className="num">{String(value)}</span>;
    case 'user':
      return <MemberName id={String(value)} />;
    case 'ref':
      return <RefLink entityKey={f.options.refEntity ?? ''} id={String(value)} />;
    case 'refs':
      return (
        <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {(value as string[]).map(id => (
            <RefLink key={id} entityKey={f.options.refEntity ?? ''} id={id} />
          ))}
        </span>
      );
    case 'long_text':
      return <span style={{ whiteSpace: 'pre-wrap' }}>{String(value)}</span>;
    default:
      return <span className="trunc">{String(value)}</span>;
  }
}

/* ---------------- выбор записи (ref / refs) ---------------- */

function RefPicker({ field: f, value, onChange, multi, id }: { field: MetaField; value: unknown; onChange: (v: unknown) => void; multi: boolean; id?: string }) {
  const ws = useWsId();
  const entities = useEntities();
  const target = f.options.refEntity ?? '';
  const entity = entities.find(e => e.key === target);
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const ids = multi ? ((value as string[] | undefined) ?? []) : value ? [value as string] : [];
  const results = useQuery({ queryKey: ['ws', ws, 'ref-search', target, q], queryFn: () => searchRefs(ws, entity, target, q), enabled: open, staleTime: 5_000 });
  const Icon = entityIcon(entity?.icon);
  const pick = (rid: string) => {
    if (multi) onChange(ids.includes(rid) ? ids.filter(x => x !== rid) : [...ids, rid]);
    else {
      onChange(rid);
      setOpen(false);
    }
  };
  return (
    <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      {ids.map(rid => (
        <span key={rid} className="row" style={{ gap: 4 }}>
          <RefLink entityKey={target} id={rid} />
          <button type="button" className="ibtn ibtn-xs" aria-label="Remove" onClick={() => onChange(multi ? ids.filter(x => x !== rid) : null)}>
            <X size={12} />
          </button>
        </span>
      ))}
      <Popover
        open={open}
        onOpenChange={o => {
          setOpen(o);
          if (!o) setQ('');
        }}
      >
        <PopoverTrigger asChild>
          <button type="button" id={id} className={cn('pillbtn', !ids.length && 'empty')} aria-label={`Choose ${f.name}`}>
            <Icon size={13} />
            {multi ? 'Add' : ids.length ? 'Change' : 'Choose'}
          </button>
        </PopoverTrigger>
        <PopoverContent className="min-w-[240px]">
          <Input size="sm" autoFocus placeholder={`Search ${entity?.name.toLowerCase() ?? 'records'}…`} aria-label="Search records" value={q} onChange={e => setQ(e.target.value)} />
          <div style={{ maxHeight: 240, overflow: 'auto', marginTop: 6 }}>
            {results.data?.map(r => (
              <button type="button" key={r.id} className="mi" style={{ width: '100%' }} onClick={() => pick(r.id)}>
                <span className="trunc" style={{ flex: 1, textAlign: 'left' }}>
                  {r.title || 'Untitled'}
                </span>
                {ids.includes(r.id) && <Check size={14} />}
              </button>
            ))}
            {results.data && !results.data.length && <div className="faint" style={{ padding: 8, fontSize: 12.5 }}>Nothing found</div>}
            {results.isPending && <div className="faint" style={{ padding: 8, fontSize: 12.5 }}>Loading…</div>}
          </div>
        </PopoverContent>
      </Popover>
    </span>
  );
}

/* ---------------- ввод ---------------- */

export interface FieldInputProps {
  field: MetaField;
  value: unknown;
  /** Новое значение; null — очистить */
  onChange: (v: unknown) => void;
  /** true — onChange на каждое изменение (формы); иначе для текстовых полей — по потере фокуса или Enter (карточки) */
  live?: boolean;
  id?: string;
  invalid?: boolean;
}

const toDatetimeLocal = (iso: unknown) => {
  if (typeof iso !== 'string' || !iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
};

type DraftProps = { value: string; onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void; onBlur: () => void; onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void };

/** Текстовое поле с черновиком: значение уходит наружу по потере фокуса / Enter (или на каждый символ при live) */
function Draft({ value, live, onCommit, render }: { value: string; live?: boolean; onCommit: (v: string) => void; render: (p: DraftProps) => React.ReactNode }) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => setV(value), [value]);
  return (
    <>
      {render({
        value: v,
        onChange: e => {
          setV(e.target.value);
          if (live) onCommit(e.target.value);
        },
        onBlur: () => !live && v !== value && onCommit(v),
        onKeyDown: e => {
          if (e.key === 'Enter' && !live && e.currentTarget.tagName !== 'TEXTAREA') e.currentTarget.blur();
        },
      })}
    </>
  );
}

export function FieldInput({ field: f, value, onChange, live, id, invalid }: FieldInputProps) {
  const { data } = useWorkspace();
  const str = value == null ? '' : String(value);
  const clear = (v: string) => (v === '' ? null : v);
  switch (f.type) {
    case 'boolean':
      return <Checkbox id={id} checked={!!value} aria-label={f.name} onChange={e => onChange(e.target.checked)} />;
    case 'select':
      return (
        <select className="select" id={id} aria-label={f.name} aria-invalid={invalid || undefined} value={str} onChange={e => onChange(clear(e.target.value))}>
          <option value="">—</option>
          {(f.options.choices ?? []).map(c => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      );
    case 'multi_select': {
      const cur = (value as string[] | undefined) ?? [];
      return (
        <span className="row" style={{ gap: 6, flexWrap: 'wrap' }} role="group" aria-label={f.name}>
          {(f.options.choices ?? []).map(c => {
            const on = cur.includes(c.value);
            return (
              <button
                key={c.value}
                type="button"
                className={cn('pillbtn bordered', !on && 'empty')}
                aria-pressed={on}
                onClick={() => onChange(on ? cur.filter(x => x !== c.value) : [...cur, c.value])}
              >
                <ChoiceLabel choice={c} />
              </button>
            );
          })}
        </span>
      );
    }
    case 'user':
      return (
        <select className="select" id={id} aria-label={f.name} value={str} onChange={e => onChange(clear(e.target.value))}>
          <option value="">—</option>
          {data.members
            .filter(m => m.status === 'active')
            .map(m => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </select>
      );
    case 'ref':
    case 'refs':
      return <RefPicker field={f} value={value} onChange={onChange} multi={f.type === 'refs'} id={id} />;
    case 'long_text':
      return (
        <Draft value={str} live={live} onCommit={v => onChange(clear(v))} render={p => <Textarea id={id} rows={3} aria-label={f.name} invalid={invalid} {...(p as React.ComponentProps<'textarea'>)} />} />
      );
    case 'date':
      return <input type="date" className="input" id={id} aria-label={f.name} aria-invalid={invalid || undefined} value={str} onChange={e => onChange(clear(e.target.value))} />;
    case 'datetime':
      return (
        <input
          type="datetime-local"
          className="input"
          id={id}
          aria-label={f.name}
          aria-invalid={invalid || undefined}
          value={toDatetimeLocal(value)}
          onChange={e => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
        />
      );
    case 'number':
    case 'money':
    case 'percent':
      return (
        <Draft
          value={str}
          live={live}
          onCommit={v => onChange(v.trim() === '' ? null : Number.isFinite(Number(v)) ? Number(v) : v)}
          render={p => <Input id={id} inputMode="decimal" aria-label={f.name} invalid={invalid} {...p} />}
        />
      );
    default: {
      const type = f.type === 'url' ? 'url' : f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text';
      return <Draft value={str} live={live} onCommit={v => onChange(clear(v))} render={p => <Input id={id} type={type} aria-label={f.name} invalid={invalid} {...p} />} />;
    }
  }
}
