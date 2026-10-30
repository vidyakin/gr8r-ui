/* Обёртка карты рейсов (задача 1213): ленивая загрузка Leaflet, цвета рейсов, перевод рейсов в линии карты, подпись ETA. */
import * as React from 'react';
import { Skeleton } from '@/components/ui';
import type { TileConfig } from '@gr8r/shared';
import type { MapRoute, MapStop } from './RouteMap';
import { useRouting } from './data';

const RouteMapLazy = React.lazy(() => import('./RouteMap'));

export type { MapRoute, MapStop };

const COLORS = ['#2563eb', '#d97706', '#059669', '#9333ea', '#dc2626', '#0891b2', '#be185d', '#65a30d'];
export const tripColor = (i: number) => COLORS[i % COLORS.length]!;

const num = (v: string | null | undefined): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

/** Точки с координатами в порядке объезда; подпись — номер точки в рейсе */
export function mapStops(stops: { id: string; seq: number; lat: string | null; lon: string | null; address: string; title: string; etaLate?: boolean }[]): MapStop[] {
  const out: MapStop[] = [];
  for (const s of stops) {
    const lat = num(s.lat);
    const lon = num(s.lon);
    if (lat === null || lon === null) continue;
    out.push({ id: s.id, lat, lon, label: String(s.seq), title: s.address || s.title || String(s.seq), late: !!s.etaLate });
  }
  return out;
}

/** «14:30», для многодневного рейса — «14:30 (+1)» */
export function etaText(etaMin: number | null | undefined): string {
  if (etaMin === null || etaMin === undefined) return '';
  const day = Math.floor(etaMin / 1440);
  const m = etaMin % 1440;
  const hm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return day > 0 ? `${hm} (+${day})` : hm;
}

export function RouteMapView(props: { routes: MapRoute[]; free?: MapStop[]; height?: number; onRouteClick?: (id: string) => void }) {
  const routing = useRouting().data;
  if (!routing) return <Skeleton w="100%" h={props.height ?? 360} />;
  const s = routing.settings;
  const depot = s.depotLat !== null && s.depotLon !== null ? { lat: s.depotLat, lon: s.depotLon } : null;
  return (
    <React.Suspense fallback={<Skeleton w="100%" h={props.height ?? 360} />}>
      <RouteMapLazy tile={routing.tile as TileConfig} depot={depot} {...props} />
    </React.Suspense>
  );
}
