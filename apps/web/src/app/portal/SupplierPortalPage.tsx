import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Download, Upload } from 'lucide-react';
import { useParams } from 'react-router';
import { SUPPLIER_INVOICE_ACCEPT, SUPPLIER_INVOICE_MAX_BYTES, type SupplierOrderResponsePatch, type SupplierOrderStatus } from '@erp/shared';
import { DateInput } from '@/components/erp/date-picker';
import { Alert, Button, Field, Textarea } from '@/components/ui';
import { useT } from '@/i18n';
import { fmtCurrency, fmtNumber } from '@/i18n/format';
import { API_BASE, ApiError, errorMessage, ok } from '../data/api';
import { fmtDate } from '../lib/dates';
import { SupplierStatusBadge } from './SupplierStatusBadge';
import './supplier-portal.css';

interface OrderResponse {
  supplierStatus: SupplierOrderStatus;
  expectedShipDate: string | null;
  supplierComment: string;
}

interface Invoice {
  id: string;
  name: string;
}

interface Order extends OrderResponse {
  id: string;
  number: string | null;
  date: string;
  currency: string;
  total: string;
  vatTotal: string;
  comment: string;
  organizationName: string;
  lines: { id: string; name: string; unit: string; qty: string; price: string; total: string }[];
  invoices: Invoice[];
}

interface PortalData {
  workspaceName: string;
  supplierName: string;
  canWrite: boolean;
  orders: Order[];
}

function portalRequest<T>(url: string, init?: RequestInit) {
  return ok<T>(fetch(url, { ...init, credentials: 'omit', referrerPolicy: 'no-referrer' }));
}

export function SupplierPortalPage() {
  const { token = '' } = useParams();
  return <SupplierPortal key={token} token={token} />;
}

