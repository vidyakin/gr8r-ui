/* Документ «Оказанные услуги за день» (задача 1171): /crm/appointments/day/:id. Один на специалиста за день.
   «Заполнить» берёт записи со статусом «пришёл»; строки правятся (товары и доп. услуги добавляются), проведение продаёт по каждому клиенту. */
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { dec, fmt, mul } from '@gr8r/shared';
import { Badge, Button, EmptyState, IconButton, Input, Select, Skeleton, Textarea, toast } from '@/components/ui';
import { fmtAmount, fmtDateTimeIntl, useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { useProducts } from '../catalog/data';
import { useCanWrite } from '../meta/custom-fields';
import { parse } from '../lib/dates';
import { useCrm } from './store';
import { fmtMin } from './appointments-ui';
import { useApptMutation, useDayDoc, type DayDoc } from './appointments-data';

type Row = { id?: string; companyId: string; contactId: string | null; productId: string; startMin: number | null; qty: string; price: string };

export function ServiceDayPage() {
  const { id } = useParams();
  const q = useDayDoc(id);
  const t = useT();
  if (q.isPending) return <div style={{ padding: 16 }}><Skeleton w="100%" h={160} /></div>;
  if (q.isError || !q.data) return <EmptyState icon={<ArrowLeft size={20} />} error title={t('appt.doc.notFound')}>{q.isError ? errorMessage(q.error) : ''}</EmptyState>;
  return <DayForm key={`${q.data.id}${q.data.status}${q.dataUpdatedAt}`} doc={q.data} />;
}

function DayForm({ doc }: { doc: DayDoc }) {
  const t = useT();
  const navigate = useNavigate();
  const { data: crm } = useCrm();
  const prods = useProducts({ active: true });
  const canEdit = useCanWrite() && doc.status === 'draft';
  const patch = useApptMutation<DayDoc>('PATCH');
  const act = useApptMutation<DayDoc>('POST');
  const del = useApptMutation<unknown>('DELETE');
  const [comment, setComment] = React.useState(doc.comment);
  const [rows, setRows] = React.useState<Row[]>(doc.lines.map(l => ({ id: l.id, companyId: l.companyId, contactId: l.contactId, productId: l.productId, startMin: l.startMin, qty: String(Number(l.qty)), price: String(Number(l.price)) })));
  const companyName = (id: string) => doc.lines.find(l => l.companyId === id)?.companyName ?? crm.companies.find(c => c.id === id)?.name ?? '';
  const productOptions = (prods.data ?? []).filter(p => p.kind === 'service' || p.kind === 'goods').map(p => ({ value: p.id, label: p.name }));
  const total = rows.reduce((s, r) => s + dec(fmt(mul(dec(r.qty || '0'), dec(r.price || '0')), 2)), 0n);
  const setRow = (i: number, p: Partial<Row>) => setRows(list => list.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const body = () => ({ comment, lines: rows.map(r => ({ ...(r.id ? { id: r.id } : {}), companyId: r.companyId, contactId: r.contactId, productId: r.productId, startMin: r.startMin, qty: r.qty || '1', price: r.price || '0' })) });
  const onErr = (e: unknown) => toast.error(errorMessage(e));
  const save = () => patch.mutate({ path: `/day-documents/${doc.id}`, body: body() }, { onSuccess: () => toast(t('appt.doc.saved')), onError: onErr });
  const post = () => patch.mutate({ path: `/day-documents/${doc.id}`, body: body() }, { onSuccess: () => act.mutate({ path: `/day-documents/${doc.id}/post` }, { onSuccess: () => toast(t('appt.doc.posted')), onError: onErr }), onError: onErr });
  const fill = () => patch.mutate({ path: `/day-documents/${doc.id}`, body: body() }, { onSuccess: () => act.mutate({ path: `/day-documents/${doc.id}/fill` }, { onSuccess: () => toast(t('appt.doc.filled')), onError: onErr }), onError: onErr });
  const clients = [...new Map(rows.map(r => [r.companyId, companyName(r.companyId)])).entries()];

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="ph">
        <div>
          <Link to="/crm/appointments?tab=unclosed" className="crm-link"><ArrowLeft size={13} /> {t('appt.doc.back')}</Link>
          <h1>{doc.number ?? t('appt.doc.title')}</h1>
          <p>
            <Badge tone={doc.status === 'posted' ? 'green' : 'gray'}>{t(`appt.doc.status.${doc.status}`)}</Badge> {doc.specialistName} · {fmtDateTimeIntl(parse(doc.date), { dateStyle: 'medium' })}
          </p>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {canEdit && <Button size="sm" onClick={fill} disabled={patch.isPending}>{t('appt.doc.fill')}</Button>}
          {canEdit && <Button size="sm" onClick={save} disabled={patch.isPending}>{t('common.save')}</Button>}
          {canEdit && <Button size="sm" variant="primary" onClick={post} disabled={patch.isPending || act.isPending || !rows.length}>{t('appt.doc.post')}</Button>}
          {useCanWrite() && doc.status === 'posted' && <Button size="sm" onClick={() => act.mutate({ path: `/day-documents/${doc.id}/unpost` }, { onSuccess: () => toast(t('appt.doc.unposted')), onError: onErr })}>{t('appt.doc.unpost')}</Button>}
          {canEdit && <Button size="sm" variant="ghost" onClick={() => del.mutate({ path: `/day-documents/${doc.id}` }, { onSuccess: () => { toast(t('appt.doc.deleted')); navigate('/crm/appointments?tab=unclosed'); }, onError: onErr })}>{t('common.delete')}</Button>}
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12.5, margin: '0 var(--gutter) 8px' }}>{doc.status === 'posted' ? t('appt.doc.postedHint') : t('appt.doc.hint')}</p>

      <div style={{ overflowX: 'auto', padding: '0 var(--gutter) 8px' }}>
        <table className="tbl" aria-label={t('appt.doc.lines')}>
          <thead>
            <tr><th>{t('appt.doc.client')}</th><th>{t('appt.doc.service')}</th><th>{t('appt.book.time')}</th><th className="r">{t('appt.doc.qty')}</th><th className="r">{t('appt.book.price')}</th><th className="r">{t('appt.doc.amount')}</th>{canEdit && <th />}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.id ?? 'new'}${i}`}>
                <td>{canEdit && !r.id ? <Select value={r.companyId} onValueChange={v => setRow(i, { companyId: v, contactId: null })} options={crm.companies.map(c => ({ value: c.id, label: c.name }))} aria-label={t('appt.doc.client')} /> : companyName(r.companyId)}</td>
                <td>{canEdit ? <Select value={r.productId} onValueChange={v => setRow(i, { productId: v })} options={productOptions} aria-label={t('appt.doc.service')} /> : productOptions.find(o => o.value === r.productId)?.label}</td>
                <td className="num">{r.startMin === null ? '—' : fmtMin(r.startMin)}</td>
                <td className="r">{canEdit ? <Input type="number" min={0} step="0.001" style={{ width: 80, textAlign: 'right' }} value={r.qty} aria-label={t('appt.doc.qty')} onChange={e => setRow(i, { qty: e.target.value })} /> : <span className="num">{r.qty}</span>}</td>
                <td className="r">{canEdit ? <Input type="number" min={0} step="0.01" style={{ width: 110, textAlign: 'right' }} value={r.price} aria-label={t('appt.book.price')} onChange={e => setRow(i, { price: e.target.value })} /> : <span className="num">{fmtAmount(r.price)}</span>}</td>
                <td className="r num">{fmtAmount(fmt(mul(dec(r.qty || '0'), dec(r.price || '0')), 2))}</td>
                {canEdit && <td><IconButton label={t('appt.doc.removeRow')} onClick={() => setRows(list => list.filter((_, k) => k !== i))}><Trash2 size={14} /></IconButton></td>}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={5}><strong>{t('appt.doc.total')}</strong></td><td className="r num"><strong>{fmtAmount(fmt(total, 2))}</strong></td>{canEdit && <td />}</tr>
          </tfoot>
        </table>
      </div>
      {canEdit && (
        <div className="row" style={{ gap: 8, padding: '0 var(--gutter) 12px', flexWrap: 'wrap' }}>
          {clients.map(([id, name]) => (
            <Button key={id} size="sm" variant="ghost" onClick={() => setRows(list => [...list, { companyId: id, contactId: null, productId: productOptions[0]?.value ?? '', startMin: null, qty: '1', price: '0' }])}>
              <Plus size={13} /> {name}
            </Button>
          ))}
          {!clients.length && <span className="faint" style={{ fontSize: 13 }}>{t('appt.doc.empty')}</span>}
        </div>
      )}
      <div style={{ padding: '0 var(--gutter) 16px' }}>
        <label className="label" htmlFor="day-comment">{t('appt.book.comment')}</label>
        <Textarea id="day-comment" rows={2} maxLength={2000} value={comment} disabled={!canEdit} onChange={e => setComment(e.target.value)} />
      </div>
      {doc.sales.length > 0 && (
        <section style={{ padding: '0 var(--gutter) 24px' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>{t('appt.doc.sales')}</h3>
          {doc.sales.map(s => (
            <div key={s.id} className="row" style={{ gap: 12, height: 32, fontSize: 13 }}>
              <Link to={`/documents/${s.id}`} className="crm-link">{s.number ?? s.type}</Link>
              <span className="num muted">{fmtAmount(s.total)}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
