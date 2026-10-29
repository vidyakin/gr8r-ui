/* Автопарк → Топливо (задача 1210): заправки (ручной ввод и загрузка выписки CSV по топливным картам), топливные карты.
   Заправка сама привязывается к путевому листу машины на дату; расход идёт на статью затрат «ГСМ». Норма против факта — в путевых листах. */
import * as React from 'react';
import { Fuel, Plus, Upload } from 'lucide-react';
import { Badge, Button, Dialog, DialogContent, EmptyState, Field, Input, Select, Skeleton, Textarea, toast } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/gr8r/data-table';
import { fmtAmount, fmtNumber, hasKey, useT } from '@/i18n';
import { iso, today, fmtDate, parse } from '../lib/dates';
import { useFleetApi, useFuel, useFuelCards, useVehicles, type FuelCard, type FuelEntry, type FuelImportResult } from './data';
import { FleetHead, FormDialog, num, orNull } from './parts';

const ALL = 'all';
const NONE = 'none';

function FuelDialog({ entry, onClose }: { entry: FuelEntry | null; onClose: () => void }) {
  const t = useT();
  const api = useFleetApi();
  const vehicles = useVehicles().data?.items ?? [];
  const cards = useFuelCards().data?.items ?? [];
  return (
    <FormDialog
      title={entry ? t('fleet.fuel.edit') : t('fleet.fuel.new')}
      fields={[
        { key: 'vehicleId', label: t('fleet.fuel.vehicle'), type: 'select', required: true, options: vehicles.map(v => ({ value: v.id, label: `${v.plate} ${v.name}`.trim() })) },
        { key: 'date', label: t('fleet.fuel.date'), type: 'date', required: true },
        { key: 'liters', label: t('fleet.fuel.liters'), type: 'number', required: true },
        { key: 'amount', label: t('fleet.fuel.amount'), type: 'number', required: true },
        { key: 'odometer', label: t('fleet.fuel.odometer'), type: 'number' },
        { key: 'cardId', label: t('fleet.fuel.card'), type: 'select', options: [{ value: NONE, label: t('fleet.fuel.noCard') }, ...cards.map(c => ({ value: c.id, label: c.number }))] },
        { key: 'station', label: t('fleet.fuel.station'), type: 'text' },
        { key: 'comment', label: t('fleet.comment'), type: 'textarea' },
      ]}
      initial={{ vehicleId: entry?.vehicleId ?? vehicles[0]?.id ?? '', date: entry?.date ?? iso(today()), liters: entry ? String(Number(entry.liters)) : '', amount: entry ? String(Number(entry.amount)) : '', odometer: entry?.odometer ? String(Number(entry.odometer)) : '', cardId: entry?.cardId ?? NONE, station: entry?.station ?? '', comment: entry?.comment ?? '' }}
      onClose={onClose}
      footerExtra={
        entry ? (
          <Button
            variant="ghost"
            onClick={async () => {
              if (await api('DELETE', `fuel/${entry.id}`)) onClose();
            }}
          >
            {t('fleet.delete')}
          </Button>
        ) : null
      }
      onSubmit={async v => {
        const data = { vehicleId: String(v.vehicleId), date: String(v.date), liters: num(v.liters) ?? '0', amount: num(v.amount) ?? '0', odometer: num(v.odometer) ?? null, cardId: v.cardId === NONE ? null : String(v.cardId), station: String(v.station), comment: String(v.comment) };
        return !!(entry ? await api('PATCH', `fuel/${entry.id}`, data) : await api('POST', 'fuel', data));
      }}
    />
  );
}

