/* Смена прораба (задача 1271, docs/architecture/construction.md): мобильная вёрстка.
   Прораб выбирает объект и дату, отмечает бригаду (флажки или скан бейджа), ставит часы пакетом
   («всем по 8») с исключениями, распределяет часы по позициям сметы вида work и вводит выполненный
   объём — один раз на бригаду. «Подтвердить смену» фиксирует стоимость часа и прибавляет объём к смете;
   подтверждённую смену правит только admin/owner с причиной (журнал показывается внизу).
   Ставки и суммы видит только owner/admin (сервер отдаёт null). */
import * as React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { CircleAlert, History, Save, ShieldCheck, Undo2 } from 'lucide-react';
import { Badge, Button, EmptyState, Field, Input, Select, Skeleton, toast } from '@/components/ui';
import { dec, fmt } from '@gr8r/shared';
import { fmtAmount, fmtNumber } from '@/i18n/format';
import { fmtDateTime } from '@/i18n/format';
import { fmtDate, iso, today } from '../lib/dates';
import { useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { useShiftObjects, useShift, useShiftOptions, useShiftApi, type BadgeLookup, type ShiftSaveBody, type ShiftView } from '../objects/shifts-data';
import { BadgeScanner } from './BadgeScanner';

/** Часы работника в черновике экрана: одна строка на работника с выбранной позицией сметы */
interface CrewRow {
  memberId: string;
  hours: string;
  itemId: string;
}

export function ShiftPage() {
  const tt = useT();
  const { id } = useParams();
  return (
    <div className="page shift-page">
      <div className="ph">
        <div>
          <h1>{tt('shifts.page.title')}</h1>
          <p>{tt('shifts.page.subtitle')}</p>
        </div>
        {id && (
          <div className="acts">
            <Link className="btn btn-secondary" to="/shifts">
              {tt('shifts.page.openAnother')}
            </Link>
          </div>
        )}
      </div>
      {id ? <ShiftEditor id={id} /> : <ShiftPicker />}
    </div>
  );
}

/** Выбор объекта и даты: POST открывает смену или возвращает уже открытую на эту тройку (объект, дата, прораб) */
function ShiftPicker() {
  const tt = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const objects = useShiftObjects();
  const api = useShiftApi();
  const [objectId, setObjectId] = React.useState(params.get('object') ?? '');
  const [date, setDate] = React.useState(params.get('date') ?? iso(today()));
  const [busy, setBusy] = React.useState(false);

  const open = async () => {
    if (!objectId) return;
    setBusy(true);
    try {
      const shift = await api.create(objectId, { workDate: date });
      await navigate(`/shifts/${shift.id}`, { replace: true });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (objects.isPending)
    return (
      <div className="shift-stack">
        <Skeleton w="100%" h={80} />
      </div>
    );
  const items = objects.data ?? [];
  if (!items.length)
    return (
      <EmptyState icon={<CircleAlert size={20} />} title={tt('shifts.pick.empty')}>
        {tt('shifts.pick.hint')}
      </EmptyState>
    );

  return (
    <section className="panel panel-b shift-stack" aria-label={tt('shifts.pick.title')}>
      <h2 style={{ margin: 0, fontSize: 'var(--fs-lg)' }}>{tt('shifts.pick.title')}</h2>
      <div className="shift-head">
        <Field label={tt('shifts.pick.object')}>
          {p => (
            <Select
              id={p.id}
              value={objectId}
              onValueChange={setObjectId}
              aria-label={tt('shifts.pick.object')}
              options={[{ value: '', label: '—' }, ...items.map(o => ({ value: o.id, label: `${o.number} · ${o.name}` }))]}
            />
          )}
        </Field>
        <Field label={tt('shifts.pick.date')}>{p => <Input {...p} type="date" value={date} onChange={e => setDate(e.target.value)} />}</Field>
      </div>
      <div className="shift-actions">
        <Button variant="primary" disabled={!objectId || busy} onClick={() => void open()}>
          {tt('shifts.pick.open')}
        </Button>
      </div>
      <p className="faint" style={{ fontSize: 12, margin: 0 }}>
        {tt('shifts.pick.hint')}
      </p>
    </section>
  );
}

function ShiftEditor({ id }: { id: string }) {
  const tt = useT();
  const shift = useShift(id);
  const options = useShiftOptions(shift.data?.objectId);
  const api = useShiftApi();
  const [rows, setRows] = React.useState<CrewRow[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [volumes, setVolumes] = React.useState<Record<string, string>>({});
  const [defaultHours, setDefaultHours] = React.useState('8');
  const [defaultItem, setDefaultItem] = React.useState('');
  const [note, setNote] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const loadedFor = React.useRef<string | null>(null);

  /** Черновик экрана заполняется из смены: у работника одна строка, позиция — первая из его строк */
  React.useEffect(() => {
    const s = shift.data;
    if (!s || loadedFor.current === s.id + s.updatedAt) return;
    loadedFor.current = s.id + s.updatedAt;
    const byMember = new Map<string, CrewRow>();
    for (const h of s.hours) {
      const prev = byMember.get(h.memberId);
      const hours = prev ? fmt(dec(prev.hours) + dec(h.hours), 2) : h.hours;
      byMember.set(h.memberId, { memberId: h.memberId, hours, itemId: prev?.itemId || h.estimateItemId || '' });
    }
    const list = [...byMember.values()];
    setRows(list);
    setSelected(new Set(list.filter(r => Number(r.hours) > 0).map(r => r.memberId)));
    setVolumes(Object.fromEntries(s.volumes.map(v => [v.estimateItemId, v.qty.replace(/\.?0+$/, '')])));
    setNote(s.note);
    if (!defaultItem) setDefaultItem(s.hours.find(h => h.estimateItemId)?.estimateItemId ?? '');
  }, [shift.data, defaultItem]);

  if (shift.isPending) return <Skeleton w="100%" h={200} />;
  if (shift.isError) return <EmptyState icon={<CircleAlert size={20} />} error title={tt('objects.common.error')} />;
  const s = shift.data;
  const opts = options.data;
  const confirmed = s.status === 'confirmed';
  const canEdit = s.canWrite && (!confirmed || s.canSeeCost);
  const workItems = opts?.workItems ?? [];

  const crew = (opts?.members ?? []).map(m => ({
    ...m,
    row: rows.find(r => r.memberId === m.id),
    on: selected.has(m.id),
  }));
  const needle = search.trim().toLowerCase();
  const visible = crew.filter(m => !needle || m.name.toLowerCase().includes(needle) || (m.personnelNumber ?? '').toLowerCase().includes(needle) || (m.badgeCode ?? '').toLowerCase().includes(needle));

  const setRow = (memberId: string, patch: Partial<CrewRow>) =>
    setRows(rs => {
      const found = rs.find(r => r.memberId === memberId);
      if (found) return rs.map(r => (r.memberId === memberId ? { ...r, ...patch } : r));
      return [...rs, { memberId, hours: '', itemId: defaultItem, ...patch }];
    });

  const toggle = (memberId: string, on: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (on) next.add(memberId);
      else next.delete(memberId);
      return next;
    });
    if (on) setRow(memberId, { hours: defaultHours || '8', itemId: rows.find(r => r.memberId === memberId)?.itemId || defaultItem });
  };

  /** Скан бейджа: найденный работник попадает в бригаду; повторный скан строку не дублирует */
  const onBadge = (b: BadgeLookup) => {
    setSelected(prev => new Set([...prev, b.memberId]));
    setRow(b.memberId, { hours: rows.find(r => r.memberId === b.memberId)?.hours || defaultHours || '8' });
    setRows(rs => rs.map(r => (r.memberId === b.memberId ? { ...r, itemId: r.itemId || defaultItem } : r)));
  };

  const applyBulk = () => {
    if (!defaultHours) return;
    setRows(rs => rs.map(r => (selected.has(r.memberId) ? { ...r, hours: defaultHours } : r)));
  };

  const applyItem = (itemId: string) => {
    setDefaultItem(itemId);
    setRows(rs => rs.map(r => (selected.has(r.memberId) ? { ...r, itemId } : r)));
  };

  const body = (): ShiftSaveBody => {
    const hours = rows
      .filter(r => selected.has(r.memberId) && Number(r.hours) > 0)
      .map(r => ({ memberId: r.memberId, hours: r.hours, estimateItemId: (r.itemId || defaultItem) || null }));
    const volumeRows = Object.entries(volumes)
      .filter(([, qty]) => Number(qty) > 0)
      .map(([estimateItemId, qty]) => ({ estimateItemId, qty }));
    return { hours, volumes: volumeRows, note, ...(confirmed ? { reason } : {}) };
  };

  const run = async (fn: () => Promise<ShiftView>, message: string, warnings = false) => {
    setBusy(true);
    try {
      const result = await fn();
      if (warnings && result.warnings?.length) for (const w of result.warnings) toast(tt('shifts.msg.budgetWarning', { category: w.replace('budget_exceeded:', '') }), { duration: 4000 });
      toast(message, { duration: 1500 });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const save = () => run(() => api.save(s.id, body()), tt('shifts.msg.saved'));
  const confirm = async () => {
    setBusy(true);
    try {
      await api.save(s.id, body());
      const result = await api.confirm(s.id);
      for (const w of result.warnings ?? []) toast(tt('shifts.msg.budgetWarning', { category: w.replace('budget_exceeded:', '') }), { duration: 4000 });
      toast(tt('shifts.msg.confirmed'), { duration: 1500 });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const unconfirm = () => run(() => api.unconfirm(s.id, reason), tt('shifts.msg.unconfirmed'));

  return (
    <div className="shift-stack">
      <section className="panel panel-b stack" aria-label={tt('shifts.field.object')} style={{ gap: 10 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <strong>{s.objectNumber}</strong>
          <span className="muted" style={{ minWidth: 0 }}>{s.objectName}</span>
          <Badge tone={confirmed ? 'green' : 'gray'} dot>
            {tt(`shifts.status.${s.status}`)}
          </Badge>
        </div>
        <div className="row faint" style={{ gap: 14, flexWrap: 'wrap', fontSize: 12 }}>
          <span>{fmtDate(s.workDate)}</span>
          <span>{tt('shifts.field.foreman')}: {s.foremanName}</span>
          {s.confirmedAt && <span>{fmtDateTime(s.confirmedAt)}</span>}
        </div>
        {confirmed && <p className="faint" style={{ margin: 0, fontSize: 12 }}>{tt('shifts.locked.confirmed')}</p>}
        {!s.canWrite && <p className="faint" style={{ margin: 0, fontSize: 12 }}>{tt('shifts.locked.notWritable')}</p>}
      </section>

      {canEdit && (
        <section className="panel panel-b stack" aria-label={tt('shifts.bulk.title')} style={{ gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 'var(--fs-lg)' }}>{tt('shifts.bulk.title')}</h2>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Input
              style={{ maxWidth: 110 }}
              inputMode="decimal"
              aria-label={tt('shifts.crew.hours')}
              placeholder={tt('shifts.bulk.placeholder')}
              value={defaultHours}
              onChange={e => setDefaultHours(e.target.value)}
            />
            <Button variant="secondary" onClick={applyBulk}>
              {tt('shifts.bulk.apply')}
            </Button>
          </div>
          <p className="faint" style={{ margin: 0, fontSize: 12 }}>{tt('shifts.bulk.hint')}</p>
          {workItems.length > 0 && (
            <Field label={tt('shifts.items.default')} hint={tt('shifts.items.hint')}>
              {p => (
                <Select
                  id={p.id}
                  value={defaultItem}
                  onValueChange={applyItem}
                  aria-label={tt('shifts.items.default')}
                  options={[{ value: '', label: tt('shifts.crew.noItem') }, ...workItems.map(i => ({ value: i.id, label: i.name }))]}
                />
              )}
            </Field>
          )}
        </section>
      )}

      <section className="panel panel-b stack" aria-label={tt('shifts.crew.title')} style={{ gap: 10 }}>
        <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 'var(--fs-lg)' }}>{tt('shifts.crew.title')}</h2>
          <span className="faint" style={{ fontSize: 12 }}>{tt('shifts.crew.selected', { n: selected.size })}</span>
        </div>
        <Input aria-label={tt('shifts.crew.search')} placeholder={tt('shifts.crew.search')} value={search} onChange={e => setSearch(e.target.value)} />
        {canEdit && <BadgeScanner onFound={onBadge} />}
        <div className="shift-crew">
          {visible.map(m => {
            const row = m.row;
            return (
              <div key={m.id} className={`shift-crew-row${m.on ? ' on' : ''}`}>
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={m.on}
                  disabled={!canEdit}
                  aria-label={m.name}
                  onChange={e => toggle(m.id, e.target.checked)}
                />
                <div className="who">
                  <b>{m.name}</b>
                  <span>{m.personnelNumber ?? '—'}{m.badgeCode ? ` · ${m.badgeCode}` : ''}</span>
                  {m.on && canEdit && workItems.length > 0 && (
                    <Select
                      value={row?.itemId ?? defaultItem}
                      onValueChange={v => setRow(m.id, { itemId: v })}
                      aria-label={tt('shifts.crew.item')}
                      options={[{ value: '', label: tt('shifts.crew.noItem') }, ...workItems.map(i => ({ value: i.id, label: i.name }))]}
                    />
                  )}
                </div>
                <Input
                  inputMode="decimal"
                  aria-label={`${tt('shifts.crew.hours')}: ${m.name}`}
                  disabled={!canEdit || !m.on}
                  value={row?.hours ?? ''}
                  placeholder="0"
                  onChange={e => setRow(m.id, { hours: e.target.value })}
                />
              </div>
            );
          })}
          {!visible.length && <p className="faint" style={{ fontSize: 12 }}>{tt('shifts.crew.empty')}</p>}
        </div>
      </section>

      {canEdit && (
        <section className="panel panel-b stack" aria-label={tt('shifts.volumes.title')} style={{ gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 'var(--fs-lg)' }}>{tt('shifts.volumes.title')}</h2>
          <p className="faint" style={{ margin: 0, fontSize: 12 }}>{tt('shifts.volumes.hint')}</p>
          {opts?.volumeItems.length ? (
            <div className="stack" style={{ gap: 8 }}>
              {opts.volumeItems.map(i => {
                const left = Math.max(Number(i.qty) - Number(i.doneQty), 0);
                return (
                  <div key={i.id} className="shift-volume-row">
                    <div className="nm">
                      <div>{i.name}</div>
                      <span className="faint" style={{ fontSize: 11 }}>
                        {tt('shifts.volumes.left', { qty: fmtNumber(left, { maximumFractionDigits: 3 }), unit: i.unitCode })}
                      </span>
                    </div>
                    <Input
                      inputMode="decimal"
                      aria-label={`${tt('shifts.volumes.qty')}: ${i.name}`}
                      value={volumes[i.id] ?? ''}
                      placeholder="0"
                      onChange={e => setVolumes(v => ({ ...v, [i.id]: e.target.value }))}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="faint" style={{ fontSize: 12 }}>{tt('shifts.volumes.empty')}</p>
          )}
        </section>
      )}

      <section className="panel panel-b stack" style={{ gap: 10 }}>
        <div className="shift-total">
          <span className="faint">{tt('shifts.total.hours')}</span>
          <span className="v num">{fmtNumber(Number(s.totalHours), { maximumFractionDigits: 2 })}</span>
          {s.canSeeCost && (
            <>
              <span className="faint">{tt('shifts.total.cost')}</span>
              <span className="v num">{s.totalAmount == null ? '—' : fmtAmount(s.totalAmount)}</span>
            </>
          )}
        </div>
        {s.noRate > 0 && <p className="faint" style={{ margin: 0, fontSize: 12, color: 'var(--amber, #b45309)' }}>{tt('shifts.total.noRate', { n: s.noRate })}</p>}
        {!s.canSeeCost && <p className="faint" style={{ margin: 0, fontSize: 12 }}>{tt('shifts.total.hidden')}</p>}
        <Field label={tt('shifts.field.note')}>{p => <Input {...p} value={note} disabled={!canEdit} onChange={e => setNote(e.target.value)} />}</Field>
        {confirmed && canEdit && (
          <Field label={tt('shifts.action.reason')} hint={tt('shifts.action.reasonRequired')}>
            {p => <Input {...p} value={reason} onChange={e => setReason(e.target.value)} />}
          </Field>
        )}
        {canEdit && (
          <div className="shift-actions">
            <Button variant="secondary" disabled={busy} onClick={() => void save()}>
              <Save size={14} />
              {confirmed ? tt('shifts.action.saveConfirmed') : tt('shifts.action.save')}
            </Button>
            {!confirmed && (
              <Button variant="primary" disabled={busy} onClick={() => void confirm()}>
                <ShieldCheck size={14} />
                {tt('shifts.action.confirm')}
              </Button>
            )}
            {confirmed && (
              <Button variant="secondary" disabled={busy || !reason.trim()} onClick={() => void unconfirm()}>
                <Undo2 size={14} />
                {tt('shifts.action.unconfirm')}
              </Button>
            )}
          </div>
        )}
        {!canEdit && !confirmed && <p className="faint" style={{ fontSize: 12, margin: 0 }}>{tt('shifts.crew.nothingSelected')}</p>}
      </section>

      <section className="panel panel-b stack" aria-label={tt('shifts.log.title')} style={{ gap: 8 }}>
        <h2 className="row" style={{ margin: 0, fontSize: 'var(--fs-lg)', gap: 6 }}>
          <History size={16} />
          {tt('shifts.log.title')}
        </h2>
        {s.log.length ? (
          s.log.map(l => (
            <div key={l.id} className="stack" style={{ gap: 2, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 13 }}>{tt(`shifts.log.action.${l.action}` as 'shifts.log.action.created')}</strong>
                <span className="faint" style={{ fontSize: 11 }}>
                  {fmtDateTime(l.at)} {l.authorName ? `· ${tt('shifts.log.by', { name: l.authorName })}` : ''}
                </span>
              </div>
              {l.reason && (
                <span className="muted" style={{ fontSize: 12 }}>
                  {tt('shifts.log.reason')}: {l.reason}
                </span>
              )}
              {l.action === 'updated' && <LogDiff before={l.before} after={l.after} />}
            </div>
          ))
        ) : (
          <p className="faint" style={{ margin: 0, fontSize: 12 }}>{tt('shifts.log.empty')}</p>
        )}
      </section>
    </div>
  );
}

/** Что было → что стало: часы по работникам и объёмы (без денег) */
function LogDiff({ before, after }: { before: unknown; after: unknown }) {
  const tt = useT();
  const sum = (v: unknown): string => {
    const rows = (v as { hours?: { hours: string }[]; volumes?: { qty: string }[] } | null) ?? {};
    const hours = (rows.hours ?? []).reduce((s, h) => s + Number(h.hours), 0);
    const volumes = (rows.volumes ?? []).reduce((s, x) => s + Number(x.qty), 0);
    return `${tt('shifts.total.hours')} ${fmtNumber(hours, { maximumFractionDigits: 2 })} · ${tt('shifts.volumes.title')} ${fmtNumber(volumes, { maximumFractionDigits: 3 })}`;
  };
  return (
    <span className="faint" style={{ fontSize: 11 }}>
      {tt('shifts.log.before')}: {sum(before)} → {tt('shifts.log.after')}: {sum(after)}
    </span>
  );
}
