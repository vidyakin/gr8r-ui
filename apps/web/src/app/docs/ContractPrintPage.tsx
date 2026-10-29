/* Предпросмотр печати договора без документа (docs/architecture/contracts.md): /contracts/:id/print?template=<id>.
   Страница с сервера (та же, что уходит в PDF) в iframe, «Печать» и «Скачать PDF» (задача воркера contract.pdf). */
import * as React from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, CircleAlert, Download, Printer } from 'lucide-react';
import { Button, EmptyState, Skeleton, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { API_BASE } from '../data/api';
import { call, useWsId } from '../meta/data';
import { useContracts } from './billing-data';
import { useDocTemplates } from './data';

export function ContractPrintPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const templateId = search.get('template');
  const t = useT();
  const ws = useWsId();
  const frame = React.useRef<HTMLIFrameElement>(null);
  const templates = useDocTemplates({ purpose: 'contract' });
  const template = templateId ? templates.data?.find(x => x.id === templateId) : undefined;
  const contract = useContracts({}).data?.items.find(c => c.id === id);
  const [html, setHtml] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [height, setHeight] = React.useState(1200);
  const [pdf, setPdf] = React.useState<'idle' | 'working'>('idle');

  React.useEffect(() => {
    if (!id) return;
    let alive = true;
    setHtml(null);
    setError(null);
    fetch(`${API_BASE()}/contracts/${id}/print${templateId ? `?template=${encodeURIComponent(templateId)}` : ''}`, { credentials: 'include', headers: { 'X-Workspace-Id': ws } })
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => null);
          throw new Error(body?.error?.message ?? `Request failed (${r.status})`);
        }
        return r.text();
      })
      .then(tt => alive && setHtml(tt))
      .catch(e => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [id, ws, templateId]);

  const fit = () => {
    const d = frame.current?.contentDocument;
    if (d) setHeight(Math.max(600, d.documentElement.scrollHeight + 8));
  };
  const print = () => {
    const w = frame.current?.contentWindow;
    if (!w) return;
    w.focus();
    w.print();
  };

  const downloadPdf = async () => {
    if (!id) return;
    setPdf('working');
    try {
      const file = await call<{ id: string }>(ws, 'POST', `/contracts/${id}/pdf`, templateId ? { templateId } : {});
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const st = await call<{ status: string; error?: string }>(ws, 'GET', `/contracts/${id}/pdf/${file.id}`);
        if (st.status === 'failed') throw new Error(st.error || t('docs.print.pdfFailed'));
        if (st.status === 'ready') {
          const res = await fetch(`${API_BASE()}/contracts/${id}/pdf/${file.id}?download=1`, { credentials: 'include', headers: { 'X-Workspace-Id': ws } });
          if (!res.ok) throw new Error(t('docs.print.pdfDownloadFailed'));
          const url = URL.createObjectURL(await res.blob());
          const a = document.createElement('a');
          a.href = url;
          a.download = `contract-${contract?.number || id}.pdf`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
          return;
        }
      }
      throw new Error(t('docs.print.pdfTimeout'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPdf('idle');
    }
  };

  return (
    <div className="page flush print-page">
      <div className="ph print-bar">
        <div className="row" style={{ gap: 10, minWidth: 0 }}>
          <Link to="/contracts" className="ibtn" aria-label={t('docs.contracts.printBack')}>
            <ArrowLeft size={16} />
          </Link>
          <div style={{ minWidth: 0 }}>
            <h1 className="trunc">{template ? template.name : t('docs.contracts.printStandard')}</h1>
            <p className="trunc">{contract ? t('docs.contracts.printWith', { name: contract.number || contract.companyName }) : t('docs.contracts.printTitle')} · A4 {t('docs.print.portrait')}</p>
          </div>
        </div>
        <div className="acts">
          <Button onClick={() => void downloadPdf()} disabled={pdf === 'working' || !html}>
            <Download size={14} />
            {pdf === 'working' ? t('docs.print.preparingPdf') : t('docs.print.downloadPdf')}
          </Button>
          <Button variant="primary" onClick={print} disabled={!html}>
            <Printer size={14} />
            {t('docs.print.print')}
          </Button>
        </div>
      </div>
      <div className="print-stage">
        {error ? (
          <EmptyState icon={<CircleAlert size={20} />} error title={t('docs.print.buildError')}>
            {error}
          </EmptyState>
        ) : html === null ? (
          <Skeleton w="100%" h={400} />
        ) : (
          <iframe ref={frame} title={t('docs.print.previewTitle')} srcDoc={html} sandbox="allow-same-origin allow-modals" className="print-frame" onLoad={fit} style={{ height, width: 820 }} />
        )}
      </div>
    </div>
  );
}
