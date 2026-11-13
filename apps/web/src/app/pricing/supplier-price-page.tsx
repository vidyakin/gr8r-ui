/* Экран прайса поставщика: разбор строк и применение цен (этап 7 проекта
   docs/superpowers/specs/2026-11-11-supplier-price-upload-design.md). Маршрут /crm/companies/:id/prices/:priceId. */
import * as React from 'react';
import { Link, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, PackagePlus, Search, SkipForward, Undo2 } from 'lucide-react';
import { Alert, Badge, Button, ConfirmDialog, Dialog, DialogClose, DialogContent, EmptyState, Field, Segmented, Select, Skeleton, toast, type Tone } from '@/components/ui';
import { DateInput } from '@/components/gr8r/date-picker';
import { useT } from '@/i18n';
import { fmtAmount, fmtDateTime, fmtNumber } from '@/i18n/format';
import { fmtDate } from '../lib/dates';
import { errorMessage } from '../data/api';
import { useWsId } from '../meta/data';
import { useCanWrite } from '../meta/custom-fields';
import { unitSymbol, useUnits } from '../catalog/data';
import { CatalogPickDialog } from '../docs/position-field';
import { company as findCompany } from '../crm/selectors';
import { useCrm } from '../crm/store';
import { supplierPricesKey, useSupplierApplyPreview, useSupplierPriceDetail, useSupplierPricesApi, type SupplierLineStatus, type SupplierPrice, type SupplierPriceLine } from './supplier-prices-data';

const PAGE_SIZE = 300;
const STATUS_TONE: Record<SupplierLineStatus, Tone> = { matched: 'green', unmatched: 'red', conflict: 'amber', skipped: 'gray' };
type Filter = 'all' | SupplierLineStatus;

