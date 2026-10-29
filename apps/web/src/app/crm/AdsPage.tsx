/* Реклама (задача 1177): /crm/ads. Вкладки «Отчёт по каналам» (лиды, конверсия, новые клиенты, выигранные сделки, расходы,
   CPL, цена клиента, ROMI по источникам или кампаниям за период) и «Кампании» (кампании с расходами). Кампании и расходы
   правят admin и owner, отчёт видят все. Источники — Settings → Lead sources. */
import * as React from 'react';
import { useSearchParams } from 'react-router';
import { Megaphone, Plus, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, Dialog, DialogContent, EmptyState, Field, Input, Select, Textarea } from '@/components/ui';
import { fmtAmount, fmtNumber, useT } from '@/i18n';
import { useIsAdmin } from '../catalog/data';
import { dOff, fmtDate, iso } from '../lib/dates';
import { ReportState } from '../production/reports/shared';
import { StatusBadge } from '../leads/StatusBadge';
import { useAdApi, useAdCampaigns, useAdExpenses, useAdReport, useLeadSources, type AdCampaign, type AdReportRow } from './ad-data';

export function AdsPage() {
  const t = useT();
  const [sp, setSp] = useSearchParams();
  const tab = (['report', 'campaigns'] as const).find(x => x === sp.get('tab')) ?? 'report';
  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('ads.title')}</h1>
          <p>{t('ads.subtitle')}</p>
        </div>
      </div>
      <nav className="tabs doc-tabs" aria-label={t('ads.title')}>
        {(['report', 'campaigns'] as const).map(id => (
          <button key={id} type="button" className={`tab${id === tab ? ' on' : ''}`} aria-current={id === tab ? 'page' : undefined} onClick={() => setSp({ tab: id }, { replace: true })}>
            {t(`ads.tab.${id}`)}
          </button>
        ))}
      </nav>
      {tab === 'report' ? <ReportTab /> : <CampaignsTab />}
    </div>
  );
}

/* ---------------- отчёт по каналам ---------------- */

const pctOrDash = (v: string | null) => (v === null ? '—' : `${fmtNumber(v, { maximumFractionDigits: 1 })} %`);
const amountOrDash = (v: string | null) => (v === null ? '—' : fmtAmount(v));

function ReportTab() {
  const t = useT();
  const [from, setFrom] = React.useState(dOff(-89));
  const [to, setTo] = React.useState(iso(new Date()));
  const [groupBy, setGroupBy] = React.useState<'source' | 'campaign'>('source');
  const q = useAdReport(from, to, groupBy);
  const label = (r: AdReportRow) =>
    r.key === null ? <span className="muted">{groupBy === 'source' ? t('ads.report.noSource') : t('ads.report.noCampaign')}</span> : (
      <span className="row" style={{ gap: 6 }}>
        <StatusBadge status={{ name: r.name ?? '—', color: r.color ?? 'gray' }} />
        {groupBy === 'campaign' && r.sourceName && <span className="faint" style={{ fontSize: 12 }}>{r.sourceName}</span>}
      </span>
    );
  const cells = (r: AdReportRow) => (
    <>
      <td className="r num">{fmtNumber(r.leads)}</td>
      <td className="r num">{pctOrDash(r.conversion)}</td>
      <td className="r num">{fmtNumber(r.newClients)}</td>
      <td className="r num">{fmtNumber(r.wonDeals)}</td>
      <td className="r num">{fmtAmount(r.revenue)}</td>
      <td className="r num">{fmtAmount(r.expense)}</td>
      <td className="r num">{amountOrDash(r.cpl)}</td>
      <td className="r num">{amountOrDash(r.cac)}</td>
      <td className="r num">{r.romi === null ? '—' : <Badge tone={Number(r.romi) >= 0 ? 'green' : 'red'}>{pctOrDash(r.romi)}</Badge>}</td>
    </>
  );
  return (
    <>
      <div className="toolbar" style={{ margin: '0 var(--gutter)', gap: 8, flexWrap: 'wrap' }}>
        <Input type="date" aria-label={t('ads.report.from')} value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} style={{ width: 150 }} />
        <span className="faint">—</span>
        <Input type="date" aria-label={t('ads.report.to')} value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)} style={{ width: 150 }} />
        <Select size="sm" aria-label={t('ads.report.groupBy')} value={groupBy} onValueChange={v => setGroupBy(v as 'source' | 'campaign')} options={[{ value: 'source', label: t('ads.report.bySource') }, { value: 'campaign', label: t('ads.report.byCampaign') }]} />
      </div>
      <ReportState q={q} isEmpty={d => !d.rows.length}>
        {d => (
          <div style={{ overflowX: 'auto', padding: '0 var(--gutter) 16px' }}>
            {d.currencies.length > 1 && <Alert tone="warn" className="mb-3">{t('ads.report.mixedCurrency', { list: d.currencies.join(', ') })}</Alert>}
            <table className="tbl" aria-label={t('ads.tab.report')}>
              <thead>
                <tr>
                  <th>{groupBy === 'source' ? t('ads.col.source') : t('ads.col.campaign')}</th>
                  <th className="r">{t('ads.col.leads')}</th>
                  <th className="r">{t('ads.col.conversion')}</th>
                  <th className="r">{t('ads.col.newClients')}</th>
                  <th className="r">{t('ads.col.wonDeals')}</th>
                  <th className="r">{t('ads.col.revenue')}</th>
                  <th className="r">{t('ads.col.expense')}</th>
                  <th className="r">{t('ads.col.cpl')}</th>
                  <th className="r">{t('ads.col.cac')}</th>
                  <th className="r">{t('ads.col.romi')}</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map(r => (
                  <tr key={r.key ?? 'none'}>
                    <td>{label(r)}</td>
                    {cells(r)}
                  </tr>
                ))}
                <tr style={{ fontWeight: 600 }}>
                  <td>{t('ads.report.total')}</td>
                  {cells(d.total)}
                </tr>
              </tbody>
            </table>
            <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>{t('ads.report.hint')}</p>
          </div>
        )}
      </ReportState>
      {q.data && !q.data.rows.length && <EmptyState icon={<Megaphone size={20} />} title={t('ads.report.empty')} />}
    </>
  );
}

