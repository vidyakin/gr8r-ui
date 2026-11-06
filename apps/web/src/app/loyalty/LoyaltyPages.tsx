/* Автоскидки и карты лояльности (задача 1179): справочники правил скидок, промокодов и карт, карточка карты с движениями баллов
   (в меню её нет — открывается из списка карт) и настройка программы. Правка — admin+, карты выпускают те, кто работает с клиентами. */
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Archive, CircleAlert, CreditCard, Dices, Gift, Pencil, Percent, Plus, RotateCcw, Ticket, Trash2, X } from 'lucide-react';
import { Badge, Button, Checkbox, ConfirmDialog, Dialog, DialogContent, EmptyState, Field, IconButton, Input, Select, Skeleton, toast } from '@/components/ui';
import { fmtAmount, fmtNumber, useT, weekdayShort } from '@/i18n';
import { errorMessage } from '../data/api';
import { useCanWrite } from '../meta/custom-fields';
import { useCategories, useCompanies, useIsAdmin, useProducts } from '../catalog/data';
import { fmtDate } from '../lib/dates';
import { uuidv7 } from '../lib/uuid';
import { CounterpartyPicker, ProductPicker } from '../docs/pickers';
import { usePriceKinds } from '../pricing/data';
import {
  useDiscountRules,
  useLoyaltyApi,
  useLoyaltyCard,
  useLoyaltyCards,
  useLoyaltyProgram,
  usePromoCodes,
  type CardKind,
  type DiscountRule,
  type LoyaltyCard,
  type PromoCode,
} from './data';
import { DateInput } from '@/components/gr8r/date-picker';

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

const num = (s: string) => s.trim().replace(',', '.');
const isNum = (s: string) => /^\d+(\.\d+)?$/.test(num(s));
const hhmm = (s: string | null) => (s ? s.slice(0, 5) : '');
const CARD_KINDS: CardKind[] = ['discount', 'bonus', 'cumulative'];

function PageHead({ title, subtitle, actions }: { title: string; subtitle: string; actions?: React.ReactNode }) {
  return (
    <div className="ph">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="acts">{actions}</div>
    </div>
  );
}

/** Общее тело списка: ошибка, загрузка, пустое состояние, иначе таблица */
function ListBody({ q, empty, children }: { q: { isError: boolean; isPending: boolean; error: unknown; refetch: () => unknown; data?: unknown[] }; empty: React.ReactNode; children: React.ReactNode }) {
  const t = useT();
  if (q.isError)
    return (
      <EmptyState icon={<CircleAlert size={20} />} error title={t('loyalty.retry')} action={<Button size="sm" onClick={() => q.refetch()}>{t('loyalty.retry')}</Button>}>
        {errorMessage(q.error)}
      </EmptyState>
    );
  if (q.isPending)
    return (
      <div style={{ padding: 16 }}>
        <Skeleton w="100%" h={36} />
      </div>
    );
  if (!q.data?.length) return <>{empty}</>;
  return <div className="table-wrap" style={{ padding: '0 var(--gutter) 24px' }}>{children}</div>;
}

function ArchivedToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const t = useT();
  return (
    <label className="row" style={{ gap: 6 }}>
      <Checkbox checked={value} onChange={e => onChange(e.target.checked)} /> {t('loyalty.showArchived')}
    </label>
  );
}

/* ---------------- правила скидок ---------------- */

