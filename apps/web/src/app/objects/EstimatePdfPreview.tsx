import * as React from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { MAX_ESTIMATE_PDF_REGIONS, MAX_ESTIMATE_PDF_REGION_CHARS, type EstimatePdfRegion } from '@gr8r/shared';
import { Alert, Button } from '@/components/ui';
import { useT } from '@/i18n';

GlobalWorkerOptions.workerSrc = workerUrl;

const assets = import.meta.glob<string>(
  '../../../node_modules/pdfjs-dist/{cmaps,standard_fonts,wasm}/*.{bcmap,pfb,ttf,wasm}',
  { eager: true, query: '?url&no-inline', import: 'default' },
);
const assetFolders = { cMapUrl: 'cmaps', standardFontDataUrl: 'standard_fonts', wasmUrl: 'wasm' };

class PdfAssets {
  async fetch({ kind, filename }: { kind: keyof typeof assetFolders; filename: string }) {
    const url = assets[`../../../node_modules/pdfjs-dist/${assetFolders[kind]}/${filename}`];
    if (!url) throw new Error('Unknown PDF.js resource');
    const response = await fetch(url);
    if (!response.ok) throw new Error('Could not load a PDF.js resource');
    return new Uint8Array(await response.arrayBuffer());
  }
}

type Point = { x: number; y: number };
type Region = { page: number; start: Point; end: Point };

function bounds({ start, end }: Region) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function relativePoint(event: React.PointerEvent<HTMLDivElement>): Point {
  const rect = event.currentTarget.getBoundingClientRect();
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
}