export function SupplierPricePage() {
  const t = useT();
  const ws = useWsId();
  const qc = useQueryClient();
  const { id, priceId } = useParams();
  const canWrite = useCanWrite();
  const api = useSupplierPricesApi();
  const { data: crm } = useCrm();
  const units = useUnits();
  const detail = useSupplierPriceDetail(priceId);
  const [filter, setFilter] = React.useState<Filter>('all');
  const [limit, setLimit] = React.useState(PAGE_SIZE);
  const [busy, setBusy] = React.useState(false);
  const [picking, setPicking] = React.useState<SupplierPriceLine | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [applyOpen, setApplyOpen] = React.useState(false);

  const price = detail.data?.price;
  const lines = detail.data?.lines;
  const products = React.useMemo(() => new Map((detail.data?.products ?? []).map(p => [p.id, p])), [detail.data?.products]);
  const counts = React.useMemo(() => {
    const c: Record<Filter, number> = { all: 0, matched: 0, unmatched: 0, conflict: 0, skipped: 0 };
    for (const l of lines ?? []) {
      c.all++;
      c[l.status]++;
    }
    return c;
  }, [lines]);
  const shown = React.useMemo(() => (lines ?? []).filter(l => filter === 'all' || l.status === filter), [lines, filter]);
  // колонку цены скрываем, если она пуста во всём прайсе
  const showNet = (lines ?? []).some(l => l.priceNet !== null);
  const showGross = (lines ?? []).some(l => l.priceGross !== null);
  React.useEffect(() => setLimit(PAGE_SIZE), [filter, priceId]);

  const refresh = () => qc.invalidateQueries({ queryKey: supplierPricesKey(ws) });
  /** Запрос с тостом ошибки и перечиткой прайса */
  const run = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    try {
      const r = await fn();
      await refresh();
      return r;
    } catch (e) {
      toast.error(errorMessage(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const companyName = findCompany(crm, id)?.name ?? '';
  const back = (
    <Link to={`/crm/companies/${id}/prices`} className="row muted" style={{ gap: 4, fontSize: 12.5, marginBottom: 8, display: 'inline-flex' }}>
      <ArrowLeft size={13} />
      {t('supplierPrices.page.back', { name: companyName })}
    </Link>
  );

  if (detail.isPending)
    return (
      <div className="page" style={{ maxWidth: 1200, paddingTop: 16 }}>
        {back}
        <Skeleton w="100%" h={120} />
      </div>
    );
  if (!price || !lines)
    return (
      <div className="page" style={{ maxWidth: 1200, paddingTop: 16 }}>
        {back}
        <EmptyState icon={<Search size={20} />} title={t('supplierPrices.page.loadError')} error>
          {detail.error ? errorMessage(detail.error) : undefined}
        </EmptyState>
      </div>
    );

  const draft = price.status === 'draft';
  const editable = draft && canWrite;
  const unmatchedLines = lines.filter(l => l.status === 'unmatched');
  const creatable = unmatchedLines.filter(l => l.name.trim());

  const download = async () => {
    if (!price.attachmentId) return;
    try {
      await api.download(price.attachmentId, price.fileName);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const matchByName = async () => {
    const r = await run(() => api.matchByName(price.id));
    if (r) toast(t('supplierPrices.page.matchResult', { matched: r.matched, ambiguous: r.ambiguous, notFound: r.notFound }));
  };
  const createProducts = async () => {
    const r = await run(() => api.createProducts(price.id));
    if (r) toast(t('supplierPrices.page.createResult', { created: r.created, skipped: r.skipped }));
  };
  const patch = (l: SupplierPriceLine, body: { productId?: string; skip?: boolean }) => run(() => api.patchLine(price.id, l.id, body));

  const filterItems = (['all', 'matched', 'unmatched', 'conflict', 'skipped'] as Filter[]).map(f => ({ value: f, label: `${t(`supplierPrices.page.filter.${f}` as const)} ${fmtNumber(counts[f])}` }));

  return (
    <div className="page" style={{ maxWidth: 1280, paddingTop: 16 }}>
      {back}
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>{t('supplierPrices.page.title', { name: price.name })}</h2>
        <Badge tone={draft ? 'amber' : 'green'}>{t(`supplierPrices.page.status.${price.status}` as const)}</Badge>
        <span className="sp" />
        {editable && (
          <>
            <Button loading={busy} disabled={!counts.unmatched} onClick={() => void matchByName()}>
              <Search size={13} />
              {t('supplierPrices.page.matchByName')}
            </Button>
            <Button disabled={busy || !creatable.length} onClick={() => setCreateOpen(true)}>
              <PackagePlus size={13} />
              {t('supplierPrices.page.createProducts')}
            </Button>
            <Button variant="primary" disabled={busy || !counts.matched} onClick={() => setApplyOpen(true)}>
              {t('supplierPrices.page.apply')}
            </Button>
          </>
        )}
      </div>
      <div className="row muted" style={{ gap: 14, flexWrap: 'wrap', fontSize: 12.5, margin: '6px 0 12px' }}>
        <span>
          {t('supplierPrices.page.date')}: {fmtDate(price.date)}
        </span>
        {price.attachmentId && (
          <button type="button" className="row" style={{ gap: 4, color: 'inherit', textDecoration: 'underline', background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }} onClick={() => void download()}>
            <Download size={12} />
            {price.fileName}
          </button>
        )}
        {price.appliedAt && <span>{t('supplierPrices.page.appliedOn', { date: fmtDateTime(price.appliedAt) })}</span>}
      </div>
      {!draft && (
        <Alert tone="info" className="mb-3">
          {t('supplierPrices.page.readOnly')}
        </Alert>
      )}
      <Segmented value={filter} onValueChange={setFilter} items={filterItems} aria-label={t('supplierPrices.page.colStatus')} />

      {!shown.length ? (
        <p className="faint" style={{ marginTop: 14 }}>
          {t('supplierPrices.page.noLines')}
        </p>
      ) : (
        <table className="dtbl" style={{ marginTop: 10 }} aria-label={t('supplierPrices.tab.title')}>
          <thead>
            <tr>
              <th style={{ width: 52 }}>{t('supplierPrices.page.colRow')}</th>
              <th style={{ width: 150 }}>{t('supplierPrices.page.colArticle')}</th>
              <th>{t('supplierPrices.page.colName')}</th>
              <th style={{ width: 60 }}>{t('supplierPrices.page.colUnit')}</th>
              {showNet && <th style={{ width: 110, textAlign: 'right' }}>{t('supplierPrices.page.colPriceNet')}</th>}
              {showGross && <th style={{ width: 110, textAlign: 'right' }}>{t('supplierPrices.page.colPriceGross')}</th>}
              <th style={{ width: 280 }}>{t('supplierPrices.page.colProduct')}</th>
              <th style={{ width: 150 }}>{t('supplierPrices.page.colStatus')}</th>
              {editable && <th style={{ width: 190 }} />}
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map(l => (
              <LineRow key={l.id} showNet={showNet} showGross={showGross} line={l} editable={editable} busy={busy} products={products} unitLabel={l.unitCode ? unitSymbol(units.data, l.unitCode) : t('supplierPrices.page.unitNone')} onPick={() => setPicking(l)} onPatch={body => void patch(l, body)} />
            ))}
          </tbody>
        </table>
      )}
      {shown.length > limit && (
        <div style={{ textAlign: 'center', marginTop: 10 }}>
          <Button onClick={() => setLimit(n => n + PAGE_SIZE)}>{t('supplierPrices.page.showMore', { n: fmtNumber(shown.length - limit) })}</Button>
        </div>
      )}

      {picking && (
        <CatalogPickDialog
          mode="product"
          title={t('supplierPrices.page.pickTitle', { article: picking.article || picking.name })}
          initialQuery={picking.name}
          counterpartyId={price.companyId}
          onClose={() => setPicking(null)}
          onPick={p => void patch(picking, { productId: p.id })}
        />
      )}
      <ConfirmDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t('supplierPrices.page.createTitle')}
        description={t('supplierPrices.page.createText', { n: fmtNumber(creatable.length) })}
        confirmLabel={t('supplierPrices.page.createProducts')}
        cancelLabel={t('pricing.cancel')}
        onConfirm={() => void createProducts()}
      />
      {applyOpen && <ApplyDialog price={price} leftCount={counts.unmatched + counts.conflict} onClose={() => setApplyOpen(false)} onApplied={() => void refresh()} />}
    </div>
  );
}

/* ---------------- строка ---------------- */

function LineRow({ line: l, showNet, showGross, editable, busy, products, unitLabel, onPick, onPatch }: { line: SupplierPriceLine; showNet: boolean; showGross: boolean; editable: boolean; busy: boolean; products: Map<string, { id: string; name: string; sku: string }>; unitLabel: string; onPick: () => void; onPatch: (b: { productId?: string; skip?: boolean }) => void }) {
  const t = useT();
  const product = l.productId ? products.get(l.productId) : undefined;
  const noteKey = l.note ? (`supplierPrices.page.note.${l.note}` as const) : null;
  const note = noteKey && ['price_invalid', 'manual', 'vat_rate_none'].includes(l.note) ? t(noteKey as 'supplierPrices.page.note.manual') : l.note;
  return (
    <tr>
      <td className="faint">{l.rowNo}</td>
      <td>{l.article}</td>
      <td>{l.name}</td>
      <td>{unitLabel}</td>
      {showNet && <td style={{ textAlign: 'right' }}>{l.priceNet === null ? '—' : fmtAmount(l.priceNet)}</td>}
      {showGross && <td style={{ textAlign: 'right' }}>{l.priceGross === null ? '—' : fmtAmount(l.priceGross)}</td>}
      <td>
        {product ? (
          <>
            <div>{product.name}</div>
            <div className="faint" style={{ fontSize: 11.5 }}>
              {product.sku}
            </div>
          </>
        ) : l.status === 'conflict' && l.candidates.length ? (
          <Select
            size="sm"
            disabled={!editable || busy}
            placeholder={t('supplierPrices.page.pickCandidate')}
            aria-label={t('supplierPrices.page.candidates', { n: l.candidates.length })}
            value=""
            onValueChange={v => v && onPatch({ productId: v })}
            options={l.candidates.map(c => {
              const p = products.get(c);
              return { value: c, label: p ? `${p.name} (${p.sku})` : c };
            })}
          />
        ) : (
          <span className="faint">—</span>
        )}
        {!product && l.status === 'unmatched' && l.candidates.length > 0 && (
          <div className="faint" style={{ fontSize: 11.5 }}>
            {t('supplierPrices.page.candidates', { n: l.candidates.length })}
          </div>
        )}
      </td>
      <td>
        <Badge tone={STATUS_TONE[l.status]}>{t(`supplierPrices.page.status.${l.status}` as const)}</Badge>
        {note && l.status === 'skipped' && (
          <div className="faint" style={{ fontSize: 11.5 }}>
            {note}
          </div>
        )}
      </td>
      {editable && (
        <td>
          <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
            {l.status !== 'skipped' && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={onPick}>
                {l.productId ? t('supplierPrices.page.changeProduct') : t('supplierPrices.page.pickProduct')}
              </Button>
            )}
            {l.status === 'skipped' ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onPatch({ skip: false })}>
                <Undo2 size={12} />
                {t('supplierPrices.page.unskip')}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onPatch({ skip: true })}>
                <SkipForward size={12} />
                {t('supplierPrices.page.skip')}
              </Button>
            )}
          </span>
        </td>
      )}
    </tr>
  );
}