/* ---------------- кампании ---------------- */

function CampaignsTab() {
  const t = useT();
  const isAdmin = useIsAdmin();
  const campaigns = useAdCampaigns('exclude');
  const allSources = useLeadSources().data ?? [];
  const sources = allSources.filter(s => !s.archivedAt);
  const [edit, setEdit] = React.useState<AdCampaign | 'new' | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);
  const srcName = (id: string) => allSources.find(s => s.id === id);
  return (
    <>
      <div className="toolbar" style={{ margin: '0 var(--gutter)' }}>
        {!isAdmin && <span className="muted" style={{ fontSize: 12.5 }}>{t('ads.onlyAdmins')}</span>}
        <span className="sp" />
        {isAdmin && (
          <Button size="sm" variant="primary" disabled={!sources.length} onClick={() => setEdit('new')}>
            <Plus size={13} />
            {t('ads.campaign.new')}
          </Button>
        )}
      </div>
      {isAdmin && !sources.length && (
        <div style={{ margin: '0 var(--gutter) 12px' }}>
          <Alert tone="info">{t('ads.campaign.needSource')}</Alert>
        </div>
      )}
      <ReportState q={campaigns} isEmpty={d => !d.length}>
        {d => (
          <div style={{ overflowX: 'auto', padding: '0 var(--gutter) 16px' }}>
            <table className="tbl" aria-label={t('ads.tab.campaigns')}>
              <thead>
                <tr>
                  <th>{t('ads.col.campaign')}</th>
                  <th>{t('ads.col.source')}</th>
                  <th>{t('ads.campaign.utm')}</th>
                  <th>{t('ads.campaign.period')}</th>
                  <th className="r">{t('ads.campaign.budget')}</th>
                  <th className="r">{t('ads.campaign.spent')}</th>
                </tr>
              </thead>
              <tbody>
                {d.map(c => {
                  const s = srcName(c.sourceId);
                  return (
                    <React.Fragment key={c.id}>
                      <tr>
                        <td>
                          <button type="button" className="crm-link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }} onClick={() => setOpen(open === c.id ? null : c.id)}>
                            {c.name}
                          </button>
                          {isAdmin && (
                            <Button size="sm" variant="ghost" style={{ marginLeft: 6 }} onClick={() => setEdit(c)}>
                              {t('ads.campaign.edit')}
                            </Button>
                          )}
                        </td>
                        <td>{s ? <StatusBadge status={s} /> : '—'}</td>
                        <td className="muted">{c.utmCampaign || '—'}</td>
                        <td className="num">{c.startDate ? fmtDate(c.startDate) : '…'} — {c.endDate ? fmtDate(c.endDate) : '…'}</td>
                        <td className="r num">{fmtAmount(c.budget)}</td>
                        <td className="r num">{fmtAmount(c.spent)}</td>
                      </tr>
                      {open === c.id && (
                        <tr>
                          <td colSpan={6} style={{ background: 'var(--bg-subtle, transparent)' }}>
                            <Expenses campaign={c} canEdit={isAdmin} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>{t('ads.campaign.hint')}</p>
          </div>
        )}
      </ReportState>
      {campaigns.data && !campaigns.data.length && <EmptyState icon={<Megaphone size={20} />} title={t('ads.campaign.empty')} />}
      {edit && <CampaignDialog campaign={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function Expenses({ campaign, canEdit }: { campaign: AdCampaign; canEdit: boolean }) {
  const t = useT();
  const api = useAdApi();
  const q = useAdExpenses(campaign.id);
  const [date, setDate] = React.useState(iso(new Date()));
  const [amount, setAmount] = React.useState('');
  const [comment, setComment] = React.useState('');
  const valid = /^\d+([.,]\d{1,2})?$/.test(amount.trim());
  const add = async () => {
    if (await api('POST', '/ad-expenses', { campaignId: campaign.id, date, amount: amount.trim().replace(',', '.'), comment })) {
      setAmount('');
      setComment('');
    }
  };
  return (
    <div className="stack" style={{ gap: 8, padding: '6px 0' }}>
      <div style={{ fontWeight: 500 }}>{t('ads.expense.title')}</div>
      {!(q.data ?? []).length ? (
        <span className="faint">{t('ads.expense.empty')}</span>
      ) : (
        <table className="tbl" aria-label={t('ads.expense.title')}>
          <tbody>
            {(q.data ?? []).map(e => (
              <tr key={e.id}>
                <td className="num" style={{ width: 120 }}>{fmtDate(e.date)}</td>
                <td className="r num" style={{ width: 140 }}>{fmtAmount(e.amount)}</td>
                <td className="muted">{e.comment}</td>
                <td style={{ width: 40 }}>{canEdit && <Button size="sm" variant="ghost" aria-label={t('ads.expense.delete')} onClick={() => void api('DELETE', `/ad-expenses/${e.id}`)}><Trash2 size={13} /></Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canEdit && (
        <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label={t('ads.expense.date')}>{p => <Input {...p} type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} style={{ width: 150 }} />}</Field>
          <Field label={t('ads.expense.amount')}>{p => <Input {...p} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: 130 }} />}</Field>
          <Field label={t('ads.expense.comment')}>{p => <Input {...p} maxLength={1000} value={comment} onChange={e => setComment(e.target.value)} style={{ width: 240 }} />}</Field>
          <Button size="sm" disabled={!valid} onClick={() => void add()}>
            <Plus size={13} />
            {t('ads.expense.add')}
          </Button>
        </div>
      )}
    </div>
  );
}

function CampaignDialog({ campaign, onClose }: { campaign: AdCampaign | null; onClose: () => void }) {
  const t = useT();
  const api = useAdApi();
  const sources = (useLeadSources().data ?? []).filter(s => !s.archivedAt || s.id === campaign?.sourceId);
  const [f, setF] = React.useState({
    name: campaign?.name ?? '',
    sourceId: campaign?.sourceId ?? sources[0]?.id ?? '',
    utmCampaign: campaign?.utmCampaign ?? '',
    startDate: campaign?.startDate ?? iso(new Date()),
    endDate: campaign?.endDate ?? '',
    budget: campaign?.budget ?? '0',
    comment: campaign?.comment ?? '',
  });
  const set = (p: Partial<typeof f>) => setF(x => ({ ...x, ...p }));
  const valid = f.name.trim() && f.sourceId && /^\d+([.,]\d{1,2})?$/.test(String(f.budget).trim());
  const save = async () => {
    const body = { ...f, name: f.name.trim(), budget: String(f.budget).trim().replace(',', '.'), startDate: f.startDate || null, endDate: f.endDate || null };
    const r = campaign ? await api('PATCH', `/ad-campaigns/${campaign.id}`, body) : await api('POST', '/ad-campaigns', body);
    if (r) onClose();
  };
  const archive = async () => {
    if (campaign && (await api('DELETE', `/ad-campaigns/${campaign.id}`))) onClose();
  };
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={campaign ? campaign.name : t('ads.campaign.new')}
        footer={
          <>
            {campaign && (
              <Button variant="ghost" onClick={() => void archive()}>
                {t('ads.campaign.archive')}
              </Button>
            )}
            <Button variant="primary" disabled={!valid} onClick={() => void save()}>
              {campaign ? t('ads.campaign.save') : t('ads.campaign.create')}
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
          <Field label={t('ads.campaign.name')}>{p => <Input {...p} maxLength={200} value={f.name} onChange={e => set({ name: e.target.value })} />}</Field>
          <Field label={t('ads.col.source')}>{p => <Select {...p} value={f.sourceId} onValueChange={v => set({ sourceId: v })} options={sources.map(s => ({ value: s.id, label: s.name }))} />}</Field>
          <Field label={t('ads.campaign.utm')} hint={t('ads.campaign.utmHint')}>{p => <Input {...p} maxLength={200} value={f.utmCampaign} onChange={e => set({ utmCampaign: e.target.value })} />}</Field>
          <Field label={t('ads.campaign.budget')}>{p => <Input {...p} inputMode="decimal" value={f.budget} onChange={e => set({ budget: e.target.value })} />}</Field>
          <Field label={t('ads.campaign.start')}>{p => <Input {...p} type="date" value={f.startDate} onChange={e => set({ startDate: e.target.value })} />}</Field>
          <Field label={t('ads.campaign.end')}>{p => <Input {...p} type="date" value={f.endDate} onChange={e => set({ endDate: e.target.value })} />}</Field>
        </div>
        <Field label={t('ads.campaign.comment')}>{p => <Textarea {...p} rows={2} maxLength={5000} value={f.comment} onChange={e => set({ comment: e.target.value })} />}</Field>
      </DialogContent>
    </Dialog>
  );
}