async function renderRegion(pdf: PDFDocumentProxy, region: Region): Promise<EstimatePdfRegion> {
  const page = await pdf.getPage(region.page);
  const base = page.getViewport({ scale: 1 });
  const { x, y, width, height } = bounds(region);
  const scale = Math.min(5, 2600 / Math.max(base.width * width, base.height * height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width * width);
  canvas.height = Math.ceil(viewport.height * height);
  await page.render({ canvas, viewport, transform: [1, 0, 0, 1, -viewport.width * x, -viewport.height * y] }).promise;
  for (const quality of [0.95, 0.8, 0.6]) {
    const image = canvas.toDataURL('image/jpeg', quality).split(',')[1];
    if (image && image.length <= MAX_ESTIMATE_PDF_REGION_CHARS) return { page: region.page, image };
  }
  throw new Error('PDF selection exceeds the image limit');
}

export default function EstimatePdfPreview({ file, disabled, onRecognize }: {
  file: File;
  disabled: boolean;
  onRecognize?: (render: () => Promise<EstimatePdfRegion[]>) => void;
}) {
  const tt = useT();
  const [pdf, setPdf] = React.useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = React.useState(1);
  const [pageInput, setPageInput] = React.useState('1');
  const [loadedPage, setLoadedPage] = React.useState(0);
  const [error, setError] = React.useState(false);
  const [zoomed, setZoomed] = React.useState(false);
  const [regions, setRegions] = React.useState<Region[]>([]);
  const [draft, setDraft] = React.useState<Region | null>(null);
  const drag = React.useRef<{ pointer: number; start: Point } | null>(null);
  const canvas = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    let active = true;
    let task: ReturnType<typeof getDocument> | undefined;
    void (async () => {
      const data = await file.arrayBuffer();
      if (!active) return;
      task = getDocument({ data, useWorkerFetch: false, BinaryDataFactory: PdfAssets, enableXfa: false });
      const document = await task.promise;
      if (active) setPdf(document);
    })().catch(() => {
      if (active) setError(true);
    });
    return () => {
      active = false;
      void task?.destroy().catch(() => {});
    };
  }, [file]);

  React.useEffect(() => {
    if (!pdf || !canvas.current) return;
    const target = canvas.current;
    let active = true;
    let task: RenderTask | undefined;
    void (async () => {
      const pdfPage = await pdf.getPage(page);
      if (!active) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: 2400 / Math.max(base.width, base.height) });
      target.width = Math.ceil(viewport.width);
      target.height = Math.ceil(viewport.height);
      task = pdfPage.render({ canvas: target, viewport });
      await task.promise;
      if (active) setLoadedPage(page);
    })().catch(() => {
      if (active) setError(true);
    });
    return () => {
      active = false;
      task?.cancel();
    };
  }, [pdf, page]);

  function navigate(value: number) {
    const next = Math.min(pdf?.numPages ?? 1, Math.max(1, Math.trunc(value) || page));
    setPageInput(String(next));
    if (next === page) return;
    setError(false);
    setLoadedPage(0);
    setDraft(null);
    drag.current = null;
    setPage(next);
  }

  const canDraw = !!onRecognize && loadedPage === page && !disabled && regions.length < MAX_ESTIMATE_PDF_REGIONS;
  return (
    <section aria-label={tt('estimates.importPdfPreview')}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Button variant="ghost" disabled={disabled || !pdf || page === 1} onClick={() => navigate(page - 1)}>{tt('estimates.importPdfPrevious')}</Button>
        <input
          type="number" min={1} max={pdf?.numPages} value={pageInput} disabled={disabled || !pdf}
          aria-label={tt('estimates.importPageCol')} style={{ width: 64 }} className="input"
          onChange={e => setPageInput(e.target.value)} onBlur={() => navigate(Number(pageInput))}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); navigate(Number(pageInput)); } }}
        />
        <span className="faint">/ {pdf?.numPages ?? '…'}</span>
        <Button variant="ghost" disabled={disabled || !pdf || page === pdf.numPages} onClick={() => navigate(page + 1)}>{tt('estimates.importPdfNext')}</Button>
        <Button variant="ghost" disabled={!loadedPage || disabled} aria-pressed={zoomed} onClick={() => setZoomed(v => !v)}>{zoomed ? '100%' : '200%'}</Button>
      </div>
      {onRecognize && <p className="faint">{tt('estimates.importPdfSelectNote', { max: MAX_ESTIMATE_PDF_REGIONS })}</p>}
      {error && <Alert tone="danger">{tt('estimates.importPdfPreviewError')}</Alert>}
      {!error && !loadedPage && <p role="status">{tt('estimates.importPdfLoading')}</p>}
      <div className="table-wrap" style={{ maxHeight: '50vh', overflow: 'auto' }} hidden={!loadedPage}>
        <div
          style={{ position: 'relative', width: zoomed ? '200%' : '100%', touchAction: canDraw ? 'none' : 'auto', cursor: canDraw ? 'crosshair' : undefined }}
          onPointerDown={e => {
            if (!canDraw || !e.isPrimary || e.button !== 0) return;
            e.preventDefault();
            const start = relativePoint(e);
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { pointer: e.pointerId, start };
            setDraft({ page, start, end: start });
          }}
          onPointerMove={e => {
            if (drag.current?.pointer !== e.pointerId) return;
            setDraft({ page, start: drag.current.start, end: relativePoint(e) });
          }}
          onPointerUp={e => {
            if (drag.current?.pointer !== e.pointerId) return;
            const region = { page, start: drag.current.start, end: relativePoint(e) };
            drag.current = null;
            setDraft(null);
            const { width, height } = bounds(region);
            const rect = e.currentTarget.getBoundingClientRect();
            if (canDraw && width * rect.width >= 8 && height * rect.height >= 8) setRegions(current => [...current, region]);
          }}
          onLostPointerCapture={() => { drag.current = null; setDraft(null); }}
        >
          <canvas ref={canvas} role="img" aria-label={tt('estimates.importSourcePage', { n: page })} style={{ display: 'block', width: '100%' }} />
          {[...regions, ...(draft ? [draft] : [])].map((region, i) => {
            if (region.page !== page) return null;
            const { x, y, width, height } = bounds(region);
            return (
              <div key={i} aria-hidden style={{
                position: 'absolute', pointerEvents: 'none', border: '2px solid #2563eb', background: '#2563eb22',
                left: `${x * 100}%`, top: `${y * 100}%`, width: `${width * 100}%`, height: `${height * 100}%`,
              }}>
                {i < regions.length && <span style={{ background: '#2563eb', color: '#fff', padding: '0 4px' }}>{i + 1}</span>}
              </div>
            );
          })}
        </div>
      </div>
      {regions.length > 0 && (
        <ol style={{ paddingInlineStart: 24 }}>
          {regions.map((region, i) => (
            <li key={i}>
              <Button variant="ghost" disabled={disabled} onClick={() => navigate(region.page)}>{tt('estimates.importSourcePage', { n: region.page })}</Button>
              {onRecognize && <Button variant="ghost" disabled={disabled} onClick={() => setRegions(rs => rs.filter((_, index) => index !== i))}>{tt('estimates.importPdfRemoveRegion', { n: i + 1 })}</Button>}
            </li>
          ))}
        </ol>
      )}
      {onRecognize && <Button
        variant="primary" disabled={disabled || !pdf || !regions.length} style={{ marginTop: 8 }}
        onClick={() => {
          if (!pdf) return;
          onRecognize(async () => {
            const images = [];
            try {
              for (const region of regions) images.push(await renderRegion(pdf, region));
            } catch {
              throw new Error(tt('estimates.importPdfCropError'));
            }
            return images;
          });
        }}
      >{tt('estimates.importPdfRecognize', { count: regions.length })}</Button>}
    </section>
  );
}
