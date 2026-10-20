/* Предпросмотр печатной формы: готовая HTML-страница с сервера (та же, что уходит в PDF) в iframe и кнопка «Print» (window.print в iframe).
   Размер бумаги и разрывы страниц заданы самой формой (@page A4), поэтому диалог печати браузера открывается уже с нужной ориентацией. */
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, CircleAlert, Download, Printer } from 'lucide-react';
import { DOCUMENT_META, PRINT_FORMS, PRINT_FORM_LABELS, printOrientation, type PrintForm } from '@gr8r/shared';
import { Button, EmptyState, Select, Skeleton, toast } from '@/components/ui';
import { API_BASE } from '../data/api';
import { call, useWsId } from '../meta/data';
import { docTitle, useDocument } from './data';

export function PrintPage() {
  const { id, form } = useParams();
  const navigate = useNavigate();
  const ws = useWsId();
  const doc = useDocument(id);
  const frame = React.useRef<HTMLIFrameElement>(null);
  const [html, setHtml] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [height, setHeight] = React.useState(1200);
  const [pdf, setPdf] = React.useState<'idle' | 'working'>('idle');
  const valid = PRINT_FORMS.includes(form as PrintForm);

  // Страница грузится после сохранения документа; при смене формы или правке документа запрашивается заново
  React.useEffect(() => {
    if (!id || !valid) return;
    let alive = true;
    setHtml(null);
    setError(null);
    fetch(`${API_BASE()}/documents/${id}/print/${form}`, { credentials: 'include', headers: { 'X-Workspace-Id': ws } })
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => null);
          throw new Error(body?.error?.message ?? `Request failed (${r.status})`);
        }
        return r.text();
      })
      .then(t => alive && setHtml(t))
      .catch(e => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [id, form, ws, valid, doc.data?.updatedAt]);

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
    if (!id || !form) return;
    setPdf('working');
    try {
      const file = await call<{ id: string }>(ws, 'POST', `/documents/${id}/pdf`, { form });
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const st = await call<{ status: string; error?: string }>(ws, 'GET', `/documents/${id}/pdf/${file.id}`);
        if (st.status === 'failed') throw new Error(st.error || 'PDF generation failed');
        if (st.status === 'ready') {
          const res = await fetch(`${API_BASE()}/documents/${id}/pdf/${file.id}?download=1`, { credentials: 'include', headers: { 'X-Workspace-Id': ws } });
          if (!res.ok) throw new Error('Could not download the PDF');
          const url = URL.createObjectURL(await res.blob());
          const a = document.createElement('a');
          a.href = url;
          a.download = `${doc.data?.number ?? 'document'}-${form}.pdf`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
          return;
        }
      }
      throw new Error('The PDF is taking too long: is the worker running?');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPdf('idle');
    }
  };

  if (!valid || (doc.isError && !doc.isPending))
    return (
      <div className="page flush">
        <EmptyState icon={<CircleAlert size={20} />} error title="Nothing to print" action={<Link to="/sales" className="btn btn-secondary">Back to Sales</Link>}>
          This print form or document does not exist.
        </EmptyState>
      </div>
    );
  const forms = doc.data ? DOCUMENT_META[doc.data.type].forms : [];
  const landscape = printOrientation(form as PrintForm) === 'landscape';

  return (
    <div className="page flush print-page">
      <div className="ph print-bar">
        <div className="row" style={{ gap: 10, minWidth: 0 }}>
          <Link to={`/documents/${id}`} className="ibtn" aria-label="Back to the document">
            <ArrowLeft size={16} />
          </Link>
          <div style={{ minWidth: 0 }}>
            <h1 className="trunc">{PRINT_FORM_LABELS[form as PrintForm]}</h1>
            <p className="trunc">{doc.data ? docTitle(doc.data) : ' '} · A4 {landscape ? 'landscape' : 'portrait'}</p>
          </div>
        </div>
        <div className="acts">
          {forms.length > 1 && <Select value={form} onValueChange={f => navigate(`/documents/${id}/print/${f}`, { replace: true })} options={forms.map(f => ({ value: f, label: PRINT_FORM_LABELS[f] }))} aria-label="Print form" />}
          <Button onClick={() => void downloadPdf()} disabled={pdf === 'working' || !html}>
            <Download size={14} />
            {pdf === 'working' ? 'Preparing PDF…' : 'Download PDF'}
          </Button>
          <Button variant="primary" onClick={print} disabled={!html}>
            <Printer size={14} />
            Print
          </Button>
        </div>
      </div>
      <div className="print-stage">
        {error ? (
          <EmptyState icon={<CircleAlert size={20} />} error title="Could not build the form">
            {error}
          </EmptyState>
        ) : html === null ? (
          <Skeleton w="100%" h={400} />
        ) : (
          <iframe ref={frame} title="Print preview" className="print-frame" sandbox="allow-same-origin allow-modals" srcDoc={html} style={{ height, width: landscape ? 1160 : 820 }} onLoad={fit} />
        )}
      </div>
    </div>
  );
}
