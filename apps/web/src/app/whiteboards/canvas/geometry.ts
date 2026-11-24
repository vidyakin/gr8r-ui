// Геометрия, умное выравнивание, кривые Безье и экспорт доски в SVG / PNG
import type { WbArrow, WbBox, WbElement, WbSnapGuide } from './types';

// Границы любого элемента доски в координатах холста
export function elementBounds(el: WbElement): WbBox {
  if (el.type === 'arrow') {
    const x = Math.min(el.x1, el.x2);
    const y = Math.min(el.y1, el.y2);
    return {
      x,
      y,
      w: Math.max(8, Math.abs(el.x2 - el.x1)),
      h: Math.max(8, Math.abs(el.y2 - el.y1)),
    };
  }
  if (el.type === 'freehand') {
    if (el.points.length === 0) return { x: 0, y: 0, w: 8, h: 8 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [px, py] of el.points) {
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
    return {
      x: minX,
      y: minY,
      w: Math.max(8, maxX - minX),
      h: Math.max(8, maxY - minY),
    };
  }
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}

// Умное прилипание (Snap) к краям и центрам соседних блоков
export function computeSnap(
  movingBox: WbBox,
  otherBoxes: WbBox[],
  threshold = 6,
): { dx: number; dy: number; guides: WbSnapGuide[] } {
  const mXs = [movingBox.x, movingBox.x + movingBox.w / 2, movingBox.x + movingBox.w];
  const mYs = [movingBox.y, movingBox.y + movingBox.h / 2, movingBox.y + movingBox.h];

  let bestDx = 0;
  let bestDistX = threshold + 1;
  let bestXPos: number | null = null;

  let bestDy = 0;
  let bestDistY = threshold + 1;
  let bestYPos: number | null = null;

  for (const box of otherBoxes) {
    const oXs = [box.x, box.x + box.w / 2, box.x + box.w];
    for (const mx of mXs) {
      for (const ox of oXs) {
        const dist = Math.abs(ox - mx);
        if (dist <= threshold && dist < bestDistX) {
          bestDistX = dist;
          bestDx = ox - mx;
          bestXPos = ox;
        }
      }
    }

    const oYs = [box.y, box.y + box.h / 2, box.y + box.h];
    for (const my of mYs) {
      for (const oy of oYs) {
        const dist = Math.abs(oy - my);
        if (dist <= threshold && dist < bestDistY) {
          bestDistY = dist;
          bestDy = oy - my;
          bestYPos = oy;
        }
      }
    }
  }

  const guides: WbSnapGuide[] = [];
  if (bestXPos !== null) guides.push({ axis: 'x', pos: bestXPos });
  if (bestYPos !== null) guides.push({ axis: 'y', pos: bestYPos });
  return { dx: bestDx, dy: bestDy, guides };
}

// Точка привязки на границе блока по направлению к targetPoint
export function anchorPoint(
  box: WbBox,
  targetPoint: { x: number; y: number },
): { x: number; y: number } {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = targetPoint.x - cx;
  const dy = targetPoint.y - cy;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    return { x: cx, y: cy };
  }
  const hw = box.w / 2;
  const hh = box.h / 2;
  const scaleX = Math.abs(dx) > 0.001 ? hw / Math.abs(dx) : Infinity;
  const scaleY = Math.abs(dy) > 0.001 ? hh / Math.abs(dy) : Infinity;
  const t = Math.min(scaleX, scaleY);
  return { x: cx + dx * t, y: cy + dy * t };
}

