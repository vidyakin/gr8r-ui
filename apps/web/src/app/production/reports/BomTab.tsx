/* Отчёт «Нормативный состав изделия»: изделие и количество → развёртка спецификации по этапам (материалы, полуфабрикаты,
   операции с нормативным временем) и себестоимость. Цена — «по виду цен» или «по последней закупке».
   Стоимость видят admin и owner: у остальных сервер отдаёт null, колонки цен скрываются. */
import * as React from 'react';
import { Link } from 'react-router';
import { Alert, Checkbox, Field, Input, Select } from '@/components/ui';
import { fmtAmount, useT } from '@/i18n';
import { useSnapshot } from '../data';
import { useBomReport, type BomReportRow } from './reports-data';
import { ReportTable, type GroupLevel, type ReportColumn } from './ReportTable';
import { num, ReportState } from './shared';

const KINDS = ['purchase', 'price', 'avg_cost'] as const;
const MODES = ['price_kind', 'last_purchase'] as const;
const money = (v: string | null) => (v === null ? '—' : fmtAmount(v));

export function BomTab() {
  const tt = useT();
  const snap = useSnapshot();
  const items = (snap.data?.items ?? []).filter(i => !('archived' in i && (i as { archived?: boolean }).archived));
  const [itemId, setItemId] = React.useState('');
  const [qty, setQty] = React.useState('1');
  // значения параметров спецификации по выбранному изделию: число, вариант, флажок (строкой «true»)
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [mode, setMode] = React.useState<(typeof MODES)[number]>('price_kind');
  const [kind, setKind] = React.useState<(typeof KINDS)[number]>('purchase');
  // по умолчанию — первое изделие без параметров: его состав считается без ввода значений
  const id = itemId || (items.find(i => !i.params?.length) ?? items[0])?.id || '';
  const params = items.find(i => i.id === id)?.params ?? [];
  const paramValues = React.useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const p of params) {
      const v = values[p.key];
      if (p.type === 'boolean') out[p.key] = v === 'true';
      else if (v && v !== '') out[p.key] = p.type === 'number' ? Number(v.replace(',', '.')) : v;
    }
    return out;
  }, [params, values]);
  const q = useBomReport({ itemId: id, qty, priceMode: mode, priceKind: kind, params: params.length ? JSON.stringify(paramValues) : undefined });
  const pick = (v: string) => {
    setItemId(v);
    setValues({});
  };

  return (
    <>
      <section className="panel plain" style={{ margin: '0 var(--gutter) 16px' }}>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label={tt('production.reports.col.product')}>
            {p => <Select id={p.id} value={id} onValueChange={pick} options={items.map(i => ({ value: i.id, label: i.name }))} aria-label={tt('production.reports.col.product')} />}
          </Field>
          <Field label={tt('production.reports.bom.qty')}>{p => <Input {...p} inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} />}</Field>
          <Field label={tt('production.reports.bom.priceMode')}>
            {p => <Select id={p.id} value={mode} onValueChange={v => setMode(v as (typeof MODES)[number])} options={MODES.map(m => ({ value: m, label: tt(`production.reports.bom.mode.${m}`) }))} aria-label={tt('production.reports.bom.priceMode')} />}
          </Field>
          {mode === 'price_kind' && (
            <Field label={tt('production.reports.bom.priceKind')}>
              {p => <Select id={p.id} value={kind} onValueChange={v => setKind(v as (typeof KINDS)[number])} options={KINDS.map(k => ({ value: k, label: tt(`production.reports.bom.kind.${k}`) }))} aria-label={tt('production.reports.bom.priceKind')} />}
            </Field>
          )}
        </div>
        {params.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="muted" style={{ marginBottom: 8 }}>{tt('production.reports.bom.paramsHint')}</div>
            <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {params.map(p => (
                <Field key={p.key} label={p.name}>
                  {f =>
                    p.type === 'select' ? (
                      <Select id={f.id} value={values[p.key] ?? ''} onValueChange={v => setValues(s => ({ ...s, [p.key]: v }))} options={(p.options?.choices ?? []).map(c => ({ value: c.value, label: c.label }))} aria-label={p.name} />
                    ) : p.type === 'boolean' ? (
                      <label className="row" style={{ gap: 6, alignItems: 'center' }}>
                        <Checkbox id={f.id} checked={values[p.key] === 'true'} onChange={e => setValues(s => ({ ...s, [p.key]: e.target.checked ? 'true' : 'false' }))} />
                        {tt('production.reports.bom.yes')}
                      </label>
                    ) : (
                      <Input {...f} inputMode="decimal" value={values[p.key] ?? ''} onChange={e => setValues(s => ({ ...s, [p.key]: e.target.value }))} />
                    )
                  }
                </Field>
              ))}
            </div>
          </div>
        )}
      </section>
      <ReportState q={q} isEmpty={d => !d.rows.length}>
        {d => {
          const masked = d.total === null;
          const nameOf = (r: BomReportRow) => (r.kind === 'overhead' ? tt('production.reports.bom.overhead') : r.name);
          const columns: ReportColumn<BomReportRow>[] = [
            {
              id: 'name',
              header: tt('production.reports.bom.component'),
              value: nameOf,
              render: r => <span style={{ marginLeft: r.level * 16, color: r.nested ? 'var(--text-3)' : undefined }}>{nameOf(r)}</span>,
            },
            { id: 'kind', header: tt('production.reports.bom.kindCol'), value: r => tt(`production.reports.bom.rowKind.${r.kind}`) },
            { id: 'qty', header: tt('production.reports.bom.qty'), align: 'r', value: r => (r.nested || r.kind === 'work' ? null : r.qty), render: r => (r.kind === 'work' || r.kind === 'overhead' ? '' : num(r.qty)) },
            { id: 'hours', header: tt('production.reports.bom.hours'), align: 'r', value: r => (r.nested ? null : r.hours), render: r => (r.kind === 'work' ? num(r.hours) : ''), total: { format: num } },
            { id: 'center', header: tt('production.reports.col.workCenter'), value: r => r.workCenterName ?? '', render: r => r.workCenterName ?? '' },
            ...(masked
              ? []
              : ([
                  { id: 'price', header: tt('production.reports.bom.price'), align: 'r', value: r => r.price, render: r => (r.kind === 'overhead' ? '' : money(r.price)) },
                  { id: 'amount', header: tt('production.reports.bom.amount'), align: 'r', value: r => (r.nested ? null : r.amount), render: r => money(r.amount), total: { format: v => fmtAmount(v), scale: 2 } },
                ] as ReportColumn<BomReportRow>[])),
          ];
          const stage = (r: BomReportRow) => r.stageName ?? tt('production.reports.bom.noStage');
          const groups: GroupLevel<BomReportRow>[] = [{ key: r => `${r.stageOrder}|${r.stageId ?? ''}`, label: rows => stage(rows[0]!), csv: rows => stage(rows[0]!), csvHeader: tt('production.reports.bom.stage') }];
          return (
            <>
              <section className="panel plain" style={{ margin: '0 var(--gutter) 16px' }}>
                <div className="row" style={{ gap: 24, flexWrap: 'wrap' }}>
                  <div>
                    <div className="muted">{tt('production.reports.bom.product')}</div>
                    <Link to={`/production/${d.itemId}`}>{d.itemName}</Link>
                  </div>
                  <div>
                    <div className="muted">{tt('production.reports.bom.hoursTotal')}</div>
                    <strong>{num(d.hoursTotal)}</strong>
                  </div>
                  <div>
                    <div className="muted">{tt('production.reports.bom.total')}</div>
                    <strong>{money(d.total)}</strong>
                  </div>
                  <div>
                    <div className="muted">{tt('production.reports.bom.unitTotal')}</div>
                    <strong>{money(d.unitTotal)}</strong>
                  </div>
                </div>
                {masked && <Alert tone="info" className="mt-3">{tt('production.reports.amountsRestricted')}</Alert>}
                {!masked && d.unpriced > 0 && <Alert tone="warn" className="mt-3">{tt('production.reports.bom.unpriced', { count: d.unpriced })}</Alert>}
              </section>
              <ReportTable rows={d.rows} columns={columns} groups={groups} rowKey={(r, i) => `${i}${r.kind}${r.name}`} filename="production-bom" label={tt('production.reports.tab.bom')} />
            </>
          );
        }}
      </ReportState>
    </>
  );
}