/* ---------------- применение ---------------- */

function ApplyDialog({ price, leftCount, onClose, onApplied }: { price: SupplierPrice; leftCount: number; onClose: () => void; onApplied: () => void }) {
  const t = useT();
  const api = useSupplierPricesApi();
  const preview = useSupplierApplyPreview(price.id, true);
  const [date, setDate] = React.useState(price.date);
  const [busy, setBusy] = React.useState(false);
  const items = preview.data?.items ?? [];
  const warnings = items.filter(i => i.warning);
  const writable = items.filter(i => !i.warning);

  const apply = async () => {
    setBusy(true);
    try {
      const r = await api.apply(price.id, date);
      toast(t('supplierPrices.page.applied', { applied: r.applied, skipped: r.skipped.length }));
      onApplied();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent
        size="lg"
        title={t('supplierPrices.page.applyTitle')}
        description={preview.data ? t('supplierPrices.page.applyKind', { name: preview.data.kindName }) : undefined}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="ghost">{t('pricing.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" loading={busy} disabled={!writable.length || !date} onClick={() => void apply()}>
              {t('supplierPrices.page.applyConfirm')}
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <Field label={t('supplierPrices.page.applyDate')} className="w-[200px]">
            {f => <DateInput id={f.id} required value={date} onChange={setDate} />}
          </Field>
          {preview.isPending ? (
            <Skeleton w="100%" h={80} />
          ) : preview.error ? (
            <Alert tone="danger">{errorMessage(preview.error)}</Alert>
          ) : (
            <>
              <div style={{ fontWeight: 500 }}>{t('supplierPrices.page.applySummary', { n: fmtNumber(writable.length) })}</div>
              {!items.length && <p className="faint">{t('supplierPrices.page.noChange')}</p>}
              {!!warnings.length && (
                <Alert tone="warn" title={t('supplierPrices.page.warnTitle', { n: warnings.length })}>
                  {warnings.slice(0, 10).map(w => (
                    <div key={w.lineId}>{t('supplierPrices.page.warnVat', { row: w.rowNo, name: w.productName })}</div>
                  ))}
                </Alert>
              )}
              {leftCount > 0 && <Alert tone="info">{t('supplierPrices.page.warnLeft', { n: fmtNumber(leftCount) })}</Alert>}
              {!!writable.length && (
                <div style={{ overflow: 'auto', maxHeight: 340, border: '1px solid var(--border)', borderRadius: 6 }}>
                  <table className="dtbl" aria-label={t('supplierPrices.page.applyTitle')}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)' }}>
                      <tr>
                        <th>{t('supplierPrices.page.colName')}</th>
                        <th style={{ width: 110, textAlign: 'right' }}>{t('supplierPrices.page.colWas')}</th>
                        <th style={{ width: 110, textAlign: 'right' }}>{t('supplierPrices.page.colNow')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {writable.map(i => (
                        <tr key={i.lineId}>
                          <td>
                            {i.productName}
                            <div className="faint" style={{ fontSize: 11.5 }}>
                              {i.article}
                            </div>
                          </td>
                          <td style={{ textAlign: 'right' }} className="muted">
                            {i.current === null ? '—' : fmtAmount(i.current)}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 500 }}>{i.next === null ? '—' : fmtAmount(i.next)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
