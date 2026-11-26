/* Публичная страница отслеживания доставки для клиента (/d/:token, без авторизации, задача 1217). */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, Globe, MapPin, PackageCheck, RefreshCw, Truck, User } from 'lucide-react';
import { useParams } from 'react-router';
import { formatDeliveryWindow, type DeliveryStatus, type PublicDeliveryTracking } from '@erp/shared';
import { Alert, Badge, Button, type Tone } from '@/components/ui';
import { getLocale, setLocale, useT, type Locale } from '@/i18n';
import { API_BASE, ApiError, errorMessage, ok } from '../../data/api';
import { fmtDate, parse } from '../../lib/dates';

const STATUS_TONE: Record<DeliveryStatus, Tone> = {
  new: 'neutral',
  assigned: 'accent',
  in_transit: 'amber',
  delivered: 'green',
  failed: 'red',
};

const STEPS: readonly DeliveryStatus[] = ['new', 'assigned', 'in_transit', 'delivered'];
const LANGS: { code: Locale; label: string }[] = [
  { code: 'ru', label: 'RU' },
  { code: 'en', label: 'EN' },
  { code: 'es', label: 'ES' },
];

function trackingRequest<T>(url: string, init?: RequestInit) {
  return ok<T>(fetch(url, { ...init, credentials: 'omit', referrerPolicy: 'no-referrer' }));
}

export function PublicDeliveryPage() {
  const { token = '' } = useParams();
  return <PublicDeliveryView key={token} token={token} />;
}

function PublicDeliveryView({ token }: { token: string }) {
  const t = useT();
  const [lang, setLang] = React.useState<Locale>(getLocale());
  const url = `${API_BASE()}/public/delivery/${encodeURIComponent(token)}`;
  const q = useQuery({
    queryKey: ['public-delivery', token],
    queryFn: ({ signal }) => trackingRequest<PublicDeliveryTracking>(url, { signal }),
    retry: false,
    refetchInterval: 30_000,
    gcTime: 0,
  });

  const handleLang = (next: Locale) => {
    setLang(next);
    setLocale(next);
  };

  const data = q.data;
  const activeStep = data ? STEPS.indexOf(data.status) : -1;

  return (
    <main style={{ maxWidth: 680, minHeight: '100dvh', marginInline: 'auto', padding: 'clamp(1rem, 4vw, 2.5rem)' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Truck size={22} aria-hidden />
          <div>
            {data && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{data.workspaceName}</div>}
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>{t('delivery.public.title')}</h1>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <Globe size={14} aria-hidden />
            <select
              aria-label="Language"
              value={lang}
              onChange={e => handleLang(e.target.value as Locale)}
              style={{
                height: 30,
                padding: '0 8px',
                borderRadius: 'var(--r)',
                border: '1px solid var(--border-strong)',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: 13,
              }}
            >
              {LANGS.map(l => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </label>
          {data && (
            <Button size="sm" variant="ghost" loading={q.isFetching} onClick={() => void q.refetch()}>
              <RefreshCw size={13} />
              {t('delivery.public.refresh')}
            </Button>
          )}
        </div>
      </header>

      {q.isPending && <p role="status">{t('common.loading')}</p>}

      {q.isError && (
        <Alert
          tone="danger"
          title={t('delivery.public.unavailable')}
          action={<Button size="sm" loading={q.isFetching} onClick={() => void q.refetch()}>{t('common.retry')}</Button>}
        >
          {q.error instanceof ApiError && q.error.status === 404 ? t('delivery.public.invalidLink') : errorMessage(q.error)}
        </Alert>
      )}

      {data && !q.isError && (
        <div className="stack" style={{ gap: 16 }}>
          <section className="panel" style={{ padding: 18 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {t(`delivery.docType.${data.documentType}`)} {data.documentNumber ? `№ ${data.documentNumber}` : ''}
                </div>
                {data.contactName && <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{data.contactName}</div>}
              </div>
              <Badge tone={STATUS_TONE[data.status]}>{t(`delivery.status.${data.status}`)}</Badge>
            </div>

            {data.status !== 'failed' && (
              <div
                aria-label={t('delivery.tab.status')}
                style={{ display: 'grid', gridTemplateColumns: `repeat(${STEPS.length}, minmax(0, 1fr))`, gap: 8, marginBottom: 16 }}
              >
                {STEPS.map((step, i) => {
                  const done = activeStep >= i;
                  return (
                    <div key={step} style={{ display: 'grid', gap: 4 }}>
                      <div style={{ height: 4, borderRadius: 4, background: done ? 'var(--accent)' : 'var(--border)' }} />
                      <span style={{ fontSize: 12, fontWeight: step === data.status ? 600 : 400, color: done ? 'var(--text)' : 'var(--text-3)' }}>
                        {t(`delivery.status.${step}`)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="stack" style={{ gap: 10, fontSize: 14 }}>
              <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                <Clock size={16} style={{ marginTop: 2, color: 'var(--text-3)' }} aria-hidden />
                <div>
                  <div className="faint" style={{ fontSize: 12 }}>{t('delivery.public.window')}</div>
                  <div>
                    {data.deliveryDate || data.windowFrom || data.windowTo
                      ? `${data.deliveryDate ? fmtDate(parse(data.deliveryDate)) : ''}${data.deliveryDate && (data.windowFrom || data.windowTo) ? ', ' : ''}${formatDeliveryWindow(null, data.windowFrom, data.windowTo)}`
                      : t('delivery.public.noWindow')}
                  </div>
                </div>
              </div>

              {data.addressSummary && (
                <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                  <MapPin size={16} style={{ marginTop: 2, color: 'var(--text-3)' }} aria-hidden />
                  <div>
                    <div className="faint" style={{ fontSize: 12 }}>{t('delivery.public.address')}</div>
                    <div>{data.addressSummary}</div>
                  </div>
                </div>
              )}

              {(data.methodName || data.courierLabel || data.vehicleLabel) && (
                <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                  <User size={16} style={{ marginTop: 2, color: 'var(--text-3)' }} aria-hidden />
                  <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
                    {data.methodName && (
                      <div>
                        <div className="faint" style={{ fontSize: 12 }}>{t('delivery.public.method')}</div>
                        <div>{data.methodName}</div>
                      </div>
                    )}
                    {data.courierLabel && (
                      <div>
                        <div className="faint" style={{ fontSize: 12 }}>{t('delivery.public.courier')}</div>
                        <div>{data.courierLabel}</div>
                      </div>
                    )}
                    {data.vehicleLabel && (
                      <div>
                        <div className="faint" style={{ fontSize: 12 }}>{t('delivery.public.vehicle')}</div>
                        <div>{data.vehicleLabel}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="panel" style={{ padding: 18 }}>
            <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 12 }}>
              <PackageCheck size={16} aria-hidden />
              <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{t('delivery.public.timeline')}</h2>
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
              {data.timeline.map((ev, idx) => (
                <li key={`${ev.status}-${idx}`} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <Badge tone={STATUS_TONE[ev.status]}>{t(`delivery.status.${ev.status}`)}</Badge>
                  <span className="faint num" style={{ fontSize: 13 }}>{new Date(ev.at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
            <p className="faint" style={{ fontSize: 12, margin: '12px 0 0' }}>
              {t('delivery.public.updated')}: {new Date(data.updatedAt).toLocaleString()}
            </p>
          </section>
        </div>
      )}
    </main>
  );
}