/** Загрузка выписки: файл или вставленный текст; сначала проверка (без записи), затем загрузка */
function ImportDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const api = useFleetApi();
  const [csv, setCsv] = React.useState('');
  const [preview, setPreview] = React.useState<FuelImportResult | null>(null);
  const [done, setDone] = React.useState<FuelImportResult | null>(null);
  const run = async (dryRun: boolean) => {
    const r = await api<FuelImportResult>('POST', 'fuel/import', { csv, dryRun });
    if (!r) return;
    if (dryRun) setPreview(r);
    else {
      setDone(r);
      toast(t('fleet.fuel.imported', { n: r.created }));
    }
  };
  const res = done ?? preview;
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={t('fleet.fuel.import')}
        description={t('fleet.fuel.importLead')}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>{done ? t('common.close') : t('common.cancel')}</Button>
            {!done && <Button variant="secondary" disabled={!csv.trim()} onClick={() => run(true)}>{t('fleet.fuel.check')}</Button>}
            {!done && <Button disabled={!csv.trim() || !preview || preview.created === 0} onClick={() => run(false)}>{t('fleet.fuel.load')}</Button>}
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            aria-label={t('fleet.fuel.file')}
            onChange={async e => {
              const f = e.target.files?.[0];
              if (f) {
                setCsv(await f.text());
                setPreview(null);
              }
            }}
          />
          <Field label={t('fleet.fuel.csvText')} hint={t('fleet.fuel.csvHint')}>
            {p => <Textarea id={p.id} rows={5} value={csv} onChange={e => { setCsv(e.target.value); setPreview(null); }} placeholder={'Дата;Карта;Литры;Сумма;АЗС\n2026-10-30;7001-0042;40,5;2430;Лукойл'} />}
          </Field>
          {res && (
            <div className="stack" style={{ gap: 4 }}>
              <div className="row" style={{ gap: 8 }}>
                <Badge tone="green">{t('fleet.fuel.rowsNew', { n: res.created })}</Badge>
                <Badge tone="gray">{t('fleet.fuel.rowsDup', { n: res.duplicates })}</Badge>
                <Badge tone={res.errors ? 'red' : 'gray'}>{t('fleet.fuel.rowsErr', { n: res.errors })}</Badge>
              </div>
              {res.rows.filter(r => r.status === 'error').map(r => (
                <div key={r.line} className="muted">{t('fleet.fuel.rowError', { line: r.line, err: hasKey(`fleet.fuel.err.${r.error}`) ? t(`fleet.fuel.err.${r.error}` as 'fleet.fuel.err.bad_date') : String(r.error) })}</div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CardsTab() {
  const t = useT();
  const cards = useFuelCards();
  const [edit, setEdit] = React.useState<FuelCard | 'new' | null>(null);
  const api = useFleetApi();
  const vehicles = useVehicles().data?.items ?? [];
  const columns = React.useMemo<Column<FuelCard>[]>(
    () => [
      { id: 'number', header: t('fleet.fuel.cardNumber'), width: 200, value: r => r.number, cell: r => <b>{r.number}</b> },
      { id: 'name', header: t('fleet.fuel.cardName'), width: 220, value: r => r.name, cell: r => r.name || '—' },
      { id: 'vehicle', header: t('fleet.fuel.vehicle'), width: 160, value: r => r.plate ?? '', cell: r => r.plate ?? '—' },
    ],
    [t],
  );
  const table = useDataTable(columns, { sort: { id: 'number', dir: 1 } });
  return (
    <>
      <div className="row" style={{ margin: '0 var(--gutter) 12px' }}>
        <Button size="sm" variant="ghost" onClick={() => setEdit('new')}>
          <Plus size={13} />
          {t('fleet.fuel.newCard')}
        </Button>
      </div>
      <DataTable aria-label={t('fleet.fuel.cards')} columns={columns} rows={cards.data?.items ?? []} table={table} getId={r => r.id} onRowClick={setEdit} empty={<EmptyState icon={<Fuel size={20} />} title={t('fleet.fuel.noCards')}>{t('fleet.fuel.noCardsHint')}</EmptyState>} />
      {edit && (
        <FormDialog
          key={edit === 'new' ? 'new' : edit.id}
          title={edit === 'new' ? t('fleet.fuel.newCard') : edit.number}
          fields={[
            { key: 'number', label: t('fleet.fuel.cardNumber'), type: 'text', required: true },
            { key: 'name', label: t('fleet.fuel.cardName'), type: 'text' },
            { key: 'vehicleId', label: t('fleet.fuel.vehicle'), type: 'select', options: [{ value: NONE, label: t('fleet.fuel.noVehicle') }, ...vehicles.map(v => ({ value: v.id, label: v.plate }))] },
          ]}
          initial={{ number: edit === 'new' ? '' : edit.number, name: edit === 'new' ? '' : edit.name, vehicleId: edit === 'new' ? NONE : edit.vehicleId ?? NONE }}
          onClose={() => setEdit(null)}
          footerExtra={
            edit !== 'new' ? (
              <Button
                variant="ghost"
                onClick={async () => {
                  if (await api('DELETE', `fuel-cards/${edit.id}`)) setEdit(null);
                }}
              >
                {t('fleet.delete')}
              </Button>
            ) : null
          }
          onSubmit={async v => {
            const data = { number: String(v.number).trim(), name: String(v.name), vehicleId: orNull(v.vehicleId === NONE ? '' : v.vehicleId) };
            return !!(edit === 'new' ? await api('POST', 'fuel-cards', data) : await api('PATCH', `fuel-cards/${edit.id}`, data));
          }}
        />
      )}
    </>
  );
}

export function FuelPage() {
  const t = useT();
  const vehicles = useVehicles().data?.items ?? [];
  const [tab, setTab] = React.useState<'entries' | 'cards'>('entries');
  const [from, setFrom] = React.useState(iso(new Date(today().getTime() - 30 * 86400000)));
  const [to, setTo] = React.useState(iso(today()));
  const [vehicle, setVehicle] = React.useState(ALL);
  const list = useFuel({ from, to, ...(vehicle === ALL ? {} : { vehicleId: vehicle }) });
  const [edit, setEdit] = React.useState<FuelEntry | 'new' | null>(null);
  const [importing, setImporting] = React.useState(false);
  const columns = React.useMemo<Column<FuelEntry>[]>(
    () => [
      { id: 'date', header: t('fleet.fuel.date'), width: 110, value: r => r.date, cell: r => <span className="num">{fmtDate(parse(r.date))}</span> },
      { id: 'vehicle', header: t('fleet.fuel.vehicle'), width: 120, value: r => r.plate, cell: r => <b>{r.plate}</b> },
      { id: 'liters', header: t('fleet.fuel.liters'), width: 100, align: 'right', value: r => Number(r.liters), cell: r => <span className="num">{fmtNumber(r.liters)}</span>, total: rows => <span className="num">{fmtNumber(rows.reduce((s, r) => s + Number(r.liters), 0))}</span> },
      { id: 'amount', header: t('fleet.fuel.amount'), width: 120, align: 'right', value: r => Number(r.amount), cell: r => <span className="num">{fmtAmount(r.amount)}</span>, total: rows => <span className="num">{fmtAmount(rows.reduce((s, r) => s + Number(r.amount), 0))}</span> },
      { id: 'price', header: t('fleet.fuel.price'), width: 100, align: 'right', value: r => Number(r.amount) / Number(r.liters), cell: r => <span className="num muted">{fmtAmount(Number(r.amount) / Number(r.liters))}</span> },
      { id: 'odometer', header: t('fleet.fuel.odometer'), width: 110, align: 'right', value: r => Number(r.odometer ?? 0), cell: r => <span className="num muted">{r.odometer ? fmtNumber(r.odometer) : '—'}</span> },
      { id: 'card', header: t('fleet.fuel.card'), width: 130, value: r => r.card ?? '', cell: r => <span className="muted">{r.card ?? '—'}</span> },
      { id: 'waybill', header: t('fleet.fuel.waybill'), width: 140, value: r => r.waybillNumber ?? '', cell: r => <span className="muted">{r.waybillNumber ?? '—'}</span> },
      { id: 'station', header: t('fleet.fuel.station'), width: 200, value: r => r.station, cell: r => <span className="trunc">{r.station || '—'}</span> },
      { id: 'source', header: t('fleet.fuel.source'), width: 90, value: r => r.source, cell: r => <Badge tone="gray">{t(`fleet.fuel.src.${r.source}`)}</Badge> },
    ],
    [t],
  );
  const table = useDataTable(columns, { sort: { id: 'date', dir: -1 } });
  return (
    <div className="page flush">
      <FleetHead
        title={t('fleet.fuel.title')}
        lead={t('fleet.fuel.lead')}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => setImporting(true)}>
              <Upload size={13} />
              {t('fleet.fuel.import')}
            </Button>
            <Button size="sm" onClick={() => setEdit('new')}>
              <Plus size={13} />
              {t('fleet.fuel.new')}
            </Button>
          </>
        }
      />
      <nav className="tabs doc-tabs" aria-label={t('fleet.fuel.title')}>
        {(['entries', 'cards'] as const).map(x => (
          <button key={x} type="button" className={`tab${x === tab ? ' on' : ''}`} aria-current={x === tab ? 'page' : undefined} onClick={() => setTab(x)}>
            {x === 'entries' ? t('fleet.fuel.entries') : t('fleet.fuel.cards')}
          </button>
        ))}
      </nav>
      {tab === 'cards' ? (
        <CardsTab />
      ) : (
        <>
          <section className="panel plain" style={{ margin: '0 var(--gutter) 16px' }}>
            <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Field label={t('fleet.from')}>{p => <Input {...p} type="date" value={from} max={to} onChange={e => setFrom(e.target.value || from)} />}</Field>
              <Field label={t('fleet.to')}>{p => <Input {...p} type="date" value={to} min={from} onChange={e => setTo(e.target.value || to)} />}</Field>
              <Field label={t('fleet.fuel.vehicle')}>
                {p => <Select id={p.id} aria-label={t('fleet.fuel.vehicle')} value={vehicle} onValueChange={setVehicle} options={[{ value: ALL, label: t('fleet.all') }, ...vehicles.map(v => ({ value: v.id, label: v.plate }))]} />}
              </Field>
            </div>
          </section>
          {list.isPending ? (
            <div style={{ padding: 16 }}><Skeleton w="100%" h={36} /></div>
          ) : (
            <DataTable aria-label={t('fleet.fuel.title')} columns={columns} rows={list.data?.items ?? []} table={table} getId={r => r.id} onRowClick={setEdit} empty={<EmptyState icon={<Fuel size={20} />} title={t('fleet.fuel.empty')}>{t('fleet.fuel.emptyHint')}</EmptyState>} />
          )}
        </>
      )}
      {edit && <FuelDialog key={edit === 'new' ? 'new' : edit.id} entry={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </div>
  );
}
