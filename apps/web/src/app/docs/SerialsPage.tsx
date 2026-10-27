/* Серийные номера (задача 1099): реестр с поиском, проверка гарантии по номеру и карточка номера с историей
   (поступление, перемещения, продажа, ремонты). Дату «гарантия до» можно изменить в карточке. */
import * as React from 'react';
import { Link } from 'react-router';
import { CircleAlert, ScanBarcode, Search } from 'lucide-react';
import { Badge, Button, Dialog, DialogContent, EmptyState, Field, Input, Skeleton, Textarea, toast, type Tone } from '@/components/ui';
import { DataTable, columnsMenu, useDataTable, type Column } from '@/components/gr8r/data-table';
import { FilterBar, useFilterState } from '@/components/gr8r/filter-bar';
import { useT } from '@/i18n';
import { fmtDate, parse } from '../lib/dates';
import { useCanWrite } from '../meta/custom-fields';
import { typeLabel, useDocsApi } from './data';
import { useSerialCard, useSerialLookup, useSerials, type SerialItem } from './serials-data';
import { hasKey } from '@/i18n';

const STATUS_TONE: Record<string, Tone> = { in_stock: 'green', sold: 'accent', written_off: 'gray', in_transit: 'amber' };

export function SerialStatusBadge({ status }: { status: string }) {
  const t = useT();
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'} dot>{t(`serials.status.${status}` as 'serials.status.sold')}</Badge>;
}

/** Гарантия: дата и признак «действует» на сегодня */
function Warranty({ until, sold }: { until: string | null; sold: boolean }) {
  const t = useT();
  if (!sold || !until) return <span className="faint">—</span>;
  const active = until >= new Date().toISOString().slice(0, 10);
  return (
    <span className="num" title={active ? t('serials.warrantyActive') : t('serials.warrantyExpired')} style={{ color: active ? undefined : 'var(--red)' }}>
      {fmtDate(parse(until))}
    </span>
  );
}

