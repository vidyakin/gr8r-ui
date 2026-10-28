/* Виды цен и прайс-листы (задача 1178): справочник видов цен, документ «Установка цен», экран прайс-листа с печатью,
   выгрузкой, загрузкой из файла и публичными ссылками. Шапка сверху, таблица ниже (как в 1С). */
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CircleAlert, Copy, Download, FilePlus2, Link as LinkIcon, Percent, Plus, Printer, Trash2, Upload, Wand2 } from 'lucide-react';
import { Badge, Button, Checkbox, ConfirmDialog, Dialog, DialogContent, EmptyState, Field, IconButton, Input, Select, Skeleton, toast } from '@/components/ui';
import { fmtAmount, useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { useCanWrite } from '../meta/custom-fields';
import { useCategories, useCompanies, useIsAdmin } from '../catalog/data';
import { fmtDate } from '../lib/dates';
import { useOrganizations } from '../docs/data';
import { ProductPicker } from '../docs/pickers';
import {
  usePriceKinds,
  usePriceLinks,
  usePriceList,
  usePricingApi,
  useSetting,
  useSettings,
  type ImportPreview,
  type PriceKind,
  type PriceKindBody,
  type PriceListParams,
  type SettingLine,
} from './data';

const today = () => new Date().toISOString().slice(0, 10);

function useRun() {
  const [busy, setBusy] = React.useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function StatusBadge({ status }: { status: string }) {
  const tt = useT();
  return (
    <Badge tone={status === 'posted' ? 'green' : status === 'draft' ? 'gray' : 'neutral'} dot>
      {status === 'posted' ? tt('pricing.posted') : tt('pricing.draft')}
    </Badge>
  );
}

/** Вид цен виден без права на себестоимость: не закупочная, не от себестоимости и не цены поставщика */
const isPublicKind = (k: PriceKind) => k.systemKey !== 'purchase' && k.method !== 'cost_based' && !k.supplierId;

/* ---------------- виды цен ---------------- */

const ROUNDING_STEPS = ['0.01', '1', '10', '100'] as const;

function KindDialog({ kind, onClose }: { kind: PriceKind | null; onClose: () => void }) {
  const tt = useT();
  const api = usePricingApi();
  const kinds = usePriceKinds();
  const companies = useCompanies();
  const { busy, run } = useRun();
  const [name, setName] = React.useState(kind?.name ?? '');
  const [method, setMethod] = React.useState<PriceKind['method']>(kind?.method ?? 'manual');
  const [baseKindId, setBaseKindId] = React.useState(kind?.baseKindId ?? '');
  const [markup, setMarkup] = React.useState(kind ? String(Number(kind.markupPct)) : '0');
  const [costBasis, setCostBasis] = React.useState<'avg_cost' | 'last_purchase'>(kind?.costBasis ?? 'avg_cost');
  const [step, setStep] = React.useState(kind ? String(Number(kind.roundingStep)) : '0.01');
  const [mode, setMode] = React.useState<'math' | 'up'>(kind?.roundingMode ?? 'math');
  const [nine, setNine] = React.useState(kind?.roundToNine ?? false);
  const [vat, setVat] = React.useState(kind?.includesVat ?? true);
  const [supplierId, setSupplierId] = React.useState(kind?.supplierId ?? '');
  const [fromReceipts, setFromReceipts] = React.useState(kind?.updateFromReceipts ?? false);
  const system = !!kind?.systemKey;
  const rule = method !== 'manual';
  const nineOk = Number(step) >= 10;
  const bases = (kinds.data ?? []).filter(k => k.id !== kind?.id);
  const valid = !!name.trim() && (method !== 'derived' || !!baseKindId);

  const save = () =>
    run(async () => {
      const body: PriceKindBody = {
        name: name.trim(),
        ...(kind ? {} : { method }),
        ...(system ? {} : { baseKindId: method === 'derived' ? baseKindId : null, costBasis: method === 'cost_based' ? costBasis : null, supplierId: supplierId || null }),
        markupPct: markup || '0',
        roundingStep: step,
        roundingMode: mode,
        roundToNine: nine && nineOk,
        includesVat: vat,
        updateFromReceipts: fromReceipts,
      };
      if (kind) await api.updateKind(kind.id, body);
      else await api.saveKind(body);
      onClose();
    });

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent
        title={kind ? tt('pricing.kinds.edit') : tt('pricing.kinds.new')}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>{tt('pricing.cancel')}</Button>
            <Button variant="primary" disabled={busy || !valid} onClick={() => void save()}>{tt('pricing.save')}</Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <Field label={tt('pricing.kinds.name')}>{p => <Input {...p} value={name} onChange={e => setName(e.target.value)} />}</Field>
          {!system && (
            <Field label={tt('pricing.kinds.method')}>
              {p => (
                <Select
                  id={p.id}
                  disabled={!!kind}
                  value={method}
                  onValueChange={v => setMethod(v as PriceKind['method'])}
                  options={(['manual', 'derived', 'cost_based'] as const).map(m => ({ value: m, label: tt(`pricing.method.${m}`) }))}
                />
              )}
            </Field>
          )}
          {method === 'derived' && !system && (
            <Field label={tt('pricing.kinds.base')}>{p => <Select id={p.id} value={baseKindId} onValueChange={setBaseKindId} placeholder={tt('pricing.kinds.pickBase')} options={bases.map(k => ({ value: k.id, label: k.name }))} />}</Field>
          )}
          {method === 'cost_based' && !system && (
            <Field label={tt('pricing.kinds.costBasis')}>
              {p => <Select id={p.id} value={costBasis} onValueChange={v => setCostBasis(v as typeof costBasis)} options={(['avg_cost', 'last_purchase'] as const).map(b => ({ value: b, label: tt(`pricing.costBasis.${b}`) }))} />}
            </Field>
          )}
          {rule && (
            <Field label={tt('pricing.kinds.markup')} hint={tt('pricing.kinds.markupHint')}>{p => <Input {...p} inputMode="decimal" value={markup} onChange={e => setMarkup(e.target.value)} />}</Field>
          )}
          <div className="row" style={{ gap: 8 }}>
            <Field label={tt('pricing.kinds.step')}>{p => <Select id={p.id} value={step} onValueChange={setStep} options={ROUNDING_STEPS.map(s => ({ value: s, label: s }))} />}</Field>
            <Field label={tt('pricing.kinds.mode')}>{p => <Select id={p.id} value={mode} onValueChange={v => setMode(v as 'math' | 'up')} options={(['math', 'up'] as const).map(m => ({ value: m, label: tt(`pricing.mode.${m}`) }))} />}</Field>
          </div>
          <label className="row" style={{ gap: 6 }}>
            <Checkbox checked={nine && nineOk} disabled={!nineOk} onChange={e => setNine(e.target.checked)} /> {tt('pricing.kinds.nine')}
          </label>
          <label className="row" style={{ gap: 6 }}>
            <Checkbox checked={vat} onChange={e => setVat(e.target.checked)} /> {tt('pricing.kinds.includesVat')}
          </label>
          {!system && method === 'manual' && (
            <Field label={tt('pricing.kinds.supplier')} hint={tt('pricing.kinds.supplierHint')}>
              {p => <Select id={p.id} value={supplierId} placeholder={tt('pricing.kinds.noSupplier')} onValueChange={setSupplierId} options={[{ value: '', label: tt('pricing.kinds.noSupplier') }, ...(companies.data ?? []).map(c => ({ value: c.id, label: c.name }))]} />}
            </Field>
          )}
          {(supplierId || kind?.systemKey === 'purchase') && (
            <label className="row" style={{ gap: 6 }}>
              <Checkbox checked={fromReceipts} onChange={e => setFromReceipts(e.target.checked)} /> {tt('pricing.kinds.fromReceipts')}
            </label>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PriceKindsPage() {
  const tt = useT();
  const isAdmin = useIsAdmin();
  const api = usePricingApi();
  const q = usePriceKinds();
  const { run } = useRun();
  const [editing, setEditing] = React.useState<PriceKind | 'new' | null>(null);
  const [removing, setRemoving] = React.useState<PriceKind | null>(null);
  const rows = q.data ?? [];
  const rule = (k: PriceKind) => {
    if (k.method === 'derived') return tt('pricing.kinds.ruleDerived', { base: k.baseKindName ?? '', pct: String(Number(k.markupPct)) });
    if (k.method === 'cost_based') return tt('pricing.kinds.ruleCost', { basis: tt(`pricing.costBasis.${k.costBasis ?? 'avg_cost'}`), pct: String(Number(k.markupPct)) });
    return k.supplierName ? tt('pricing.kinds.ruleSupplier', { name: k.supplierName }) : tt('pricing.method.manual');
  };
  const rounding = (k: PriceKind) => `${Number(k.roundingStep)}${k.roundingMode === 'up' ? ` ${tt('pricing.mode.upShort')}` : ''}${k.roundToNine ? ' · 9' : ''}`;
  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{tt('pricing.kinds.title')}</h1>
          <p>{tt('pricing.kinds.subtitle')}</p>
        </div>
        <div className="acts">
          {isAdmin && (
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Plus size={14} />
              {tt('pricing.kinds.new')}
            </Button>
          )}
        </div>
      </div>
      {q.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={tt('pricing.kinds.title')} action={<Button size="sm" onClick={() => q.refetch()}>{tt('pricing.retry')}</Button>}>
          {errorMessage(q.error)}
        </EmptyState>
      ) : q.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : (
        <div className="table-wrap" style={{ padding: '0 var(--gutter) 24px' }}>
          <table className="dtbl" aria-label={tt('pricing.kinds.title')}>
            <thead>
              <tr>
                <th>{tt('pricing.kinds.name')}</th>
                <th>{tt('pricing.kinds.rule')}</th>
                <th style={{ width: 150 }}>{tt('pricing.kinds.rounding')}</th>
                <th style={{ width: 110 }}>{tt('pricing.kinds.vat')}</th>
                <th style={{ width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map(k => (
                <tr key={k.id}>
                  <td>
                    {isAdmin ? <button type="button" className="crm-link" onClick={() => setEditing(k)}>{k.name}</button> : k.name}
                    {k.systemKey && <Badge tone="gray" className="ml-2">{tt('pricing.kinds.system')}</Badge>}
                  </td>
                  <td className="muted">{rule(k)}{k.updateFromReceipts ? ` · ${tt('pricing.kinds.fromReceiptsShort')}` : ''}</td>
                  <td className="muted">{rounding(k)}</td>
                  <td className="muted">{k.includesVat ? tt('pricing.kinds.vatIncluded') : tt('pricing.kinds.vatExcluded')}</td>
                  <td>{isAdmin && !k.systemKey && <IconButton label={tt('pricing.archive')} onClick={() => setRemoving(k)}><Trash2 size={14} /></IconButton>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <KindDialog kind={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!removing} onOpenChange={v => !v && setRemoving(null)} title={tt('pricing.kinds.archiveTitle')} confirmLabel={tt('pricing.archive')} onConfirm={() => run(async () => { await api.archiveKind(removing!.id); setRemoving(null); })} />
    </div>
  );
}

/* ---------------- установка цен ---------------- */

export function PriceSettingsPage() {
  const tt = useT();
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const list = useSettings();
  const rows = list.data?.items ?? [];
  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{tt('pricing.settings.title')}</h1>
          <p>{tt('pricing.settings.subtitle')}</p>
        </div>
        <div className="acts">
          {isAdmin && (
            <Button variant="primary" onClick={() => void navigate('/pricing/settings/new')}>
              <FilePlus2 size={14} />
              {tt('pricing.settings.new')}
            </Button>
          )}
        </div>
      </div>
      {!isAdmin ? (
        <EmptyState icon={<CircleAlert size={20} />} title={tt('pricing.settings.title')}>{tt('pricing.adminOnly')}</EmptyState>
      ) : list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={tt('pricing.settings.title')} action={<Button size="sm" onClick={() => list.refetch()}>{tt('pricing.retry')}</Button>}>
          {errorMessage(list.error)}
        </EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !rows.length ? (
        <EmptyState icon={<FilePlus2 size={20} />} title={tt('pricing.settings.empty')}>{tt('pricing.settings.emptyHint')}</EmptyState>
      ) : (
        <div className="table-wrap" style={{ padding: '0 var(--gutter) 24px' }}>
          <table className="dtbl" aria-label={tt('pricing.settings.title')}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>{tt('pricing.number')}</th>
                <th style={{ width: 110 }}>{tt('pricing.date')}</th>
                <th style={{ width: 130 }}>{tt('pricing.status')}</th>
                <th>{tt('pricing.comment')}</th>
                <th style={{ width: 110 }} className="r">{tt('pricing.settings.lines')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="mono"><Link to={`/pricing/settings/${r.id}`} className="crm-link">{r.number ?? tt('pricing.draft')}</Link></td>
                  <td className="muted">{fmtDate(r.date)}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className="muted">{r.comment}</td>
                  <td className="r num">{r.lineCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface Line {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  priceKindId: string;
  price: string;
  oldPrice: string | null;
}

function FillDialog({ settingId, onClose, kinds, run }: { settingId: string; onClose: () => void; kinds: PriceKind[]; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const tt = useT();
  const api = usePricingApi();
  const cats = useCategories();
  const [mode, setMode] = React.useState<'all' | 'category' | 'receipt'>('all');
  const [picked, setPicked] = React.useState<string[]>([]);
  const [categoryId, setCategoryId] = React.useState('');
  const [receiptId, setReceiptId] = React.useState('');
  const receipts = useReceipts(mode === 'receipt');
  const valid = picked.length > 0 && (mode !== 'category' || !!categoryId) && (mode !== 'receipt' || !!receiptId);
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent
        title={tt('pricing.fill.title')}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>{tt('pricing.cancel')}</Button>
            <Button variant="primary" disabled={!valid} onClick={() => void run(async () => { await api.fillSetting(settingId, { mode, priceKindIds: picked, categoryId: mode === 'category' ? categoryId : null, receiptId: mode === 'receipt' ? receiptId : null }); onClose(); })}>{tt('pricing.fill.apply')}</Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <Field label={tt('pricing.fill.mode')}>{p => <Select id={p.id} value={mode} onValueChange={v => setMode(v as typeof mode)} options={(['all', 'category', 'receipt'] as const).map(m => ({ value: m, label: tt(`pricing.fill.${m}`) }))} />}</Field>
          {mode === 'category' && <Field label={tt('pricing.category')}>{p => <Select id={p.id} value={categoryId} onValueChange={setCategoryId} options={(cats.data ?? []).map(c => ({ value: c.id, label: c.name }))} />}</Field>}
          {mode === 'receipt' && <Field label={tt('pricing.fill.receipt')}>{p => <Select id={p.id} value={receiptId} onValueChange={setReceiptId} options={receipts.map(r => ({ value: r.id, label: `${r.number ?? tt('pricing.draft')} · ${fmtDate(r.date)}` }))} />}</Field>}
          <KindChecks kinds={kinds} value={picked} onChange={setPicked} label={tt('pricing.fill.kinds')} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Последние поступления для заполнения установки цен */
function useReceipts(enabled: boolean): { id: string; number: string | null; date: string }[] {
  const [rows, setRows] = React.useState<{ id: string; number: string | null; date: string }[]>([]);
  const { run } = useRun();
  const api = usePricingApi();
  React.useEffect(() => {
    if (!enabled) return;
    void run(async () => setRows(await api.receipts()));
  }, [enabled]);
  return rows;
}

function KindChecks({ kinds, value, onChange, label }: { kinds: PriceKind[]; value: string[]; onChange: (v: string[]) => void; label: string }) {
  return (
    <fieldset className="stack" style={{ gap: 4, border: 0, padding: 0 }}>
      <legend className="muted" style={{ marginBottom: 4 }}>{label}</legend>
      {kinds.map(k => (
        <label key={k.id} className="row" style={{ gap: 6 }}>
          <Checkbox checked={value.includes(k.id)} onChange={e => onChange(e.target.checked ? [...value, k.id] : value.filter(x => x !== k.id))} /> {k.name}
        </label>
      ))}
    </fieldset>
  );
}

function MassDialog({ settingId, onClose, run }: { settingId: string; onClose: () => void; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const tt = useT();
  const api = usePricingApi();
  const [action, setAction] = React.useState<'percent' | 'round' | 'rule'>('percent');
  const [percent, setPercent] = React.useState('10');
  const [step, setStep] = React.useState('1');
  const [mode, setMode] = React.useState<'math' | 'up'>('math');
  const [nine, setNine] = React.useState(false);
  const nineOk = Number(step) >= 10;
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent
        title={tt('pricing.mass.title')}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>{tt('pricing.cancel')}</Button>
            <Button
              variant="primary"
              onClick={() =>
                void run(async () => {
                  const r = await api.massSetting(settingId, { action, ...(action === 'percent' ? { percent } : {}), ...(action !== 'rule' ? { roundingStep: step, roundingMode: mode, roundToNine: nine && nineOk } : {}) });
                  toast(tt('pricing.mass.done', { n: r.changed }), { duration: 2000 });
                  onClose();
                })
              }
            >
              {tt('pricing.mass.apply')}
            </Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <Field label={tt('pricing.mass.action')}>{p => <Select id={p.id} value={action} onValueChange={v => setAction(v as typeof action)} options={(['percent', 'round', 'rule'] as const).map(a => ({ value: a, label: tt(`pricing.mass.${a}`) }))} />}</Field>
          {action === 'percent' && <Field label={tt('pricing.mass.percentValue')} hint={tt('pricing.kinds.markupHint')}>{p => <Input {...p} inputMode="decimal" value={percent} onChange={e => setPercent(e.target.value)} />}</Field>}
          {action !== 'rule' && (
            <>
              <div className="row" style={{ gap: 8 }}>
                <Field label={tt('pricing.kinds.step')}>{p => <Select id={p.id} value={step} onValueChange={setStep} options={ROUNDING_STEPS.map(s => ({ value: s, label: s }))} />}</Field>
                <Field label={tt('pricing.kinds.mode')}>{p => <Select id={p.id} value={mode} onValueChange={v => setMode(v as 'math' | 'up')} options={(['math', 'up'] as const).map(m => ({ value: m, label: tt(`pricing.mode.${m}`) }))} />}</Field>
              </div>
              <label className="row" style={{ gap: 6 }}>
                <Checkbox checked={nine && nineOk} disabled={!nineOk} onChange={e => setNine(e.target.checked)} /> {tt('pricing.kinds.nine')}
              </label>
            </>
          )}
          {action === 'rule' && <p className="muted">{tt('pricing.mass.ruleHint')}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PriceSettingPage() {
  const tt = useT();
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const canWrite = useCanWrite();
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const api = usePricingApi();
  const q = useSetting(isNew ? undefined : id);
  const detail = isNew ? null : q.data;
  const orgs = useOrganizations();
  const kinds = usePriceKinds();
  const { busy, run } = useRun();
  const [organizationId, setOrganizationId] = React.useState('');
  const [date, setDate] = React.useState(today());
  const [comment, setComment] = React.useState('');
  const [lines, setLines] = React.useState<Line[]>([]);
  const [removing, setRemoving] = React.useState(false);
  const [dialog, setDialog] = React.useState<'fill' | 'mass' | null>(null);
  const loadedFor = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!isNew || organizationId || !orgs.data?.length) return;
    setOrganizationId((orgs.data.find(o => o.isDefault) ?? orgs.data[0]!).id);
  }, [isNew, organizationId, orgs.data]);

  React.useEffect(() => {
    if (!detail) return;
    const stamp = `${detail.id}|${detail.status}|${detail.lines.length}|${detail.lines.map(l => l.price).join(',')}`;
    if (loadedFor.current === stamp) return;
    loadedFor.current = stamp;
    setOrganizationId(detail.organizationId);
    setDate(detail.date);
    setComment(detail.comment);
    setLines(detail.lines.map((l: SettingLine) => ({ id: l.id, productId: l.productId, productName: l.productName, sku: l.sku, priceKindId: l.priceKindId, price: l.price, oldPrice: l.oldPrice })));
  }, [detail]);

  const editable = isAdmin && canWrite && (!detail || detail.status === 'draft');
  const kindOptions = (kinds.data ?? []).map(k => ({ value: k.id, label: k.name }));
  const body = () => ({ date, organizationId, comment, lines: lines.map(l => ({ id: l.id, productId: l.productId, priceKindId: l.priceKindId, price: l.price || '0' })) });
  const keys = lines.map(l => `${l.productId}|${l.priceKindId}`);
  const dup = new Set(keys.filter((k, i) => keys.indexOf(k) !== i));
  const valid = !!organizationId && lines.length > 0 && lines.every(l => l.productId && l.priceKindId && Number(l.price) >= 0 && l.price !== '') && !dup.size;

  const save = () =>
    run(async () => {
      const saved = detail ? await api.updateSetting(detail.id, body()) : await api.saveSetting(body());
      toast(tt('pricing.saved'), { duration: 1500 });
      if (!detail) await navigate(`/pricing/settings/${saved.id}`, { replace: true });
    });
  /** Заполнение и массовое изменение работают с сохранённым документом */
  const ensureSaved = async (): Promise<string> => {
    if (detail) {
      await api.updateSetting(detail.id, body());
      return detail.id;
    }
    const saved = await api.saveSetting(body());
    await navigate(`/pricing/settings/${saved.id}`, { replace: true });
    return saved.id;
  };
  const [targetId, setTargetId] = React.useState<string | null>(null);
  const open = (kind: 'fill' | 'mass') =>
    run(async () => {
      setTargetId(await ensureSaved());
      setDialog(kind);
    });
  const post = () =>
    run(async () => {
      if (!detail) return;
      await api.updateSetting(detail.id, body());
      await api.action(detail.id, 'post');
    });

  if (!isNew && q.isPending)
    return (
      <div className="page flush">
        <div className="ph">
          <Skeleton w={260} h={24} />
        </div>
      </div>
    );

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{detail?.number ?? tt('pricing.settings.newTitle')}</h1>
          <p>{tt('pricing.settings.title')}</p>
        </div>
        <div className="acts">
          {detail && <StatusBadge status={detail.status} />}
          {editable && <Button disabled={busy || !organizationId} onClick={() => void open('fill')}><Wand2 size={14} />{tt('pricing.fill.title')}</Button>}
          {editable && <Button disabled={busy || !lines.length} onClick={() => void open('mass')}><Percent size={14} />{tt('pricing.mass.title')}</Button>}
          {editable && <Button variant="primary" disabled={busy || !valid} onClick={() => void save()}>{detail ? tt('pricing.save') : tt('pricing.create')}</Button>}
          {detail && detail.status === 'draft' && editable && <Button disabled={busy || !valid} onClick={() => void post()}>{tt('pricing.post')}</Button>}
          {detail && detail.status === 'posted' && isAdmin && <Button disabled={busy} onClick={() => void run(() => api.action(detail.id, 'unpost'))}>{tt('pricing.unpost')}</Button>}
          {detail && detail.status === 'draft' && editable && <Button variant="ghost" onClick={() => setRemoving(true)}>{tt('pricing.delete')}</Button>}
        </div>
      </div>

      <section className="panel doc-head" aria-label={tt('pricing.date')}>
        <Field label={tt('pricing.date')}>{p => <Input {...p} type="date" disabled={!editable} value={date} onChange={e => setDate(e.target.value)} />}</Field>
        <Field label={tt('pricing.organization')}>
          {p => <Select id={p.id} disabled={!editable || !!detail?.number} value={organizationId} onValueChange={setOrganizationId} options={(orgs.data ?? []).map(o => ({ value: o.id, label: o.name }))} aria-label={tt('pricing.organization')} />}
        </Field>
      </section>

      <section className="doc-lines panel" aria-label={tt('pricing.settings.lines')}>
        <div className="table-wrap">
          <table className="dtbl" aria-label={tt('pricing.settings.lines')}>
            <thead>
              <tr>
                <th style={{ width: 34 }}>#</th>
                <th>{tt('pricing.product')}</th>
                <th style={{ width: 120 }}>{tt('pricing.sku')}</th>
                <th style={{ width: 200 }}>{tt('pricing.kind')}</th>
                <th style={{ width: 120 }} className="r">{tt('pricing.oldPrice')}</th>
                <th style={{ width: 140 }} className="r">{tt('pricing.price')}</th>
                <th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const set = (patch: Partial<Line>) => setLines(prev => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                const isDup = dup.has(`${l.productId}|${l.priceKindId}`);
                return (
                  <tr key={l.id}>
                    <td className="faint num">{i + 1}</td>
                    <td><ProductPicker value={l.productName} price="price" disabled={!editable} invalid={isDup} onPick={p => set({ productId: p.id, productName: p.name, sku: p.sku, price: l.price || p.price })} /></td>
                    <td className="mono muted">{l.sku}</td>
                    <td><Select aria-label={tt('pricing.kind')} disabled={!editable} value={l.priceKindId} onValueChange={v => set({ priceKindId: v })} options={kindOptions} /></td>
                    <td className="r num muted">{l.oldPrice === null ? '' : fmtAmount(l.oldPrice)}</td>
                    <td className="r"><Input aria-label={tt('pricing.price')} inputMode="decimal" disabled={!editable} invalid={isDup} value={l.price} onChange={e => set({ price: e.target.value })} /></td>
                    <td>{editable && <IconButton label={tt('pricing.remove')} onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}><Trash2 size={14} /></IconButton>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ justifyContent: 'space-between', padding: '8px 12px' }}>
          {editable ? (
            <Button size="sm" onClick={() => setLines(prev => [...prev, { id: crypto.randomUUID(), productId: '', productName: '', sku: '', priceKindId: (kinds.data ?? [])[0]?.id ?? '', price: '', oldPrice: null }])}>
              <Plus size={14} />
              {tt('pricing.addLine')}
            </Button>
          ) : <span />}
          {dup.size > 0 && <span className="muted">{tt('pricing.duplicate')}</span>}
        </div>
      </section>

      <section className="panel doc-head" aria-label={tt('pricing.comment')}>
        <Field label={tt('pricing.comment')}>{p => <Input {...p} disabled={!editable} value={comment} onChange={e => setComment(e.target.value)} />}</Field>
      </section>

      {dialog === 'fill' && targetId && <FillDialog settingId={targetId} kinds={kinds.data ?? []} run={run} onClose={() => setDialog(null)} />}
      {dialog === 'mass' && targetId && <MassDialog settingId={targetId} run={run} onClose={() => setDialog(null)} />}
      <ConfirmDialog open={removing} onOpenChange={setRemoving} title={tt('pricing.deleteTitle')} confirmLabel={tt('pricing.delete')} onConfirm={() => run(async () => { await api.remove(detail!.id); await navigate('/pricing/settings'); })} />
    </div>
  );
}

/* ---------------- прайс-лист ---------------- */

function ImportDialog({ onClose }: { onClose: () => void }) {
  const tt = useT();
  const api = usePricingApi();
  const navigate = useNavigate();
  const { busy, run } = useRun();
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const pick = (f: File | null) => {
    setFile(f);
    setPreview(null);
    if (f) void run(async () => setPreview(await api.importPreview(f)));
  };
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent
        size="lg"
        title={tt('pricing.import.title')}
        description={tt('pricing.import.hint')}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>{tt('pricing.cancel')}</Button>
            <Button variant="primary" disabled={busy || !file || !preview || preview.summary.matched === 0} onClick={() => void run(async () => { const r = await api.importApply(file!); onClose(); await navigate(`/pricing/settings/${r.id}`); })}>{tt('pricing.import.create')}</Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <input type="file" accept=".xlsx,.csv,text/csv" aria-label={tt('pricing.import.file')} onChange={e => pick(e.target.files?.[0] ?? null)} />
          {preview && (
            <>
              <p className="muted">{tt('pricing.import.summary', { rows: preview.summary.rows, matched: preview.summary.matched, unmatched: preview.summary.unmatched })}</p>
              <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}>
                <table className="dtbl" aria-label={tt('pricing.import.title')}>
                  <thead>
                    <tr>
                      <th style={{ width: 50 }}>#</th>
                      <th>{tt('pricing.product')}</th>
                      <th>{tt('pricing.import.found')}</th>
                      <th>{tt('pricing.import.changes')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 200).map(r => (
                      <tr key={r.rowNo}>
                        <td className="faint num">{r.rowNo}</td>
                        <td>{r.name || r.sku}</td>
                        <td className={r.productId ? '' : 'muted'}>{r.productId ? r.productName : tt('pricing.import.notFound')}</td>
                        <td className="num">
                          {r.lines.map(l => (
                            <div key={l.priceKindId}>{l.priceKindName}: {l.current === null ? '—' : fmtAmount(l.current)} → <b>{fmtAmount(l.price)}</b></div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LinksDialog({ kinds, onClose }: { kinds: PriceKind[]; onClose: () => void }) {
  const tt = useT();
  const api = usePricingApi();
  const links = usePriceLinks(true);
  const cats = useCategories();
  const { busy, run } = useRun();
  const publicKinds = kinds.filter(isPublicKind);
  const [name, setName] = React.useState('');
  const [picked, setPicked] = React.useState<string[]>(() => publicKinds.filter(k => k.systemKey === 'retail').map(k => k.id));
  const [categoryId, setCategoryId] = React.useState('');
  const [inStock, setInStock] = React.useState(false);
  const [expires, setExpires] = React.useState('');
  const [created, setCreated] = React.useState<string | null>(null);
  const create = () =>
    run(async () => {
      const r = await api.createLink({ name: name.trim(), priceKindIds: picked, categoryIds: categoryId ? [categoryId] : [], inStockOnly: inStock, expiresAt: expires || null });
      // приложение на hash-маршрутах: публичная страница открывается как /#/p/price/<токен>
      setCreated(`${window.location.origin}/#${r.path}`);
      setName('');
    });
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent size="lg" title={tt('pricing.links.title')} description={tt('pricing.links.hint')} footer={<Button onClick={onClose}>{tt('pricing.close')}</Button>}>
        <div className="stack" style={{ gap: 12 }}>
          {created && (
            <div className="panel" style={{ padding: 12 }}>
              <p className="muted">{tt('pricing.links.createdHint')}</p>
              <div className="row" style={{ gap: 8 }}>
                <Input readOnly value={created} aria-label={tt('pricing.links.url')} onFocus={e => e.currentTarget.select()} />
                <IconButton label={tt('pricing.links.copy')} onClick={() => void navigator.clipboard.writeText(created).then(() => toast(tt('pricing.links.copied'), { duration: 1500 }))}><Copy size={14} /></IconButton>
              </div>
            </div>
          )}
          <div className="stack" style={{ gap: 8 }}>
            <Field label={tt('pricing.links.name')}>{p => <Input {...p} value={name} onChange={e => setName(e.target.value)} />}</Field>
            <KindChecks kinds={publicKinds} value={picked} onChange={setPicked} label={tt('pricing.links.kinds')} />
            <div className="row" style={{ gap: 8 }}>
              <Field label={tt('pricing.links.category')}>{p => <Select id={p.id} value={categoryId} placeholder={tt('pricing.allCategories')} onValueChange={setCategoryId} options={[{ value: '', label: tt('pricing.allCategories') }, ...(cats.data ?? []).map(c => ({ value: c.id, label: c.name }))]} />}</Field>
              <Field label={tt('pricing.links.expires')}>{p => <Input {...p} type="date" value={expires} onChange={e => setExpires(e.target.value)} />}</Field>
            </div>
            <label className="row" style={{ gap: 6 }}>
              <Checkbox checked={inStock} onChange={e => setInStock(e.target.checked)} /> {tt('pricing.inStock')}
            </label>
            <div><Button variant="primary" disabled={busy || !name.trim() || !picked.length} onClick={() => void create()}><LinkIcon size={14} />{tt('pricing.links.create')}</Button></div>
          </div>
          {(links.data ?? []).length > 0 && (
            <table className="dtbl" aria-label={tt('pricing.links.title')}>
              <thead>
                <tr>
                  <th>{tt('pricing.links.name')}</th>
                  <th style={{ width: 120 }}>{tt('pricing.links.expires')}</th>
                  <th style={{ width: 90 }} className="r">{tt('pricing.links.views')}</th>
                  <th style={{ width: 110 }}>{tt('pricing.status')}</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {(links.data ?? []).map(l => (
                  <tr key={l.id}>
                    <td>{l.name}</td>
                    <td className="muted">{l.expiresAt ? fmtDate(l.expiresAt) : '—'}</td>
                    <td className="r num">{l.viewCount}</td>
                    <td>{l.revokedAt ? <Badge tone="neutral">{tt('pricing.links.revoked')}</Badge> : <Badge tone="green" dot>{tt('pricing.links.active')}</Badge>}</td>
                    <td>{!l.revokedAt && <IconButton label={tt('pricing.links.revoke')} onClick={() => void run(() => api.revokeLink(l.id))}><Trash2 size={14} /></IconButton>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PriceListPage() {
  const tt = useT();
  const isAdmin = useIsAdmin();
  const api = usePricingApi();
  const kinds = usePriceKinds();
  const cats = useCategories();
  const { run } = useRun();
  const [picked, setPicked] = React.useState<string[] | null>(null);
  const [categoryId, setCategoryId] = React.useState('');
  const [date, setDate] = React.useState(today());
  const [inStock, setInStock] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [dialog, setDialog] = React.useState<'import' | 'links' | null>(null);
  const retailId = (kinds.data ?? []).find(k => k.systemKey === 'retail')?.id;
  const kindIds = picked ?? (retailId ? [retailId] : []);
  const params: PriceListParams = { kindIds, ...(categoryId ? { categoryId } : {}), date, inStock, ...(search.trim() ? { q: search.trim() } : {}) };
  const q = usePriceList(params, !!retailId);
  const data = q.data;
  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{tt('pricing.list.title')}</h1>
          <p>{tt('pricing.list.subtitle')}</p>
        </div>
        <div className="acts">
          <Button disabled={!data} onClick={() => void run(() => api.openPrint(params))}><Printer size={14} />{tt('pricing.list.print')}</Button>
          <Button disabled={!data} onClick={() => void run(() => api.exportFile(params, 'xlsx'))}><Download size={14} />Excel</Button>
          <Button disabled={!data} onClick={() => void run(() => api.exportFile(params, 'csv'))}>CSV</Button>
          {isAdmin && <Button onClick={() => setDialog('import')}><Upload size={14} />{tt('pricing.import.title')}</Button>}
          {isAdmin && <Button onClick={() => setDialog('links')}><LinkIcon size={14} />{tt('pricing.links.title')}</Button>}
        </div>
      </div>

      <section className="panel doc-head" aria-label={tt('pricing.list.filters')}>
        <Field label={tt('pricing.date')}>{p => <Input {...p} type="date" value={date} onChange={e => setDate(e.target.value || today())} />}</Field>
        <Field label={tt('pricing.category')}>{p => <Select id={p.id} value={categoryId} placeholder={tt('pricing.allCategories')} onValueChange={setCategoryId} options={[{ value: '', label: tt('pricing.allCategories') }, ...(cats.data ?? []).map(c => ({ value: c.id, label: c.name }))]} />}</Field>
        <Field label={tt('pricing.search')}>{p => <Input {...p} value={search} onChange={e => setSearch(e.target.value)} placeholder={tt('pricing.searchPlaceholder')} />}</Field>
        <label className="row" style={{ gap: 6, alignSelf: 'end' }}>
          <Checkbox checked={inStock} onChange={e => setInStock(e.target.checked)} /> {tt('pricing.inStock')}
        </label>
      </section>
      <section className="panel doc-head" aria-label={tt('pricing.list.kinds')}>
        <KindChecks kinds={kinds.data ?? []} value={kindIds} onChange={v => setPicked(v)} label={tt('pricing.list.kinds')} />
      </section>

      {q.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={tt('pricing.list.title')} action={<Button size="sm" onClick={() => q.refetch()}>{tt('pricing.retry')}</Button>}>
          {errorMessage(q.error)}
        </EmptyState>
      ) : !data ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !data.items.length ? (
        <EmptyState icon={<CircleAlert size={20} />} title={tt('pricing.list.empty')}>{tt('pricing.list.emptyHint')}</EmptyState>
      ) : (
        <div className="table-wrap" style={{ padding: '0 var(--gutter) 24px' }}>
          <table className="dtbl" aria-label={tt('pricing.list.title')}>
            <thead>
              <tr>
                <th style={{ width: 120 }}>{tt('pricing.sku')}</th>
                <th>{tt('pricing.product')}</th>
                <th style={{ width: 60 }}>{tt('pricing.unit')}</th>
                <th style={{ width: 160 }}>{tt('pricing.category')}</th>
                {data.kinds.map(k => <th key={k.id} style={{ width: 130 }} className="r">{k.name}</th>)}
                <th style={{ width: 100 }} className="r">{tt('pricing.stock')}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map(r => (
                <tr key={r.productId}>
                  <td className="mono muted">{r.sku}</td>
                  <td><Link to={`/catalog/${r.productId}`} className="crm-link">{r.name}</Link></td>
                  <td className="muted">{r.unit}</td>
                  <td className="muted">{r.categoryName}</td>
                  {data.kinds.map(k => <td key={k.id} className="r num">{r.prices[k.id] === null || r.prices[k.id] === undefined ? '' : fmtAmount(r.prices[k.id])}</td>)}
                  <td className="r num muted">{Number(r.stockQty) ? Number(r.stockQty) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.total > data.items.length && <p className="muted" style={{ padding: 8 }}>{tt('pricing.list.more', { shown: data.items.length, total: data.total })}</p>}
        </div>
      )}
      {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} />}
      {dialog === 'links' && <LinksDialog kinds={kinds.data ?? []} onClose={() => setDialog(null)} />}
    </div>
  );
}