/** Список id с подписями и добавлением через переданный выбор */
function IdList({ label, ids, names, onRemove, picker }: { label: string; ids: string[]; names: Map<string, string>; onRemove: (id: string) => void; picker: React.ReactNode }) {
  const t = useT();
  return (
    <Field label={label} hint={ids.length ? undefined : t('loyalty.any')}>
      {() => (
        <div className="stack" style={{ gap: 6 }}>
          {ids.length > 0 && (
            <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
              {ids.map(id => (
                <Badge key={id} tone="gray">
                  {names.get(id) ?? id.slice(0, 8)}
                  <button type="button" aria-label={t('loyalty.remove')} onClick={() => onRemove(id)} style={{ marginLeft: 4, display: 'inline-flex' }}>
                    <X size={11} />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          {picker}
        </div>
      )}
    </Field>
  );
}

function RuleDialog({ rule, onClose }: { rule: DiscountRule | null; onClose: () => void }) {
  const t = useT();
  const api = useLoyaltyApi();
  const { busy, run } = useRun();
  const companies = useCompanies();
  const kinds = usePriceKinds();
  const categories = useCategories();
  const products = useProducts();
  const [loaded, setLoaded] = React.useState(!rule);
  const [name, setName] = React.useState(rule?.name ?? '');
  const [pct, setPct] = React.useState(rule ? String(Number(rule.discountPct)) : '');
  const [stackable, setStackable] = React.useState(rule?.stackable ?? false);
  const [promoOnly, setPromoOnly] = React.useState(rule?.promoOnly ?? false);
  const [validFrom, setValidFrom] = React.useState(rule?.validFrom ?? '');
  const [validTo, setValidTo] = React.useState(rule?.validTo ?? '');
  const [weekdays, setWeekdays] = React.useState<number[]>(rule?.weekdays ?? []);
  const [timeFrom, setTimeFrom] = React.useState(hhmm(rule?.timeFrom ?? null));
  const [timeTo, setTimeTo] = React.useState(hhmm(rule?.timeTo ?? null));
  const [minAmount, setMinAmount] = React.useState(rule ? String(Number(rule.minDocumentAmount)) : '0');
  const [minQty, setMinQty] = React.useState(rule ? String(Number(rule.minLineQty)) : '0');
  const [customerIds, setCustomerIds] = React.useState<string[]>([]);
  const [priceKindIds, setPriceKindIds] = React.useState<string[]>([]);
  const [productIds, setProductIds] = React.useState<string[]>([]);
  const [categoryIds, setCategoryIds] = React.useState<string[]>([]);
  // названия клиентов и товаров, выбранных в этом окне (в справочниках их может не быть)
  const [picked, setPicked] = React.useState<Map<string, string>>(new Map());

  // списки условий приходят карточкой правила
  React.useEffect(() => {
    if (!rule) return;
    let live = true;
    api.rule(rule.id).then(d => {
      if (!live) return;
      setCustomerIds(d.customerIds);
      setPriceKindIds(d.priceKindIds);
      setProductIds(d.productIds);
      setCategoryIds(d.categoryIds);
      setLoaded(true);
    }, e => toast.error(errorMessage(e)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rule?.id]);

  const names = (list: { id: string; name: string }[] | undefined) => new Map([...picked, ...(list ?? []).map(x => [x.id, x.name] as const)]);
  const valid = !!name.trim() && isNum(pct) && Number(num(pct)) <= 100 && isNum(minAmount || '0') && isNum(minQty || '0') && loaded;
  const add = (list: string[], set: (v: string[]) => void, id: string) => !list.includes(id) && set([...list, id]);

  const save = () =>
    run(async () => {
      const body = {
        name: name.trim(),
        discountPct: num(pct),
        stackable,
        promoOnly,
        validFrom: validFrom || null,
        validTo: validTo || null,
        weekdays: [...weekdays].sort(),
        timeFrom: timeFrom || null,
        timeTo: timeTo || null,
        minDocumentAmount: num(minAmount || '0'),
        minLineQty: num(minQty || '0'),
        customerIds,
        priceKindIds,
        productIds,
        categoryIds,
      };
      if (rule) await api.updateRule(rule.id, body);
      else await api.saveRule({ id: uuidv7(), ...body });
      onClose();
    });

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent
        title={rule ? t('loyalty.rules.edit') : t('loyalty.rules.new')}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>{t('loyalty.cancel')}</Button>
            <Button variant="primary" disabled={busy || !valid} onClick={() => void save()}>{t('loyalty.save')}</Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <Field label={t('loyalty.rules.name')}>{p => <Input {...p} value={name} onChange={e => setName(e.target.value)} />}</Field>
          <Field label={t('loyalty.rules.percent')}>{p => <Input {...p} inputMode="decimal" value={pct} onChange={e => setPct(e.target.value)} />}</Field>
          <label className="row" style={{ gap: 6 }}>
            <Checkbox checked={stackable} onChange={e => setStackable(e.target.checked)} /> {t('loyalty.rules.stackable')}
          </label>
          <label className="row" style={{ gap: 6 }}>
            <Checkbox checked={promoOnly} onChange={e => setPromoOnly(e.target.checked)} /> {t('loyalty.rules.promoOnly')}
          </label>
          <div className="row" style={{ gap: 8 }}>
            <Field label={t('loyalty.rules.validFrom')}>{p => <DateInput {...p} value={validFrom} onChange={v => setValidFrom(v)} />}</Field>
            <Field label={t('loyalty.rules.validTo')}>{p => <DateInput {...p} value={validTo} onChange={v => setValidTo(v)} />}</Field>
          </div>
          <Field label={t('loyalty.rules.weekdays')} hint={weekdays.length ? undefined : t('loyalty.any')}>
            {() => (
              <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                {[1, 2, 3, 4, 5, 6, 7].map(d => (
                  <Button key={d} size="sm" variant={weekdays.includes(d) ? 'primary' : 'secondary'} onClick={() => setWeekdays(w => (w.includes(d) ? w.filter(x => x !== d) : [...w, d]))}>
                    {weekdayShort(d % 7)}
                  </Button>
                ))}
              </div>
            )}
          </Field>
          <div className="row" style={{ gap: 8 }}>
            <Field label={t('loyalty.rules.timeFrom')}>{p => <Input {...p} type="time" value={timeFrom} onChange={e => setTimeFrom(e.target.value)} />}</Field>
            <Field label={t('loyalty.rules.timeTo')}>{p => <Input {...p} type="time" value={timeTo} onChange={e => setTimeTo(e.target.value)} />}</Field>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Field label={t('loyalty.rules.minAmount')}>{p => <Input {...p} inputMode="decimal" value={minAmount} onChange={e => setMinAmount(e.target.value)} />}</Field>
            <Field label={t('loyalty.rules.minQty')}>{p => <Input {...p} inputMode="decimal" value={minQty} onChange={e => setMinQty(e.target.value)} />}</Field>
          </div>
          <IdList
            label={t('loyalty.rules.customers')}
            ids={customerIds}
            names={names(companies.data)}
            onRemove={id => setCustomerIds(customerIds.filter(x => x !== id))}
            picker={
              <CounterpartyPicker
                value=""
                placeholder={t('loyalty.rules.pickCustomer')}
                onPick={c => {
                  setPicked(m => new Map(m).set(c.id, c.name));
                  add(customerIds, setCustomerIds, c.id);
                }}
              />
            }
          />
          <IdList
            label={t('loyalty.rules.priceKinds')}
            ids={priceKindIds}
            names={names(kinds.data)}
            onRemove={id => setPriceKindIds(priceKindIds.filter(x => x !== id))}
            picker={<Select value="" placeholder={t('loyalty.rules.pickKind')} onValueChange={v => add(priceKindIds, setPriceKindIds, v)} options={(kinds.data ?? []).filter(k => !priceKindIds.includes(k.id)).map(k => ({ value: k.id, label: k.name }))} />}
          />
          <IdList
            label={t('loyalty.rules.products')}
            ids={productIds}
            names={names(products.data)}
            onRemove={id => setProductIds(productIds.filter(x => x !== id))}
            picker={
              <ProductPicker
                value=""
                price="price"
                placeholder={t('loyalty.rules.pickProduct')}
                onPick={p => {
                  setPicked(m => new Map(m).set(p.id, p.name));
                  add(productIds, setProductIds, p.id);
                }}
              />
            }
          />
          <IdList
            label={t('loyalty.rules.categories')}
            ids={categoryIds}
            names={names(categories.data)}
            onRemove={id => setCategoryIds(categoryIds.filter(x => x !== id))}
            picker={<Select value="" placeholder={t('loyalty.rules.pickCategory')} onValueChange={v => add(categoryIds, setCategoryIds, v)} options={(categories.data ?? []).filter(c => !categoryIds.includes(c.id)).map(c => ({ value: c.id, label: c.name }))} />}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DiscountRulesPage() {
  const t = useT();
  const isAdmin = useIsAdmin();
  const api = useLoyaltyApi();
  const { run } = useRun();
  const [archived, setArchived] = React.useState(false);
  const q = useDiscountRules(archived);
  const [editing, setEditing] = React.useState<DiscountRule | 'new' | null>(null);
  const [removing, setRemoving] = React.useState<DiscountRule | null>(null);
  const conditions = (r: DiscountRule) => {
    const parts: string[] = [];
    if (r.validFrom || r.validTo) parts.push(`${r.validFrom ? fmtDate(r.validFrom) : ''} — ${r.validTo ? fmtDate(r.validTo) : ''}`);
    if (r.weekdays.length) parts.push(r.weekdays.map(d => weekdayShort(d % 7)).join(', '));
    if (r.timeFrom || r.timeTo) parts.push(`${hhmm(r.timeFrom)}–${hhmm(r.timeTo)}`);
    if (Number(r.minDocumentAmount) > 0) parts.push(t('loyalty.rules.summaryAmount', { amount: fmtAmount(r.minDocumentAmount) }));
    if (Number(r.minLineQty) > 0) parts.push(t('loyalty.rules.summaryQty', { qty: fmtNumber(r.minLineQty) }));
    return parts.length ? parts.join(' · ') : t('loyalty.rules.always');
  };
  if (!isAdmin) return <div className="page flush"><PageHead title={t('loyalty.rules.title')} subtitle={t('loyalty.rules.subtitle')} /><EmptyState icon={<CircleAlert size={20} />} title={t('loyalty.rules.title')}>{t('loyalty.adminOnly')}</EmptyState></div>;
  return (
    <div className="page flush">
      <PageHead
        title={t('loyalty.rules.title')}
        subtitle={t('loyalty.rules.subtitle')}
        actions={
          <>
            <ArchivedToggle value={archived} onChange={setArchived} />
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Plus size={14} />
              {t('loyalty.rules.new')}
            </Button>
          </>
        }
      />
      <ListBody q={q} empty={<EmptyState icon={<Percent size={20} />} title={t('loyalty.rules.empty')}>{t('loyalty.rules.emptyHint')}</EmptyState>}>
        <table className="dtbl" aria-label={t('loyalty.rules.title')}>
          <thead>
            <tr>
              <th>{t('loyalty.rules.name')}</th>
              <th style={{ width: 110 }} className="r">{t('loyalty.rules.percent')}</th>
              <th>{t('loyalty.rules.conditions')}</th>
              <th style={{ width: 90 }} />
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map(r => (
              <tr key={r.id}>
                <td>
                  <button type="button" className="crm-link" onClick={() => setEditing(r)}>{r.name}</button>
                  {r.stackable && <Badge tone="accent" className="ml-2">{t('loyalty.rules.modeStack')}</Badge>}
                  {r.promoOnly && <Badge tone="violet" className="ml-2">{t('loyalty.rules.modePromo')}</Badge>}
                  {r.archivedAt && <Badge tone="gray" className="ml-2">{t('loyalty.archived')}</Badge>}
                </td>
                <td className="r num">{fmtNumber(r.discountPct)}</td>
                <td className="muted">{conditions(r)}</td>
                <td>
                  {r.archivedAt ? (
                    <IconButton label={t('loyalty.restore')} onClick={() => void run(() => api.restoreRule(r.id))}><RotateCcw size={14} /></IconButton>
                  ) : (
                    <IconButton label={t('loyalty.archive')} onClick={() => setRemoving(r)}><Archive size={14} /></IconButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ListBody>
      {editing && <RuleDialog rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!removing} onOpenChange={v => !v && setRemoving(null)} title={t('loyalty.rules.archiveTitle')} description={t('loyalty.rules.archiveHint')} confirmLabel={t('loyalty.archive')} onConfirm={() => run(async () => { await api.archiveRule(removing!.id); setRemoving(null); })} />
    </div>
  );
}

/* ---------------- промокоды ---------------- */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomCode = (prefix: string, len = 6) => {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return prefix + Array.from(bytes, b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
};

function PromoDialog({ promo, batch, onClose }: { promo: PromoCode | null; batch: boolean; onClose: () => void }) {
  const t = useT();
  const api = useLoyaltyApi();
  const rules = useDiscountRules();
  const { busy, run } = useRun();
  const [code, setCode] = React.useState(promo?.code ?? '');
  const [prefix, setPrefix] = React.useState('');
  const [count, setCount] = React.useState('10');
  const [ruleId, setRuleId] = React.useState(promo?.ruleId ?? '');
  const [validFrom, setValidFrom] = React.useState(promo?.validFrom ?? '');
  const [validTo, setValidTo] = React.useState(promo?.validTo ?? '');
  const [limit, setLimit] = React.useState(promo?.usageLimit != null ? String(promo.usageLimit) : '');
  const n = Number(count);
  const valid = !!ruleId && (batch ? Number.isInteger(n) && n >= 1 && n <= 200 : !!code.trim()) && (limit === '' || /^\d+$/.test(limit));
  const common = { ruleId, validFrom: validFrom || null, validTo: validTo || null, usageLimit: limit === '' ? null : Number(limit) };

  const save = () =>
    run(async () => {
      if (!batch) {
        if (promo) await api.updatePromo(promo.id, { code: code.trim(), ...common });
        else await api.savePromo({ id: uuidv7(), code: code.trim(), ...common });
        onClose();
        return;
      }
      await api.issuePromos({ ...common, count: n, prefix: prefix.trim().toUpperCase() || undefined });
      toast(t('loyalty.promo.issued', { n }));
      onClose();
    });

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent
        title={batch ? t('loyalty.promo.issueTitle') : promo ? t('loyalty.promo.edit') : t('loyalty.promo.new')}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>{t('loyalty.cancel')}</Button>
            <Button variant="primary" disabled={busy || !valid} onClick={() => void save()}>{batch ? t('loyalty.promo.issue') : t('loyalty.save')}</Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          {batch ? (
            <div className="row" style={{ gap: 8 }}>
              <Field label={t('loyalty.promo.prefix')}>{p => <Input {...p} maxLength={10} value={prefix} onChange={e => setPrefix(e.target.value)} />}</Field>
              <Field label={t('loyalty.promo.count')} hint={t('loyalty.promo.countHint')}>{p => <Input {...p} inputMode="numeric" value={count} onChange={e => setCount(e.target.value)} />}</Field>
            </div>
          ) : (
            <Field label={t('loyalty.promo.code')}>
              {p => (
                <div className="row" style={{ gap: 6 }}>
                  <Input {...p} value={code} maxLength={40} onChange={e => setCode(e.target.value)} />
                  <IconButton label={t('loyalty.promo.generate')} onClick={() => setCode(randomCode(''))}><Dices size={14} /></IconButton>
                </div>
              )}
            </Field>
          )}
          <Field label={t('loyalty.promo.rule')}>
            {p => <Select id={p.id} value={ruleId} onValueChange={setRuleId} placeholder={t('loyalty.promo.pickRule')} options={(rules.data ?? []).map(r => ({ value: r.id, label: r.name }))} />}
          </Field>
          <div className="row" style={{ gap: 8 }}>
            <Field label={t('loyalty.promo.validFrom')}>{p => <DateInput {...p} value={validFrom} onChange={v => setValidFrom(v)} />}</Field>
            <Field label={t('loyalty.promo.validTo')}>{p => <DateInput {...p} value={validTo} onChange={v => setValidTo(v)} />}</Field>
          </div>
          <Field label={t('loyalty.promo.limit')} hint={t('loyalty.promo.limitHint')}>{p => <Input {...p} inputMode="numeric" value={limit} onChange={e => setLimit(e.target.value)} />}</Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PromoCodesPage() {
  const t = useT();
  const isAdmin = useIsAdmin();
  const api = useLoyaltyApi();
  const { run } = useRun();
  const [archived, setArchived] = React.useState(false);
  const q = usePromoCodes(archived, isAdmin);
  const [editing, setEditing] = React.useState<{ promo: PromoCode | null; batch: boolean } | null>(null);
  const [removing, setRemoving] = React.useState<PromoCode | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const state = (p: PromoCode) => (p.usageLimit !== null && p.usageCount >= p.usageLimit ? t('loyalty.promo.exhausted') : p.validTo && p.validTo < today ? t('loyalty.promo.expired') : null);
  if (!isAdmin) return <div className="page flush"><PageHead title={t('loyalty.promo.title')} subtitle={t('loyalty.promo.subtitle')} /><EmptyState icon={<CircleAlert size={20} />} title={t('loyalty.promo.title')}>{t('loyalty.adminOnly')}</EmptyState></div>;
  return (
    <div className="page flush">
      <PageHead
        title={t('loyalty.promo.title')}
        subtitle={t('loyalty.promo.subtitle')}
        actions={
          <>
            <ArchivedToggle value={archived} onChange={setArchived} />
            <Button onClick={() => setEditing({ promo: null, batch: true })}>
              <Ticket size={14} />
              {t('loyalty.promo.issue')}
            </Button>
            <Button variant="primary" onClick={() => setEditing({ promo: null, batch: false })}>
              <Plus size={14} />
              {t('loyalty.promo.new')}
            </Button>
          </>
        }
      />
      <ListBody q={q} empty={<EmptyState icon={<Ticket size={20} />} title={t('loyalty.promo.empty')}>{t('loyalty.promo.emptyHint')}</EmptyState>}>
        <table className="dtbl" aria-label={t('loyalty.promo.title')}>
          <thead>
            <tr>
              <th>{t('loyalty.promo.code')}</th>
              <th>{t('loyalty.promo.rule')}</th>
              <th style={{ width: 200 }}>{t('loyalty.rules.period')}</th>
              <th style={{ width: 130 }} className="r">{t('loyalty.promo.used')}</th>
              <th style={{ width: 90 }} />
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map(p => (
              <tr key={p.id}>
                <td>
                  <button type="button" className="crm-link mono" onClick={() => setEditing({ promo: p, batch: false })}>{p.code}</button>
                  {state(p) && <Badge tone="red" className="ml-2">{state(p)}</Badge>}
                  {p.archivedAt && <Badge tone="gray" className="ml-2">{t('loyalty.archived')}</Badge>}
                </td>
                <td className="muted">{p.ruleName}</td>
                <td className="muted">{p.validFrom || p.validTo ? `${p.validFrom ? fmtDate(p.validFrom) : ''} — ${p.validTo ? fmtDate(p.validTo) : ''}` : '—'}</td>
                <td className="r num">{p.usageLimit !== null ? `${fmtNumber(p.usageCount)} / ${fmtNumber(p.usageLimit)}` : fmtNumber(p.usageCount)}</td>
                <td>{!p.archivedAt && <IconButton label={t('loyalty.archive')} onClick={() => setRemoving(p)}><Archive size={14} /></IconButton>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ListBody>
      {editing && <PromoDialog promo={editing.promo} batch={editing.batch} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!removing} onOpenChange={v => !v && setRemoving(null)} title={t('loyalty.promo.archiveTitle')} confirmLabel={t('loyalty.archive')} onConfirm={() => run(async () => { await api.archivePromo(removing!.id); setRemoving(null); })} />
    </div>
  );
}

/* ---------------- карты лояльности ---------------- */

const useKindLabel = () => {
  const t = useT();
  return (k: CardKind) => (k === 'discount' ? t('loyalty.cards.kindDiscount') : k === 'bonus' ? t('loyalty.cards.kindBonus') : t('loyalty.cards.kindCumulative'));
};

function CardDialog({ card, onClose }: { card: { id: string; number: string; customerId: string; customerName: string; kind: CardKind; discountPct: string | null; isActive: boolean } | null; onClose: () => void }) {
  const t = useT();
  const api = useLoyaltyApi();
  const kindLabel = useKindLabel();
  const { busy, run } = useRun();
  const [number, setNumber] = React.useState(card?.number ?? '');
  const [customer, setCustomer] = React.useState<{ id: string; name: string } | null>(card ? { id: card.customerId, name: card.customerName } : null);
  const [kind, setKind] = React.useState<CardKind>(card?.kind ?? 'discount');
  const [pct, setPct] = React.useState(card?.discountPct ? String(Number(card.discountPct)) : '');
  const [active, setActive] = React.useState(card?.isActive ?? true);
  const needPct = kind === 'discount';
  const valid = !!number.trim() && !!customer && (!needPct || (isNum(pct) && Number(num(pct)) <= 100));

  const save = () =>
    run(async () => {
      if (card) await api.updateCard(card.id, { number: number.trim(), isActive: active, ...(needPct ? { discountPct: num(pct) } : {}) });
      else await api.saveCard({ id: uuidv7(), number: number.trim(), customerId: customer!.id, kind, discountPct: needPct ? num(pct) : null, isActive: active });
      onClose();
    });

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent
        title={card ? t('loyalty.cards.edit') : t('loyalty.cards.new')}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>{t('loyalty.cancel')}</Button>
            <Button variant="primary" disabled={busy || !valid} onClick={() => void save()}>{t('loyalty.save')}</Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <Field label={t('loyalty.cards.number')}>{p => <Input {...p} className="mono" maxLength={40} value={number} onChange={e => setNumber(e.target.value)} />}</Field>
          <Field label={t('loyalty.cards.customer')}>
            {p => (card ? <div className="doc-ro">{card.customerName}</div> : <CounterpartyPicker id={p.id} value={customer?.name ?? ''} placeholder={t('loyalty.cards.pickCustomer')} onPick={c => setCustomer({ id: c.id, name: c.name })} />)}
          </Field>
          <Field label={t('loyalty.cards.kind')}>
            {p => <Select id={p.id} disabled={!!card} value={kind} onValueChange={v => setKind(v as CardKind)} options={CARD_KINDS.map(k => ({ value: k, label: kindLabel(k) }))} />}
          </Field>
          {needPct && <Field label={t('loyalty.cards.percent')} hint={t('loyalty.cards.percentHint')}>{p => <Input {...p} inputMode="decimal" value={pct} onChange={e => setPct(e.target.value)} />}</Field>}
          {kind === 'cumulative' && <p className="muted" style={{ fontSize: 12.5 }}>{t('loyalty.cards.scaleHint')}</p>}
          <label className="row" style={{ gap: 6 }}>
            <Checkbox checked={active} onChange={e => setActive(e.target.checked)} /> {t('loyalty.active')}
          </label>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function LoyaltyCardsPage() {
  const t = useT();
  const canWrite = useCanWrite();
  const api = useLoyaltyApi();
  const kindLabel = useKindLabel();
  const { run } = useRun();
  const [archived, setArchived] = React.useState(false);
  const q = useLoyaltyCards({ archived });
  const [editing, setEditing] = React.useState<LoyaltyCard | 'new' | null>(null);
  const [removing, setRemoving] = React.useState<LoyaltyCard | null>(null);
  return (
    <div className="page flush">
      <PageHead
        title={t('loyalty.cards.title')}
        subtitle={t('loyalty.cards.subtitle')}
        actions={
          <>
            <ArchivedToggle value={archived} onChange={setArchived} />
            {canWrite && (
              <Button variant="primary" onClick={() => setEditing('new')}>
                <Plus size={14} />
                {t('loyalty.cards.new')}
              </Button>
            )}
          </>
        }
      />
      <ListBody q={q} empty={<EmptyState icon={<CreditCard size={20} />} title={t('loyalty.cards.empty')}>{t('loyalty.cards.emptyHint')}</EmptyState>}>
        <table className="dtbl" aria-label={t('loyalty.cards.title')}>
          <thead>
            <tr>
              <th style={{ width: 170 }}>{t('loyalty.cards.number')}</th>
              <th>{t('loyalty.cards.customer')}</th>
              <th style={{ width: 150 }}>{t('loyalty.cards.kind')}</th>
              <th style={{ width: 110 }} className="r">{t('loyalty.cards.percent')}</th>
              <th style={{ width: 120 }}>{t('loyalty.cards.status')}</th>
              <th style={{ width: 90 }} />
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map(c => (
              <tr key={c.id}>
                <td className="mono"><Link to={`/loyalty/cards/${c.id}`} className="crm-link">{c.number}</Link></td>
                <td>{c.customerName}</td>
                <td className="muted">{kindLabel(c.kind)}</td>
                <td className="r num">{c.kind === 'discount' && c.discountPct ? fmtNumber(c.discountPct) : '—'}</td>
                <td>
                  {c.archivedAt ? <Badge tone="gray">{t('loyalty.archived')}</Badge> : <Badge tone={c.isActive ? 'green' : 'gray'} dot>{c.isActive ? t('loyalty.active') : t('loyalty.inactive')}</Badge>}
                </td>
                <td>
                  {canWrite && !c.archivedAt && (
                    <>
                      <IconButton label={t('loyalty.cards.edit')} onClick={() => setEditing(c)}><Pencil size={14} /></IconButton>
                      <IconButton label={t('loyalty.archive')} onClick={() => setRemoving(c)}><Archive size={14} /></IconButton>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ListBody>
      {editing && <CardDialog card={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!removing} onOpenChange={v => !v && setRemoving(null)} title={t('loyalty.cards.archiveTitle')} confirmLabel={t('loyalty.archive')} onConfirm={() => run(async () => { await api.archiveCard(removing!.id); setRemoving(null); })} />
    </div>
  );
}

/** Карточка карты с движениями баллов: в меню её нет, открывается номером карты из списка */
export function LoyaltyCardPage() {
  const t = useT();
  const { id } = useParams();
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const kindLabel = useKindLabel();
  const q = useLoyaltyCard(id);
  const customers = useCompanies();
  const [editing, setEditing] = React.useState(false);
  const txLabel = (k: string) => (k === 'accrual' ? t('loyalty.cards.txAccrual') : k === 'redemption' ? t('loyalty.cards.txRedemption') : k === 'expiration' ? t('loyalty.cards.txExpiration') : t('loyalty.cards.txReversal'));
  if (q.isPending)
    return <div className="page flush"><div className="ph"><Skeleton w={260} h={24} /></div></div>;
  if (q.isError || !q.data)
    return (
      <div className="page flush">
        <EmptyState icon={<CircleAlert size={20} />} error title={t('loyalty.cards.notFound')} action={<Link to="/loyalty/cards" className="btn btn-secondary">{t('loyalty.cards.back')}</Link>}>
          {errorMessage(q.error)}
        </EmptyState>
      </div>
    );
  const c = q.data;
  const customerName = customers.data?.find(x => x.id === c.customerId)?.name ?? '';
  return (
    <div className="page flush">
      <PageHead
        title={`${t('loyalty.cards.edit')} ${c.number}`}
        subtitle={`${customerName} · ${kindLabel(c.kind)}`}
        actions={
          <>
            <Button variant="ghost" onClick={() => void navigate('/loyalty/cards')}>{t('loyalty.cards.back')}</Button>
            {canWrite && !c.archivedAt && <Button onClick={() => setEditing(true)}>{t('loyalty.cards.edit')}</Button>}
          </>
        }
      />
      <section className="doc-head panel" style={{ margin: '0 var(--gutter) 12px' }}>
        <Field label={t('loyalty.cards.status')}>{() => <div className="doc-ro">{c.archivedAt ? t('loyalty.archived') : c.isActive ? t('loyalty.active') : t('loyalty.inactive')}</div>}</Field>
        {c.kind === 'discount' && <Field label={t('loyalty.cards.percent')}>{() => <div className="doc-ro">{fmtNumber(c.discountPct)}</div>}</Field>}
        {c.kind === 'bonus' && <Field label={t('loyalty.cards.balance')}>{() => <div className="doc-ro num">{fmtAmount(c.balance)}</div>}</Field>}
      </section>
      {c.kind === 'bonus' && (
        <div className="table-wrap" style={{ padding: '0 var(--gutter) 24px' }}>
          <h2 style={{ fontSize: 14, margin: '8px 0' }}>{t('loyalty.cards.history')}</h2>
          {!c.history.length ? (
            <p className="muted">{t('loyalty.cards.historyEmpty')}</p>
          ) : (
            <table className="dtbl" aria-label={t('loyalty.cards.history')}>
              <thead>
                <tr>
                  <th style={{ width: 120 }}>{t('loyalty.cards.date')}</th>
                  <th style={{ width: 130 }}>{t('loyalty.cards.operation')}</th>
                  <th>{t('loyalty.cards.document')}</th>
                  <th style={{ width: 120 }} className="r">{t('loyalty.cards.points')}</th>
                  <th style={{ width: 120 }}>{t('loyalty.cards.expires')}</th>
                  <th>{t('loyalty.cards.comment')}</th>
                </tr>
              </thead>
              <tbody>
                {c.history.map(h => (
                  <tr key={h.id}>
                    <td className="muted">{fmtDate(h.createdAt.slice(0, 10))}</td>
                    <td>{txLabel(h.kind)}</td>
                    <td>{h.documentId ? <Link to={`/documents/${h.documentId}`} className="crm-link">{h.docNumber ?? '—'}</Link> : '—'}</td>
                    <td className="r num">{Number(h.points) > 0 ? '+' : ''}{fmtAmount(h.points)}</td>
                    <td className="muted">{h.expiresAt ? fmtDate(h.expiresAt.slice(0, 10)) : '—'}</td>
                    <td className="muted">{h.comment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {editing && <CardDialog card={{ ...c, customerName }} onClose={() => setEditing(false)} />}
    </div>
  );
}

/* ---------------- программа лояльности ---------------- */

export function LoyaltyProgramPage() {
  const t = useT();
  const isAdmin = useIsAdmin();
  const api = useLoyaltyApi();
  const q = useLoyaltyProgram();
  const { busy, run } = useRun();
  const [accrual, setAccrual] = React.useState('');
  const [limit, setLimit] = React.useState('');
  const [days, setDays] = React.useState('');
  const [scale, setScale] = React.useState<{ fromAmount: string; pct: string }[]>([]);
  React.useEffect(() => {
    if (!q.data) return;
    setAccrual(String(Number(q.data.accrualPct)));
    setLimit(String(Number(q.data.redemptionLimitPct)));
    setDays(q.data.expirationDays != null ? String(q.data.expirationDays) : '');
    setScale(q.data.cumulativeScale.map(s => ({ fromAmount: String(Number(s.fromAmount)), pct: String(Number(s.pct)) })));
  }, [q.data]);
  const valid = isNum(accrual) && Number(num(accrual)) <= 100 && isNum(limit) && Number(num(limit)) <= 100 && (days === '' || /^[1-9]\d*$/.test(days)) && scale.every(s => isNum(s.fromAmount) && isNum(s.pct) && Number(num(s.pct)) <= 100);
  const setStep = (i: number, patch: Partial<{ fromAmount: string; pct: string }>) => setScale(s => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  if (!isAdmin) return <div className="page flush"><PageHead title={t('loyalty.program.title')} subtitle={t('loyalty.program.subtitle')} /><EmptyState icon={<CircleAlert size={20} />} title={t('loyalty.program.title')}>{t('loyalty.adminOnly')}</EmptyState></div>;
  return (
    <div className="page flush">
      <PageHead title={t('loyalty.program.title')} subtitle={t('loyalty.program.subtitle')} />
      {q.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={t('loyalty.program.title')} action={<Button size="sm" onClick={() => q.refetch()}>{t('loyalty.retry')}</Button>}>{errorMessage(q.error)}</EmptyState>
      ) : q.isPending ? (
        <div style={{ padding: 16 }}><Skeleton w="100%" h={36} /></div>
      ) : (
        <div className="stack" style={{ gap: 12, padding: '0 var(--gutter) 24px', maxWidth: 560 }}>
          <Field label={t('loyalty.program.accrualPct')} hint={t('loyalty.program.accrualHint')}>{p => <Input {...p} inputMode="decimal" value={accrual} onChange={e => setAccrual(e.target.value)} />}</Field>
          <Field label={t('loyalty.program.redemptionLimitPct')}>{p => <Input {...p} inputMode="decimal" value={limit} onChange={e => setLimit(e.target.value)} />}</Field>
          <Field label={t('loyalty.program.expirationDays')} hint={t('loyalty.program.expirationHint')}>{p => <Input {...p} inputMode="numeric" value={days} onChange={e => setDays(e.target.value)} />}</Field>
          <Field label={t('loyalty.program.scale')} hint={t('loyalty.program.scaleHint')}>
            {() => (
              <div className="stack" style={{ gap: 6 }}>
                {scale.map((s, i) => (
                  <div key={i} className="row" style={{ gap: 6 }}>
                    <Input inputMode="decimal" aria-label={t('loyalty.program.scaleFrom')} placeholder={t('loyalty.program.scaleFrom')} value={s.fromAmount} onChange={e => setStep(i, { fromAmount: e.target.value })} />
                    <Input inputMode="decimal" aria-label={t('loyalty.program.scalePct')} placeholder={t('loyalty.program.scalePct')} value={s.pct} onChange={e => setStep(i, { pct: e.target.value })} />
                    <IconButton label={t('loyalty.remove')} onClick={() => setScale(sc => sc.filter((_, j) => j !== i))}><Trash2 size={14} /></IconButton>
                  </div>
                ))}
                <div>
                  <Button size="sm" onClick={() => setScale(sc => [...sc, { fromAmount: '', pct: '' }])}>
                    <Plus size={13} />
                    {t('loyalty.program.addStep')}
                  </Button>
                </div>
              </div>
            )}
          </Field>
          <div>
            <Button
              variant="primary"
              disabled={busy || !valid}
              onClick={() =>
                void run(async () => {
                  await api.updateProgram({
                    accrualPct: num(accrual),
                    redemptionLimitPct: num(limit),
                    expirationDays: days === '' ? null : Number(days),
                    cumulativeScale: [...scale].map(s => ({ fromAmount: num(s.fromAmount), pct: num(s.pct) })).sort((a, b) => Number(a.fromAmount) - Number(b.fromAmount)),
                  });
                  toast(t('loyalty.program.saved'));
                })
              }
            >
              <Gift size={14} />
              {t('loyalty.save')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