export function SerialsPage() {
  const t = useT();
  const filters = useFilterState();
  const [q, setQ] = React.useState('');
  const [open, setOpen] = React.useState<string | null>(null);
  React.useEffect(() => {
    const h = setTimeout(() => setQ(filters.q.trim()), 250);
    return () => clearTimeout(h);
  }, [filters.q]);
  const status = filters.values.status?.[0];
  const list = useSerials({ q: q || undefined, status });
  const rows = list.data?.items ?? [];

  const columns = React.useMemo<Column<SerialItem>[]>(
    () => [
      { id: 'serial', header: t('serials.col.serial'), width: 200, value: r => r.serial, cell: r => <span className="mono" style={{ fontWeight: 450 }}>{r.serial}</span> },
      { id: 'product', header: t('serials.col.product'), width: 260, value: r => r.productName, cell: r => <span className="trunc">{r.productName}</span> },
      { id: 'status', header: t('serials.col.status'), width: 130, value: r => r.status, cell: r => <SerialStatusBadge status={r.status} /> },
      { id: 'warehouse', header: t('serials.col.warehouse'), width: 170, value: r => r.warehouseName ?? '', cell: r => <span className="trunc muted">{r.warehouseName ?? '—'}</span> },
      { id: 'soldAt', header: t('serials.col.soldAt'), width: 112, value: r => r.soldAt ?? '', cell: r => (r.soldAt ? <span className="num muted">{fmtDate(parse(r.soldAt))}</span> : <span className="faint">—</span>) },
      { id: 'owner', header: t('serials.col.owner'), width: 220, value: r => r.ownerName ?? '', cell: r => <span className="trunc muted">{r.ownerName ?? '—'}</span> },
      { id: 'warranty', header: t('serials.col.warranty'), width: 130, value: r => r.warrantyUntil ?? '', cell: r => <Warranty until={r.warrantyUntil} sold={r.status === 'sold'} /> },
    ],
    [t],
  );
  const table = useDataTable(columns, { sort: { id: 'serial', dir: 1 } });

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('serials.title')}</h1>
          <p>{t('serials.lead')}</p>
        </div>
      </div>
      <WarrantyLookup onOpen={setOpen} />
      <FilterBar
        search={{ value: filters.q, onChange: filters.setQ, placeholder: t('serials.searchPlaceholder') }}
        fields={[{ id: 'status', name: t('serials.col.status'), icon: <ScanBarcode size={15} />, options: (['in_stock', 'sold', 'written_off', 'in_transit'] as const).map(s => ({ id: s, name: t(`serials.status.${s}`) })) }]}
        filters={filters}
        sort={{ options: columns.filter(c => c.value).map(c => ({ id: c.id, name: c.header })), value: table.sort.id, dir: table.sort.dir, onChange: table.setSort }}
        columns={columnsMenu(columns, table)}
      />
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={t('serials.loadError')} action={<Button size="sm" onClick={() => list.refetch()}>{t('common.retry')}</Button>}>
          {(list.error as Error).message}
        </EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : (
        <DataTable
          aria-label={t('serials.ariaList')}
          columns={columns}
          rows={rows}
          table={table}
          getId={r => r.id}
          onRowClick={r => setOpen(r.id)}
          empty={
            <EmptyState icon={<ScanBarcode size={20} />} title={q || status ? t('serials.emptyFiltered') : t('serials.emptyTitle')}>
              {q || status ? '' : t('serials.emptyHint')}
            </EmptyState>
          }
        />
      )}
      {open && <SerialCardDialog id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Проверка гарантии: поле номера и результат (продан когда, кому, документ, гарантия до) */
function WarrantyLookup({ onOpen }: { onOpen: (id: string) => void }) {
  const t = useT();
  const [input, setInput] = React.useState('');
  const [serial, setSerial] = React.useState('');
  const hits = useSerialLookup(serial);
  return (
    <section className="panel" style={{ margin: '0 16px 12px', padding: 12 }} aria-label={t('serials.lookup.title')}>
      <form
        style={{ display: 'flex', gap: 8, alignItems: 'center' }}
        onSubmit={e => {
          e.preventDefault();
          setSerial(input.trim());
        }}
      >
        <strong style={{ whiteSpace: 'nowrap' }}>{t('serials.lookup.title')}</strong>
        <Input aria-label={t('serials.lookup.placeholder')} placeholder={t('serials.lookup.placeholder')} value={input} onChange={e => setInput(e.target.value)} icon={<Search size={14} />} />
        <Button type="submit" size="sm" disabled={!input.trim()}>
          {t('serials.lookup.button')}
        </Button>
      </form>
      {serial && hits.data && !hits.data.length && <p className="faint" style={{ margin: '8px 0 0' }}>{t('serials.lookup.notFound')}</p>}
      {hits.data?.map(h => (
        <div key={h.serialId} style={{ marginTop: 8, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="crm-link mono" onClick={() => onOpen(h.serialId)}>{h.serial}</button>
          <span className="muted">{h.productName}</span>
          {h.status === 'sold' ? (
            <>
              <span>{t('serials.lookup.soldTo', { name: h.ownerName ?? '—', date: h.soldAt ? fmtDate(parse(h.soldAt)) : '—' })}</span>
              {h.soldDocumentNumber && <span className="faint">{t('serials.lookup.document', { number: h.soldDocumentNumber })}</span>}
              {h.warrantyUntil ? <Badge tone={h.warrantyActive ? 'green' : 'red'}>{h.warrantyActive ? t('serials.warrantyActive') : t('serials.warrantyExpired')} · {fmtDate(parse(h.warrantyUntil))}</Badge> : <Badge tone="gray">{t('serials.noWarranty')}</Badge>}
            </>
          ) : (
            <span>{t('serials.lookup.notSold', { status: t(`serials.status.${h.status}`) })}</span>
          )}
        </div>
      ))}
    </section>
  );
}

function eventTitle(type: string, t: ReturnType<typeof useT>) {
  const key = `serials.eventTypes.${type}`;
  return hasKey(key) ? t(key as 'serials.eventTypes.work_order_material') : typeLabel(type);
}

export function SerialCardDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const api = useDocsApi();
  const canWrite = useCanWrite();
  const card = useSerialCard(id);
  const c = card.data;
  const [until, setUntil] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const save = async () => {
    const body: Record<string, unknown> = {};
    if (until !== null) body.warrantyUntil = until || null;
    if (note !== null) body.note = note;
    const r = await api('PATCH', `/serials/${id}`, body);
    if (r) toast(t('serials.card.saved'));
  };
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent size="lg" title={c ? t('serials.card.title', { serial: c.serial }) : t('serials.title')} footer={<Button variant="ghost" onClick={onClose}>{t('common.close')}</Button>}>
        {!c ? (
          <Skeleton w="100%" h={120} />
        ) : (
          <div style={{ display: 'grid', gap: 14 }}>
            <dl className="kv" style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: '4px 12px', margin: 0 }}>
              <dt className="faint">{t('serials.card.product')}</dt>
              <dd style={{ margin: 0 }}>{c.productName}</dd>
              <dt className="faint">{t('serials.card.status')}</dt>
              <dd style={{ margin: 0 }}><SerialStatusBadge status={c.status} /> {c.warehouseName && <span className="muted">{c.warehouseName}</span>}</dd>
              {c.status === 'sold' && (
                <>
                  <dt className="faint">{t('serials.card.soldAt')}</dt>
                  <dd style={{ margin: 0 }}>{c.soldAt ? fmtDate(parse(c.soldAt)) : '—'}</dd>
                  <dt className="faint">{t('serials.card.owner')}</dt>
                  <dd style={{ margin: 0 }}>{c.ownerName ?? '—'}</dd>
                  <dt className="faint">{t('serials.card.document')}</dt>
                  <dd style={{ margin: 0 }}>{c.soldDocumentId ? <Link className="crm-link" to={`/documents/${c.soldDocumentId}`}>{c.soldDocumentNumber ?? '—'}</Link> : '—'}</dd>
                </>
              )}
            </dl>
            {c.status === 'sold' && (
              <Field label={t('serials.card.warranty')} hint={t('serials.card.warrantyHint')}>
                {p => <Input id={p.id} type="date" disabled={!canWrite} value={until ?? c.warrantyUntil ?? ''} onChange={e => setUntil(e.target.value)} />}
              </Field>
            )}
            <Field label={t('serials.card.note')}>{p => <Textarea id={p.id} rows={2} disabled={!canWrite} value={note ?? c.note} onChange={e => setNote(e.target.value)} />}</Field>
            {canWrite && (until !== null || note !== null) && (
              <div>
                <Button variant="primary" size="sm" onClick={() => void save()}>{t('serials.card.save')}</Button>
              </div>
            )}
            <section>
              <h3 style={{ margin: '0 0 6px' }}>{t('serials.card.history')}</h3>
              <table className="dtbl" aria-label={t('serials.card.history')}>
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>{t('serials.card.colDate')}</th>
                    <th>{t('serials.card.colEvent')}</th>
                    <th>{t('serials.card.colDocument')}</th>
                    <th>{t('serials.card.colWhere')}</th>
                    <th style={{ width: 130 }}>{t('serials.card.colState')}</th>
                  </tr>
                </thead>
                <tbody>
                  {c.events.map(e => (
                    <tr key={e.id}>
                      <td className="num">{fmtDate(parse(e.movedAt))}</td>
                      <td>{eventTitle(e.documentType, t)} · <span className="faint">{t(`serials.event.${e.direction}`)}</span></td>
                      <td><Link className="crm-link" to={`/documents/${e.documentId}`}>{e.documentNumber ?? '—'}</Link></td>
                      <td className="muted">{e.counterpartyName ?? e.warehouseName ?? '—'}</td>
                      <td><SerialStatusBadge status={e.statusAfter} /></td>
                    </tr>
                  ))}
                  {!c.events.length && (
                    <tr>
                      <td colSpan={5} className="faint" style={{ textAlign: 'center', padding: 14 }}>{t('serials.card.historyEmpty')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
            <section>
              <h3 style={{ margin: '0 0 6px' }}>{t('serials.card.repairs')}</h3>
              {c.repairs.length ? (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {c.repairs.map(r => (
                    <li key={r.id}>
                      <Link className="crm-link" to={`/documents/${r.documentId}`}>{r.documentNumber ?? '—'}</Link> · {r.defect || '—'} · {r.receivedAt ? t('serials.card.repairReceived', { date: fmtDate(parse(r.receivedAt)) }) : ''} · {r.returnedAt ? t('serials.card.repairReturned', { date: fmtDate(parse(r.returnedAt)) }) : t('serials.card.notReturned')}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="faint" style={{ margin: 0 }}>{t('serials.card.repairsEmpty')}</p>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