function SupplierPortal({ token }: { token: string }) {
  const t = useT();
  const client = useQueryClient();
  const url = `${API_BASE()}/public/supplier/${encodeURIComponent(token)}`;
  const key = ['public-supplier', token] as const;
  const portal = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => portalRequest<PortalData>(url, { signal }),
    retry: false,
    gcTime: 0,
  });
  const updateOrder = (id: string, update: (order: Order) => Order) => {
    client.setQueryData<PortalData>(key, data => data && ({
      ...data, orders: data.orders.map(order => order.id === id ? update(order) : order),
    }));
  };
  const refreshOnMissing = (error: unknown) => {
    if (error instanceof ApiError && error.status === 404) void client.invalidateQueries({ queryKey: key });
  };
  const data = portal.data;

  return (
    <main className="supplier-portal">
      {portal.isPending && <p role="status">{t('common.loading')}</p>}
      {portal.isError && (
        <Alert tone="danger" title={t('supplierPortal.unavailable')}
          action={<Button size="sm" loading={portal.isFetching} onClick={() => void portal.refetch()}>{t('common.retry')}</Button>}>
          {portal.error instanceof ApiError && portal.error.status === 404 ? t('supplierPortal.invalidLink') : errorMessage(portal.error)}
        </Alert>
      )}
      {data && !portal.isError && (
        <>
          <header className="supplier-portal-masthead">
            <div>{data.workspaceName}</div>
            <h1>{t('supplierPortal.orders')}</h1>
            <p>{data.supplierName}</p>
          </header>
          {!data.canWrite && <Alert>{t('supplierPortal.readOnly')}</Alert>}
          {!data.orders.length && <p className="muted">{t('supplierPortal.empty')}</p>}
          <div className="supplier-portal-orders">
            {data.orders.map(order => (
              <SupplierOrder key={order.id} order={order} url={`${url}/orders/${order.id}`} canWrite={data.canWrite}
                onSave={patch => updateOrder(order.id, old => ({ ...old, ...patch }))}
                onUpload={invoice => updateOrder(order.id, old => ({ ...old, invoices: [...old.invoices, invoice] }))}
                onError={refreshOnMissing} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}

const responseActions = ['confirmed', 'shipped', 'declined'] as const;

function SupplierOrder({ order, url, canWrite, onSave, onUpload, onError }: {
  order: Order;
  url: string;
  canWrite: boolean;
  onSave: (response: OrderResponse) => void;
  onUpload: (invoice: Invoice) => void;
  onError: (error: unknown) => void;
}) {
  const t = useT();
  const date = order.expectedShipDate ?? '';
  const [draftDate, setDraftDate] = React.useState<string | null>(null);
  const [draftComment, setDraftComment] = React.useState<string | null>(null);
  const [responseSaved, setResponseSaved] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const response = useMutation({
    mutationFn: (patch: SupplierOrderResponsePatch) => portalRequest<OrderResponse>(url, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    }),
    onSuccess: result => {
      onSave(result);
      setDraftDate(null);
      setDraftComment(null);
      setResponseSaved(true);
    },
    onError,
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      if (file.size > SUPPLIER_INVOICE_MAX_BYTES) throw new ApiError(413, 'attachment_too_large', t('supplierPortal.invoiceHint'), { maxBytes: SUPPLIER_INVOICE_MAX_BYTES });
      const body = new FormData();
      body.append('file', file);
      return portalRequest<Invoice>(`${url}/invoice`, { method: 'POST', body });
    },
    onSuccess: onUpload,
    onError,
  });
  const changed = (draftDate !== null && draftDate !== date) || (draftComment !== null && draftComment !== order.supplierComment);
  const submit = (supplierStatus?: SupplierOrderStatus) => {
    setResponseSaved(false);
    response.mutate({
      supplierStatus,
      expectedShipDate: draftDate === null || draftDate === date ? undefined : draftDate || null,
      supplierComment: draftComment === null || draftComment === order.supplierComment ? undefined : draftComment,
    });
  };

  return (
    <details className="supplier-portal-order">
      <summary className="supplier-portal-order-summary">
        <div className="supplier-portal-order-meta">
          <strong>{order.number || t('supplierPortal.order')}</strong>
          <span className="muted">{fmtDate(order.date)} · {order.organizationName}</span>
        </div>
        <SupplierStatusBadge status={order.supplierStatus} />
        <strong className="supplier-portal-amount">{fmtCurrency(order.total, order.currency)}</strong>
        <ChevronDown size={17} className="supplier-portal-chevron" aria-hidden />
      </summary>
      <div className="supplier-portal-order-body">
        {order.comment && <p className="supplier-portal-comment"><strong>{t('supplierPortal.orderComment')}</strong><br />{order.comment}</p>}
        <div className="supplier-portal-table-scroll">
          <table className="supplier-portal-table">
            <caption className="sr-only">{t('supplierPortal.items')}</caption>
            <thead><tr>
              <th scope="col">{t('supplierPortal.item')}</th>
              <th scope="col">{t('supplierPortal.quantity')}</th>
              <th scope="col">{t('supplierPortal.price')}</th>
              <th scope="col">{t('supplierPortal.total')}</th>
            </tr></thead>
            <tbody>{order.lines.map(line => (
              <tr key={line.id}>
                <th scope="row">{line.name}</th>
                <td>{fmtNumber(line.qty, { maximumFractionDigits: 3 })} {line.unit}</td>
                <td>{fmtCurrency(line.price, order.currency)}</td>
                <td>{fmtCurrency(line.total, order.currency)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="supplier-portal-vat">{t('supplierPortal.vat', { amount: fmtCurrency(order.vatTotal, order.currency) })}</p>

        <div className="supplier-portal-order-sections">
          <section>
            <h2>{t('supplierPortal.response')}</h2>
            <Field label={t('supplierPortal.shipDate')}>{props => (
              <DateInput {...props} value={draftDate ?? date} disabled={!canWrite || response.isPending}
                onChange={value => { setDraftDate(value); setResponseSaved(false); }} />
            )}</Field>
            <Field label={t('supplierPortal.comment')}>{props => (
              <Textarea {...props} rows={3} maxLength={4000} value={draftComment ?? order.supplierComment}
                readOnly={!canWrite} disabled={response.isPending} onChange={e => { setDraftComment(e.target.value); setResponseSaved(false); }} />
            )}</Field>
            {canWrite && <div className="supplier-portal-actions">
              {responseActions.map(status => (
                <Button key={status} type="button" size="sm" variant={status === 'declined' ? 'danger-ghost' : 'secondary'}
                  disabled={response.isPending || status === order.supplierStatus} onClick={() => submit(status)}>
                  {t(`supplierPortal.action.${status}`)}
                </Button>
              ))}
              <Button type="button" variant="primary" size="sm" disabled={!changed || response.isPending} onClick={() => submit()}>
                {t('supplierPortal.save')}
              </Button>
            </div>}
            {response.isPending && <p role="status">{t('supplierPortal.saving')}</p>}
            {responseSaved && <p role="status">{t('supplierPortal.saved')}</p>}
            {response.isError && <Alert tone="danger">{errorMessage(response.error)}</Alert>}
          </section>
          <section>
            <h2>{t('supplierPortal.invoices')}</h2>
            {order.invoices.length ? (
              <ul className="supplier-portal-invoices">
                {order.invoices.map(file => (
                  <li key={file.id}>
                    <a href={`${url}/invoice/${file.id}`} download={file.name} rel="noreferrer">
                      <Download size={15} aria-hidden /> {file.name}
                    </a>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">{t('supplierPortal.noInvoices')}</p>}
            {canWrite && <>
              <input ref={fileInput} hidden type="file" accept={SUPPLIER_INVOICE_ACCEPT} onChange={e => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = '';
                if (file) upload.mutate(file);
              }} />
              <Button type="button" size="sm" loading={upload.isPending} onClick={() => fileInput.current?.click()}>
                <Upload size={14} aria-hidden /> {t('supplierPortal.upload')}
              </Button>
              <p className="muted">{t('supplierPortal.invoiceHint')}</p>
            </>}
            {upload.isSuccess && <p role="status">{t('supplierPortal.uploaded')}</p>}
            {upload.isError && <Alert tone="danger">{errorMessage(upload.error)}</Alert>}
          </section>
        </div>
      </div>
    </details>
  );
}
