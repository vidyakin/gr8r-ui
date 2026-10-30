/* Карта рейсов (задача 1213, docs/architecture/routing.md): Leaflet с плитками OSM по умолчанию и Яндекса при провайдере Яндекс.
   Грузится лениво (React.lazy), поэтому в основной пакет не входит. Рисует рейсы (ломаная и номерные точки в порядке объезда),
   нераспределённые доставки и базу. Точки без координат на карте не показываются. */
import * as React from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './RouteMap.css';
import type { TileConfig } from '@gr8r/shared';

export interface MapStop {
  id: string;
  lat: number;
  lon: number;
  label: string;
  title: string;
  late?: boolean;
}
export interface MapRoute {
  id: string;
  color: string;
  /** Подпись ломаной (номер рейса) */
  label: string;
  stops: MapStop[];
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const pin = (text: string, cls: string, color?: string) =>
  L.divIcon({ className: '', iconSize: [24, 24], iconAnchor: [12, 12], html: `<div class="rm-pin ${cls}"${color ? ` style="background:${color}"` : ''}>${esc(text)}</div>` });

export default function RouteMap({
  tile,
  routes,
  free = [],
  depot,
  height = 360,
  onRouteClick,
}: {
  tile: TileConfig;
  routes: MapRoute[];
  free?: MapStop[];
  depot?: { lat: number; lon: number } | null;
  height?: number;
  onRouteClick?: (id: string) => void;
}) {
  const host = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<L.Map | null>(null);
  const layer = React.useRef<L.LayerGroup | null>(null);
  const fitted = React.useRef('');
  const click = React.useRef(onRouteClick);
  click.current = onRouteClick;
  const [ready, setReady] = React.useState(0);

  // карта пересоздаётся только при смене плиток (у Яндекса другая проекция)
  React.useEffect(() => {
    if (!host.current) return;
    const map = L.map(host.current, { crs: tile.crs === 'EPSG3395' ? L.CRS.EPSG3395 : L.CRS.EPSG3857 }).setView([55.75, 37.62], 9);
    L.tileLayer(tile.url, { attribution: tile.attribution, maxZoom: tile.maxZoom }).addTo(map);
    layer.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    fitted.current = '';
    setReady(n => n + 1);
    return () => {
      map.remove();
      mapRef.current = null;
      layer.current = null;
    };
  }, [tile.url, tile.crs, tile.attribution, tile.maxZoom]);

  React.useEffect(() => {
    const map = mapRef.current;
    const g = layer.current;
    if (!map || !g) return;
    g.clearLayers();
    const pts: L.LatLngExpression[] = [];
    for (const r of routes) {
      const line: L.LatLngExpression[] = [];
      if (depot && r.stops.length) line.push([depot.lat, depot.lon]);
      for (const s of r.stops) line.push([s.lat, s.lon]);
      if (line.length > 1) {
        const pl = L.polyline(line, { color: r.color, weight: 4, opacity: 0.8 }).addTo(g);
        pl.bindTooltip(esc(r.label), { sticky: true });
        pl.on('click', () => click.current?.(r.id));
      }
      for (const s of r.stops) {
        const m = L.marker([s.lat, s.lon], { icon: pin(s.label, s.late ? 'late' : '', r.color), title: s.title }).addTo(g);
        m.bindTooltip(esc(s.title), { direction: 'top' });
        m.on('click', () => click.current?.(r.id));
        pts.push([s.lat, s.lon]);
      }
    }
    for (const s of free) {
      L.marker([s.lat, s.lon], { icon: pin(s.label, 'free'), title: s.title }).bindTooltip(esc(s.title), { direction: 'top' }).addTo(g);
      pts.push([s.lat, s.lon]);
    }
    if (depot) {
      L.marker([depot.lat, depot.lon], { icon: pin('B', 'depot') }).addTo(g);
      pts.push([depot.lat, depot.lon]);
    }
    // границы подгоняются при смене состава точек; пока состав тот же, масштаб пользователя не трогаем
    const sig = [...routes.flatMap(r => r.stops.map(s => s.id)), ...free.map(s => s.id)].join(',');
    if (pts.length && sig !== fitted.current) {
      fitted.current = sig;
      map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 15 });
    }
  }, [routes, free, depot, ready]);

  return (
    <div className="rm-wrap" style={{ height }}>
      <div ref={host} style={{ height: '100%', width: '100%' }} />
    </div>
  );
}