// Сглаженная SVG-кривая (квадратичные кривые Безье) для свободного рисования
export function smoothSvgPath(points: [number, number][]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const [x, y] = points[0];
    return `M ${x.toFixed(1)} ${y.toFixed(1)} L ${(x + 0.1).toFixed(1)} ${y.toFixed(1)}`;
  }
  let d = `M ${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const mx = ((x1 + x2) / 2).toFixed(1);
    const my = ((y1 + y2) / 2).toFixed(1);
    d += ` Q ${x1.toFixed(1)} ${y1.toFixed(1)} ${mx} ${my}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last[0].toFixed(1)} ${last[1].toFixed(1)}`;
  return d;
}

// Координаты концов стрелки с учётом привязки к блокам
export function resolveArrowEndpoints(
  arrow: WbArrow,
  byId: Map<string, WbElement>,
): { x1: number; y1: number; x2: number; y2: number } {
  const fromEl = arrow.fromId ? byId.get(arrow.fromId) : undefined;
  const toEl = arrow.toId ? byId.get(arrow.toId) : undefined;
  const fromBox = fromEl ? elementBounds(fromEl) : null;
  const toBox = toEl ? elementBounds(toEl) : null;

  const p2Center = toBox
    ? { x: toBox.x + toBox.w / 2, y: toBox.y + toBox.h / 2 }
    : { x: arrow.x2, y: arrow.y2 };
  const p1Center = fromBox
    ? { x: fromBox.x + fromBox.w / 2, y: fromBox.y + fromBox.h / 2 }
    : { x: arrow.x1, y: arrow.y1 };

  const start = fromBox ? anchorPoint(fromBox, p2Center) : { x: arrow.x1, y: arrow.y1 };
  const end = toBox ? anchorPoint(toBox, p1Center) : { x: arrow.x2, y: arrow.y2 };
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}

function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Экспорт всех элементов доски в автономный SVG-документ
export function exportBoardToSvg(elements: WbElement[], title = 'Доска'): string {
  if (elements.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><title>${escXml(title)}</title><rect width="800" height="500" fill="#fbfaf8"/></svg>`;
  }
  const byId = new Map(elements.map((e) => [e.id, e]));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    const b = elementBounds(el);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  const pad = 40;
  const vx = Math.floor(minX - pad);
  const vy = Math.floor(minY - pad);
  const vw = Math.max(200, Math.ceil(maxX - minX + pad * 2));
  const vh = Math.max(150, Math.ceil(maxY - minY + pad * 2));

  const sorted = [...elements].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
  const body = sorted
    .map((el) => {
      if (el.type === 'section') {
        return `<g><rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="12" fill="${escXml(el.color)}14" stroke="${escXml(el.color)}" stroke-width="1.5" stroke-dasharray="6 4"/><rect x="${el.x + 10}" y="${el.y + 8}" width="${Math.min(el.w - 20, 220)}" height="24" rx="6" fill="${escXml(el.color)}"/><text x="${el.x + 20}" y="${el.y + 24}" font-family="sans-serif" font-size="12" font-weight="600" fill="#fff">${escXml(el.title)}</text></g>`;
      }
      if (el.type === 'sticky') {
        return `<g><rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="8" fill="${escXml(el.color)}" stroke="rgba(0,0,0,0.08)"/><text x="${el.x + 12}" y="${el.y + 26}" font-family="sans-serif" font-size="13" fill="#1d1c1a">${escXml(el.text)}</text></g>`;
      }
      if (el.type === 'shape') {
        const stroke = el.stroke ?? '#94a3b8';
        const shapeSvg =
          el.kind === 'ellipse'
            ? `<ellipse cx="${el.x + el.w / 2}" cy="${el.y + el.h / 2}" rx="${el.w / 2}" ry="${el.h / 2}" fill="${escXml(el.fill)}" stroke="${escXml(stroke)}" stroke-width="1.5"/>`
            : `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="10" fill="${escXml(el.fill)}" stroke="${escXml(stroke)}" stroke-width="1.5"/>`;
        const txt = el.text
          ? `<text x="${el.x + el.w / 2}" y="${el.y + el.h / 2 + 4}" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#1d1c1a">${escXml(el.text)}</text>`
          : '';
        return `<g>${shapeSvg}${txt}</g>`;
      }
      if (el.type === 'text') {
        const fs = el.fontSize ?? 16;
        return `<text x="${el.x + 4}" y="${el.y + fs + 4}" font-family="sans-serif" font-size="${fs}" font-weight="600" fill="${escXml(el.color ?? '#1d1c1a')}">${escXml(el.text)}</text>`;
      }
      if (el.type === 'erp_card') {
        return `<g><rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="10" fill="#ffffff" stroke="#dad7d0" stroke-width="1.5"/><text x="${el.x + 12}" y="${el.y + 22}" font-family="sans-serif" font-size="11" font-weight="600" fill="#4b5bd6">${escXml(el.entityType.toUpperCase())}</text><text x="${el.x + 12}" y="${el.y + 44}" font-family="sans-serif" font-size="13" font-weight="600" fill="#1d1c1a">${escXml(el.title)}</text></g>`;
      }
      if (el.type === 'freehand') {
        return `<path d="${smoothSvgPath(el.points)}" fill="none" stroke="${escXml(el.color)}" stroke-width="${el.width ?? 2.5}" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
      const { x1, y1, x2, y2 } = resolveArrowEndpoints(el, byId);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${escXml(el.color ?? '#475569')}" stroke-width="2" marker-end="url(#wb-arrow-head)"/>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}" viewBox="${vx} ${vy} ${vw} ${vh}"><title>${escXml(title)}</title><defs><marker id="wb-arrow-head" markerWidth="10" markerHeight="10" refX="8" refY="3.5" orient="auto"><polygon points="0 0, 9 3.5, 0 7" fill="#475569"/></marker></defs><rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="#fbfaf8"/>${body}</svg>`;
}

export function downloadSvg(svgString: string, filename = 'whiteboard.svg'): void {
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadPng(svgString: string, filename = 'whiteboard.png'): void {
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, img.width * scale);
    canvas.height = Math.max(1, img.height * scale);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((png) => {
        if (!png) return;
        const pngUrl = URL.createObjectURL(png);
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(pngUrl);
      }, 'image/png');
    }
    URL.revokeObjectURL(url);
  };
  img.src = url;
}
