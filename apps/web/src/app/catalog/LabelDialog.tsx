import * as React from 'react';
import { isEan13, renderLabels, type LabelFormat } from '@erp/shared';
import { Button, Dialog, DialogContent, Input } from '@/components/ui';
import { useT } from '@/i18n';
import { withPrintCsp } from '@/lib/print-csp';
import { call, useWsId } from '../meta/data';
import { usePriceKinds, useResolvePrices } from '../pricing/data';
import { useCatalogApi, type Product } from './data';
import { errorMessage } from '../data/api';

export function LabelDialog({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const t = useT(); const ws = useWsId(); const api = useCatalogApi(); const kinds = usePriceKinds(); const resolve = useResolvePrices();
  const [products, setProducts] = React.useState<Product[]>([]);
  const [counts, setCounts] = React.useState<Record<string, number>>(() => Object.fromEntries(ids.map(id => [id, 1])));
  const [format, setFormat] = React.useState<LabelFormat>('58x40');
  const [kind, setKind] = React.useState(''); const [prices, setPrices] = React.useState<Record<string, string | null>>({});
  const [error, setError] = React.useState(''); const [busy, setBusy] = React.useState(false);
  const frame = React.useRef<HTMLIFrameElement>(null);
  React.useEffect(() => { let live = true; Promise.all(ids.map(id => call<Product>(ws, 'GET', `/products/${id}`))).then(rows => { if (live) setProducts(rows); }).catch(e => { if (live) setError(errorMessage(e)); }); return () => { live = false; }; }, [ws, ids.join('|')]);
  React.useEffect(() => { if (!kind || !ids.length) return; let live = true; resolve({ productIds: ids, priceKindId: kind }).then(r => { if (live) setPrices(r.prices); }).catch(e => { if (live) setError(errorMessage(e)); }); return () => { live = false; }; }, [kind, ws, ids.join('|')]);
  const selected = products.filter(p => (counts[p.id] ?? 0) > 0);
  const valid = selected.length > 0 && selected.every(p => isEan13(p.barcode) && prices[p.id] != null) && !!kind;
  const html = valid ? withPrintCsp(renderLabels(selected.map(p => ({ name: p.name, sku: p.sku, barcode: p.barcode, price: prices[p.id]!, copies: counts[p.id]! })), format)) : '';
  const generate = async () => { setBusy(true); const result = await api<{ items: { id: string; barcode: string }[] }>('POST', '/products/generate-barcodes', { ids: products.filter(p => !p.barcode).map(p => p.id) }); if (result) setProducts(rows => rows.map(p => ({ ...p, barcode: result.items.find(x => x.id === p.id)?.barcode ?? p.barcode }))); setBusy(false); };
  return <Dialog open onOpenChange={o => !o && onClose()}><DialogContent size="lg" title={t('catalog.labels.title')} footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={!valid} onClick={() => frame.current?.contentWindow?.print()}>{t('catalog.labels.print')}</Button></>}>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}><label>{t('catalog.labels.format')} <select value={format} onChange={e => setFormat(e.target.value as LabelFormat)}><option value="58x40">58 × 40 mm</option><option value="43x25">43 × 25 mm</option><option value="a6">A6</option><option value="a4">A4</option></select></label><label>{t('catalog.labels.priceKind')} <select value={kind} onChange={e => { setPrices({}); setKind(e.target.value); }}><option value="">—</option>{(kinds.data ?? []).map(k => <option key={k.id} value={k.id}>{k.name}</option>)}</select></label><Button size="sm" disabled={busy || !products.some(p => !p.barcode)} onClick={() => void generate()}>{t('catalog.labels.generate')}</Button></div>
    {error && <p role="alert">{error}</p>}
    <p className="muted">{t('catalog.labels.hint')}</p>
    <div style={{ maxHeight: 180, overflow: 'auto' }}>{products.map(p => <div key={p.id} className="row" style={{ gap: 8, marginBottom: 4 }}><span style={{ flex: 1 }}>{p.name} {p.barcode && !isEan13(p.barcode) ? `(${t('catalog.labels.invalid')})` : ''}</span><Input aria-label={`${t('catalog.labels.copies')} ${p.name}`} type="number" min={0} max={1000} value={counts[p.id] ?? 0} onChange={e => setCounts(c => ({ ...c, [p.id]: Math.min(1000, Math.max(0, Math.floor(Number(e.target.value) || 0))) }))} style={{ width: 80 }} /></div>)}</div>
    {html && <iframe ref={frame} title={t('catalog.labels.preview')} srcDoc={html} style={{ width: '100%', height: 280, border: '1px solid #ccc', background: 'white' }} />}
  </DialogContent></Dialog>;
}
