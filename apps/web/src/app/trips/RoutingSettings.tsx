/* Настройки маршрутизации арендатора (задача 1213, docs/architecture/routing.md): провайдер, адреса своих серверов, ключи Яндекса
   (в хранилище секретов — значение только вводится), база машин, время на точке и скорости для расчёта без провайдера. */
import * as React from 'react';
import { ROUTING_PROVIDERS, ROUTING_SECRETS, type RoutingProvider, type RoutingSettings as Settings } from '@gr8r/shared';
import { Alert, Button, Dialog, DialogContent, Field, Input, Select, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';
import { useTripApi, type RoutingView } from './data';

const numOrNull = (s: string): number | null => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s));

export function RoutingSettingsDialog({ view, onClose }: { view: RoutingView; onClose: () => void }) {
  const t = useT();
  const ws = useWsId();
  const api = useTripApi();
  const s0 = view.settings;
  const [s, setS] = React.useState<Settings>(s0);
  const [lat, setLat] = React.useState(s0.depotLat === null ? '' : String(s0.depotLat));
  const [lon, setLon] = React.useState(s0.depotLon === null ? '' : String(s0.depotLon));
  const [geoKey, setGeoKey] = React.useState('');
  const [routerKey, setRouterKey] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const set = (patch: Partial<Settings>) => setS(x => ({ ...x, ...patch }));
  const save = async () => {
    setBusy(true);
    try {
      // ключи Яндекса — в хранилище секретов; пустое поле оставляет прежнее значение
      for (const [key, value] of [[ROUTING_SECRETS.yandexGeocoder, geoKey], [ROUTING_SECRETS.yandexRouter, routerKey]] as const)
        if (value.trim()) await call(ws, 'PUT', `/secrets/${key}`, { value: value.trim() });
      const saved = await api('PUT', '/routing', { ...s, depotLat: numOrNull(lat), depotLon: numOrNull(lon) });
      if (saved) {
        toast.success(t('trips.routing.saved'));
        onClose();
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const yandex = s.provider === 'yandex';
  const own = s.provider === 'osrm_vroom';
  const text = (label: string, key: keyof Settings, hint?: string) => (
    <Field label={label} {...(hint ? { hint } : {})}>{p => <Input {...p} value={String(s[key] ?? '')} onChange={e => set({ [key]: e.target.value } as Partial<Settings>)} />}</Field>
  );
  const int = (label: string, key: 'serviceMinutes' | 'citySpeedKmh' | 'roadSpeedKmh', hint?: string) => (
    <Field label={label} {...(hint ? { hint } : {})}>{p => <Input {...p} type="number" min={0} value={String(s[key])} onChange={e => set({ [key]: Number(e.target.value) } as Partial<Settings>)} />}</Field>
  );
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={t('trips.routing.title')}
        description={t('trips.routing.lead')}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
            <Button disabled={busy} onClick={save}>{t('common.save')}</Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <Field label={t('trips.routing.provider')} hint={t(`trips.routing.providerHint.${s.provider}`)}>
            {p => (
              <Select
                id={p.id}
                aria-label={t('trips.routing.provider')}
                value={s.provider}
                onValueChange={v => set({ provider: v as RoutingProvider })}
                options={ROUTING_PROVIDERS.map(x => ({ value: x, label: t(`trips.routing.provider_${x}`) }))}
              />
            )}
          </Field>
          {s.provider === 'none' && <Alert tone="info">{t('trips.routing.noProvider')}</Alert>}
          {yandex && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              <Field label={t('trips.routing.geocoderKey')} hint={view.secrets.yandexGeocoder ? t('trips.routing.keySet') : t('trips.routing.keyNotSet')}>
                {p => <Input {...p} type="password" autoComplete="new-password" value={geoKey} onChange={e => setGeoKey(e.target.value)} placeholder={view.secrets.yandexGeocoder ? '••••••••' : ''} />}
              </Field>
              <Field label={t('trips.routing.routerKey')} hint={view.secrets.yandexRouter ? t('trips.routing.keySet') : t('trips.routing.keyNotSet')}>
                {p => <Input {...p} type="password" autoComplete="new-password" value={routerKey} onChange={e => setRouterKey(e.target.value)} placeholder={view.secrets.yandexRouter ? '••••••••' : ''} />}
              </Field>
              {text(t('trips.routing.mapsKey'), 'yandexMapsKey', t('trips.routing.mapsKeyHint'))}
            </div>
          )}
          {own && (
            <>
              <Alert tone="info">{t('trips.routing.ownHint')}</Alert>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                {text(t('trips.routing.osrmUrl'), 'osrmUrl', view.server.osrm ? t('trips.routing.serverDefault') : undefined)}
                {text(t('trips.routing.vroomUrl'), 'vroomUrl', view.server.vroom ? t('trips.routing.serverDefault') : undefined)}
                {text(t('trips.routing.nominatimUrl'), 'nominatimUrl', t('trips.routing.nominatimHint'))}
              </div>
            </>
          )}
          <div className="label">{t('trips.routing.planning')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
            {text(t('trips.routing.depotAddress'), 'depotAddress', t('trips.routing.depotHint'))}
            <Field label={t('trips.routing.depotLat')}>{p => <Input {...p} type="number" step="0.000001" value={lat} onChange={e => setLat(e.target.value)} />}</Field>
            <Field label={t('trips.routing.depotLon')}>{p => <Input {...p} type="number" step="0.000001" value={lon} onChange={e => setLon(e.target.value)} />}</Field>
            {int(t('trips.routing.service'), 'serviceMinutes')}
            <Field label={t('trips.routing.dayStart')}>{p => <Input {...p} type="time" value={s.dayStart} onChange={e => set({ dayStart: e.target.value || s.dayStart })} />}</Field>
            {int(t('trips.routing.citySpeed'), 'citySpeedKmh', t('trips.routing.speedHint'))}
            {int(t('trips.routing.roadSpeed'), 'roadSpeedKmh')}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
