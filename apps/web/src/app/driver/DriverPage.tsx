import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, toast } from '@/components/ui';
import { fmtNumber, useT } from '@/i18n';
import { unitSymbol, useUnits } from '../catalog/data';
import { call, useWsId } from '../meta/data';
import { useSession } from '../data/session';
import { ApiError, errorMessage } from '../data/api';
import { iso, today } from '../lib/dates';
import { enqueue, flushQueue, queuedFor, removeQueued } from './queue';

interface Stop {
  id: string;
  seq: number;
  address: string;
  title: string;
  lat: string | null;
  lon: string | null;
  contactName: string;
  contactPhone: string;
  status: 'planned' | 'arrived' | 'done' | 'failed';
  deliveryId: string | null;
  lines: { id: string; name: string; qty: string; unitCode: string }[];
  events: { id: string; hasPhoto: boolean; hasSignature: boolean }[];
}
interface Proof {
  id: string;
  photo: string | null;
  signature: string | null;
}
interface Trip {
  id: string;
  number: string;
  name: string;
  stops: Stop[];
}

export function DriverPage() {
  const t = useT();
  const ws = useWsId();
  const { user } = useSession();
  const qc = useQueryClient();
  const userId = user!.id;
  const date = iso(today());
  const key = ['ws', ws, 'driver', date];
  const trips = useQuery({ queryKey: key, queryFn: () => call<{ items: Trip[] }>(ws, 'GET', `/trips/driver/mine?date=${date}`) });
  const [actions, setActions] = React.useState<Awaited<ReturnType<typeof queuedFor>>>([]);
  const pending = actions.length;
  const [online, setOnline] = React.useState(navigator.onLine);
  const [error, setError] = React.useState('');
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const busy = React.useRef(false);
  const rerun = React.useRef(false);
  const rejected = React.useRef(false);
  const sync = React.useCallback(async () => {
    if (busy.current) {
      rerun.current = true;
      return;
    }
    busy.current = true;
    try {
      setError('');
      rejected.current = false;
      let attempted = false;
      do {
        const batch = await queuedFor(ws, userId);
        if (!batch.length) break;
        attempted = true;
        let failed = false;
        await flushQueue(
          batch,
          async a => {
            try {
              await call(ws, 'POST', a.path, a.body);
            } catch (e) {
              failed = true;
              rejected.current = e instanceof ApiError && e.status >= 400 && e.status < 500;
              setError(errorMessage(e));
              throw e;
            }
          },
          removeQueued,
        );
        setActions(await queuedFor(ws, userId));
        if (failed) break;
      } while (navigator.onLine);
      setActions(await queuedFor(ws, userId));
      if (attempted) void qc.invalidateQueries({ queryKey: ['ws', ws, 'driver'] });
    } finally {
      busy.current = false;
      if (rerun.current) {
        rerun.current = false;
        queueMicrotask(() => void sync());
      }
    }
  }, [ws, userId, qc]);
  React.useEffect(() => {
    const change = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void sync();
    };
    window.addEventListener('online', change);
    window.addEventListener('offline', change);
    const timer = window.setInterval(() => {
      if (navigator.onLine && !rejected.current) void sync();
    }, 15000);
    void sync();
    return () => {
      window.removeEventListener('online', change);
      window.removeEventListener('offline', change);
      window.clearInterval(timer);
    };
  }, [sync]);
  const submit = async (path: string, body: Record<string, unknown>) => {
    const clientId = crypto.randomUUID();
    try {
      await enqueue({ clientId, workspaceId: ws, userId, path, body: { ...body, clientId } });
      setActions(await queuedFor(ws, userId));
      if (navigator.onLine) await sync();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <main className="page" style={{ maxWidth: 700, margin: '0 auto', padding: '20px 16px' }}>
      <h1>{t('trips.driver.title')}</h1>
      <p role="status">
        {online ? t('trips.driver.online') : t('trips.driver.offline')} · {t('trips.driver.queued')}: {pending}
      </p>
      {error && (
        <p role="alert">
          {error} <Button onClick={() => void sync()}>{t('trips.driver.retry')}</Button>{' '}
          {confirmDiscard ? (
            <>
              <Button
                variant="danger"
                onClick={() => {
                  setConfirmDiscard(false);
                  void (async () => {
                    if (actions[0]) await removeQueued(actions[0].clientId);
                    await sync();
                  })();
                }}
              >
                {t('trips.driver.confirmDiscard')}
              </Button>{' '}
              <Button onClick={() => setConfirmDiscard(false)}>{t('trips.driver.cancelDiscard')}</Button>
            </>
          ) : (
            <Button onClick={() => setConfirmDiscard(true)}>{t('trips.driver.discard')}</Button>
          )}
        </p>
      )}
      {trips.isPending && <p>{t('common.loading')}</p>}
      {trips.isError && !trips.data && <p role="alert">{t('trips.driver.failure')}</p>}
      {trips.data?.items.length === 0 && <p>{t('trips.driver.empty')}</p>}
      {trips.data?.items.map(trip => (
        <section key={trip.id} style={{ marginTop: 24 }}>
          <h2>
            {trip.number} {trip.name}
          </h2>
          {trip.stops.map(stop => (
            <StopCard
              key={stop.id}
              trip={trip.id}
              stop={{
                ...stop,
                status: (actions.filter(a => a.path === `/trips/driver/${trip.id}/stops/${stop.id}/events`).at(-1)?.body.status as Stop['status'] | undefined) ?? stop.status,
              }}
              submit={submit}
            />
          ))}
        </section>
      ))}
    </main>
  );
}

