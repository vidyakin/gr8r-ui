/* Карточка контрагента: вкладка «Взаиморасчёты» — режим расчётов, сальдо, обороты периода и акт сверки */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Printer, Wallet } from 'lucide-react';
import { Button, EmptyState, Field, Input, Select, toast } from '@/components/ui';
import { fmtAmount, useT } from '@/i18n';
import { API_BASE, errorMessage } from '../data/api';
import { fmtDate } from '../lib/dates';
import { useCanWrite } from '../meta/custom-fields';
import { call, useWsId } from '../meta/data';
import { moneyKey, usePrintOpener, useSettlementCard } from './data';

const today = () => new Date().toISOString().slice(0, 10);

export function CompanySettlementsTab({ companyId }: { companyId: string }) {
  const tt = useT();
  const ws = useWsId();
  const qc = useQueryClient();
  const canWrite = useCanWrite();
  const openPrint = usePrintOpener();
  const [from, setFrom] = React.useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = React.useState(today());
  const [pdfBusy, setPdfBusy] = React.useState<string | null>(null);
  /** Акт сверки в PDF: задача воркеру, опрос статуса, скачивание файла */
  const downloadPdf = async (side: string) => {
    setPdfBusy(side);
    try {
      const file = await call<{ id: string; name: string }>(ws, 'POST', `/payments/settlements/${companyId}/act/pdf?side=${side}&from=${from}&to=${to}`);
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const st = await call<{ status: string; error?: string }>(ws, 'GET', `/payments/act-files/${file.id}`);
        if (st.status === 'failed') throw new Error(st.error || tt('money.card.pdfFailed'));
        if (st.status === 'ready') {
          const res = await fetch(`${API_BASE()}/payments/act-files/${file.id}?download=1`, { credentials: 'include', headers: { 'X-Workspace-Id': ws } });
          if (!res.ok) throw new Error(tt('money.card.pdfDownloadFailed'));
          const url = URL.createObjectURL(await res.blob());
          const a = document.createElement('a');
          a.href = url;
          a.download = file.name;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
          return;
        }
      }
      throw new Error(tt('money.card.pdfTimeout'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPdfBusy(null);
    }
  };
  const company = useQuery({ queryKey: moneyKey(ws, 'company', companyId), queryFn: () => call<{ id: string; settlementMode: string }>(ws, 'GET', `/companies/${companyId}`) });
  const card = useSettlementCard(companyId, { from, to });
  const setMode = async (settlementMode: string) => {
    try {
      await call(ws, 'PATCH', `/companies/${companyId}`, { settlementMode });
      await qc.invalidateQueries({ queryKey: ['ws', ws, 'docs'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="page" style={{ maxWidth: 980, paddingTop: 12, display: 'grid', gap: 18 }}>
      <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
        <Field label={tt('money.settlementMode.label')} hint={tt('money.settlementMode.hint')}>
          {p => (
            <Select
              id={p.id}
              disabled={!canWrite}
              value={company.data?.settlementMode ?? 'by_documents'}
              onValueChange={v => void setMode(v)}
              options={[
                { value: 'by_documents', label: tt('money.settlementMode.by_documents') },
                { value: 'by_counterparty', label: tt('money.settlementMode.by_counterparty') },
              ]}
              aria-label={tt('money.settlementMode.label')}
            />
          )}
        </Field>
        <Field label={tt('money.common.from')}>{p => <Input {...p} type="date" value={from} onChange={e => setFrom(e.target.value)} />}</Field>
        <Field label={tt('money.common.to')}>{p => <Input {...p} type="date" value={to} onChange={e => setTo(e.target.value)} />}</Field>
      </div>
      {card.data && !card.data.sides.length && <EmptyState icon={<Wallet size={20} />} title={tt('money.card.empty')} />}
      {card.data?.sides.map(s => (
        <section key={s.side}>
          <div className="row" style={{ gap: 12, alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>{tt(`money.card.${s.side}`)}</h3>
            <span className="muted">
              {tt('money.card.balance')}: <b>{fmtAmount(card.data!.balances[s.side])}</b>
            </span>
            <span className="faint" style={{ fontSize: 12 }}>{tt('money.card.debtHint')}</span>
            <span className="sp" />
            <Button size="sm" onClick={() => void openPrint(`/payments/settlements/${companyId}/act?side=${s.side}&from=${from}&to=${to}`).catch(e => toast.error(errorMessage(e)))}>
              <Printer size={13} />
              {tt('money.card.print')}
            </Button>
            <Button size="sm" disabled={pdfBusy !== null} onClick={() => void downloadPdf(s.side)}>
              <Download size={13} />
              {pdfBusy === s.side ? tt('money.card.pdfPreparing') : tt('money.card.pdf')}
            </Button>
          </div>
          <table className="dtbl" aria-label={tt(`money.card.${s.side}`)}>
            <thead>
              <tr>
                <th style={{ width: 110 }}>{tt('money.common.date')}</th>
                <th>{tt('money.debts.document')}</th>
                <th style={{ width: 130 }} className="r">{tt('money.card.accrual')}</th>
                <th style={{ width: 130 }} className="r">{tt('money.card.payment')}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bold">
                <td />
                <td>{tt('money.card.opening')}</td>
                <td className="r num" colSpan={2}>{fmtAmount(s.opening)}</td>
              </tr>
              {s.rows.map((r, i) => (
                <tr key={i}>
                  <td className="muted">{fmtDate(r.date)}</td>
                  <td>{r.label}</td>
                  <td className="r num">{Number(r.accrual) ? fmtAmount(r.accrual) : ''}</td>
                  <td className="r num">{Number(r.payment) ? fmtAmount(r.payment) : ''}</td>
                </tr>
              ))}
              <tr className="bold">
                <td />
                <td>{tt('money.card.closing')}</td>
                <td className="r num" colSpan={2}>{fmtAmount(s.closing)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