function StopCard({ trip, stop, submit }: { trip: string; stop: Stop; submit: (path: string, body: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const units = useUnits();
  const ws = useWsId();
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const drawing = React.useRef(false);
  const [signed, setSigned] = React.useState(false);
  const [photo, setPhoto] = React.useState<string>();
  const [amount, setAmount] = React.useState('');
  const [quantities, setQuantities] = React.useState<Record<string, string>>({});
  const [link, setLink] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [proof, setProof] = React.useState<Proof[] | null>(null);
  const base = `/trips/driver/${trip}/stops/${stop.id}`;
  const mark = async (status: 'arrived' | 'done' | 'failed') => {
    const position = await new Promise<GeolocationPosition | null>(resolve =>
      navigator.geolocation ? navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { timeout: 5000, maximumAge: 30000 }) : resolve(null),
    );
    if (!position) toast.info(t('trips.driver.noLocation'));
    await submit(`${base}/events`, {
      status,
      ...(position ? { latitude: position.coords.latitude, longitude: position.coords.longitude } : {}),
      ...(photo ? { photo } : {}),
      ...(signed ? { signature: canvas.current!.toDataURL('image/png') } : {}),
    });
  };
  const direct = async (path: string, body: Record<string, unknown>, onSuccess?: (result: any) => void) => {
    setBusy(true);
    try {
      const result = await call(ws, 'POST', path, body);
      onSuccess?.(result);
      toast.success(t('trips.driver.saved'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvas.current!;
    const rect = c.getBoundingClientRect();
    return [((e.clientX - rect.left) * c.width) / rect.width, ((e.clientY - rect.top) * c.height) / rect.height] as const;
  };
  return (
    <article className="panel" style={{ padding: 16, margin: '12px 0', display: 'grid', gap: 12 }}>
      <div>
        <b>
          {stop.seq}. {stop.address || stop.title}
        </b>
        <p>
          {t(`trips.stopStatus.${stop.status}`)} {stop.contactName} {stop.contactPhone && <a href={`tel:${stop.contactPhone}`}>{stop.contactPhone}</a>}
        </p>
      </div>
      <Button asChild>
        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stop.lat && stop.lon ? `${stop.lat},${stop.lon}` : stop.address || stop.title)}`}
          target="_blank"
          rel="noreferrer"
        >
          {t('trips.driver.navigation')}
        </a>
      </Button>
      {stop.status !== 'done' && stop.status !== 'failed' && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button onClick={() => void mark('arrived')}>{t('trips.driver.arrived')}</Button>
            <Button variant="primary" onClick={() => void mark('done')}>
              {t('trips.driver.delivered')}
            </Button>
            <Button onClick={() => void mark('failed')}>{t('trips.driver.refused')}</Button>
          </div>
          <label>
            {t('trips.driver.photo')}{' '}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file && file.size > 1_500_000) {
                  toast.error(t('trips.driver.photoLarge'));
                  e.target.value = '';
                  return;
                }
                if (file) {
                  const reader = new FileReader();
                  reader.onload = () => setPhoto(String(reader.result));
                  reader.readAsDataURL(file);
                }
              }}
            />
          </label>
          <label>
            {t('trips.driver.signature')}{' '}
            <canvas
              ref={canvas}
              width={400}
              height={120}
              style={{ display: 'block', width: '100%', maxWidth: 400, height: 120, border: '1px solid currentColor', touchAction: 'none' }}
              onPointerDown={e => {
                e.currentTarget.setPointerCapture(e.pointerId);
                drawing.current = true;
                const [x, y] = point(e);
                const c = e.currentTarget.getContext('2d')!;
                c.beginPath();
                c.moveTo(x, y);
              }}
              onPointerMove={e => {
                if (!drawing.current) return;
                const [x, y] = point(e);
                const c = e.currentTarget.getContext('2d')!;
                c.lineWidth = 2;
                c.lineTo(x, y);
                c.stroke();
                setSigned(true);
              }}
              onPointerUp={() => {
                drawing.current = false;
              }}
            />
          </label>
          <Button
            onClick={() => {
              const c = canvas.current!;
              c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
              setSigned(false);
            }}
          >
            {t('trips.driver.clear')}
          </Button>
        </>
      )}
      {stop.events.some(e => e.hasPhoto || e.hasSignature) && (
        <div>
          <Button
            disabled={proof !== null}
            onClick={() =>
              void call<{ items: Proof[] }>(ws, 'GET', `${base}/proof`)
                .then(r => setProof(r.items))
                .catch(e => toast.error(errorMessage(e)))
            }
          >
            {t('trips.driver.proof')}
          </Button>
          {proof?.map(e => (
            <div key={e.id}>
              {e.photo && <img alt={t('trips.driver.photo')} src={e.photo} style={{ maxWidth: '100%' }} />}
              {e.signature && <img alt={t('trips.driver.signature')} src={e.signature} style={{ maxWidth: '100%' }} />}
            </div>
          ))}
        </div>
      )}
      {stop.deliveryId && (
        <>
          <label>
            {t('trips.driver.amount')} <Input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
          </label>
          <Button
            disabled={!amount}
            onClick={() => {
              void submit(`${base}/payments`, { amount });
              setAmount('');
            }}
          >
            {t('trips.driver.cash')}
          </Button>
          <Button disabled={busy} onClick={() => void direct(`${base}/payment-link`, { returnUrl: location.href, ...(amount ? { amount } : {}) }, r => setLink(r.url))}>
            {t('trips.driver.link')}
          </Button>
          {link && (
            <a href={link} target="_blank" rel="noreferrer">
              {link}
            </a>
          )}
          <p>{t('trips.driver.returnNote')}</p>
          {stop.lines.map(l => (
            <label key={l.id}>
              {l.name} ({fmtNumber(l.qty)} {unitSymbol(units.data, l.unitCode)}) — {t('trips.driver.quantity')}
              <Input type="number" min="0" max={l.qty} step="0.001" value={quantities[l.id] ?? ''} onChange={e => setQuantities({ ...quantities, [l.id]: e.target.value })} />
            </label>
          ))}
          <Button
            disabled={busy || !Object.values(quantities).some(v => Number(v) > 0)}
            onClick={() => {
              void submit(`${base}/returns`, {
                lines: Object.entries(quantities)
                  .filter(([, q]) => Number(q) > 0)
                  .map(([lineId, qty]) => ({ lineId, qty })),
              });
              setQuantities({});
            }}
          >
            {t('trips.driver.partial')}
          </Button>
        </>
      )}
    </article>
  );
}
