// Главный компонент интерактивной доски: pan/zoom, выделение, drag+snap, ресайз, создание фигур, undo/redo и экспорт
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Circle,
  Frame,
  Hand,
  Maximize2,
  Minus,
  MousePointer2,
  Pen,
  Plus,
  Redo2,
  Square,
  SquarePlus,
  StickyNote,
  Type,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import {
  computeSnap,
  downloadPng,
  downloadSvg,
  elementBounds,
  exportBoardToSvg,
  resolveArrowEndpoints,
  smoothSvgPath,
} from './geometry';
import { ElementView } from './ElementView';
import {
  SECTION_COLORS,
  SHAPE_COLORS,
  STICKY_COLORS,
  STROKE_COLORS,
  type WbArrow,
  type WbBox,
  type WbElement,
  type WbErpCard,
  type WbFreehand,
  type WbSnapGuide,
  type WbSticky,
  type WbTool,
  type WbViewport,
} from './types';
import './whiteboard.css';

export interface WhiteboardCanvasProps {
  elements: WbElement[];
  viewport: WbViewport;
  onChange: (elements: WbElement[]) => void;
  onViewportChange: (vp: WbViewport) => void;
  title?: string;
  readOnly?: boolean;
  onConvertStickyToTask?: (el: WbSticky) => void;
  onToggleTaskCard?: (el: WbErpCard) => void;
  onOpenErpCard?: (el: WbErpCard) => void;
  onAddErpCardClick?: () => void;
}

type HandleDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLES: { dir: HandleDir; left: string; top: string; cursor: string }[] = [
  { dir: 'nw', left: '0%', top: '0%', cursor: 'nwse-resize' },
  { dir: 'n', left: '50%', top: '0%', cursor: 'ns-resize' },
  { dir: 'ne', left: '100%', top: '0%', cursor: 'nesw-resize' },
  { dir: 'e', left: '100%', top: '50%', cursor: 'ew-resize' },
  { dir: 'se', left: '100%', top: '100%', cursor: 'nwse-resize' },
  { dir: 's', left: '50%', top: '100%', cursor: 'ns-resize' },
  { dir: 'sw', left: '0%', top: '100%', cursor: 'nesw-resize' },
  { dir: 'w', left: '0%', top: '50%', cursor: 'ew-resize' },
];

const TOOLS: { id: WbTool; label: string; key: string; icon: LucideIcon }[] = [
  { id: 'select', label: 'Выбор', key: 'V', icon: MousePointer2 },
  { id: 'hand', label: 'Рука', key: 'H', icon: Hand },
  { id: 'sticky', label: 'Стикер', key: 'S', icon: StickyNote },
  { id: 'rect', label: 'Блок', key: 'R', icon: Square },
  { id: 'ellipse', label: 'Круг', key: 'O', icon: Circle },
  { id: 'text', label: 'Текст', key: 'T', icon: Type },
  { id: 'section', label: 'Секция', key: 'F', icon: Frame },
  { id: 'arrow', label: 'Стрелка', key: 'A', icon: ArrowUpRight },
  { id: 'pen', label: 'Перо', key: 'P', icon: Pen },
];

const uid = () => `wb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const clampZoom = (z: number) => Math.min(3, Math.max(0.2, z));

type Interaction =
  | { kind: 'pan'; startX: number; startY: number; origX: number; origY: number }
  | { kind: 'marquee'; startX: number; startY: number }
  | { kind: 'drag'; startX: number; startY: number; ids: string[]; orig: WbElement[]; moved: boolean }
  | { kind: 'resize'; dir: HandleDir; id: string; startX: number; startY: number; box: WbBox; orig: WbElement[]; moved: boolean }
  | { kind: 'createBox'; tool: WbTool; startX: number; startY: number }
  | { kind: 'createArrow'; startX: number; startY: number; fromId?: string }
  | { kind: 'createPen'; points: [number, number][] };

export function WhiteboardCanvas({
  elements,
  viewport,
  onChange,
  onViewportChange,
  title = 'Доска',
  readOnly,
  onConvertStickyToTask,
  onToggleTaskCard,
  onOpenErpCard,
  onAddErpCardClick,
}: WhiteboardCanvasProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [tool, setTool] = useState<WbTool>('select');
  const [spaceDown, setSpaceDown] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [guides, setGuides] = useState<WbSnapGuide[]>([]);
  const [marquee, setMarquee] = useState<WbBox | null>(null);
  const [draft, setDraft] = useState<WbElement | null>(null);

  const elementsRef = useRef(elements);
  elementsRef.current = elements;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const interactionRef = useRef<Interaction | null>(null);
  const historyRef = useRef<{ past: WbElement[][]; future: WbElement[][] }>({ past: [], future: [] });
  const [histTick, setHistTick] = useState(0);

  const pushHistory = useCallback((snapshot: WbElement[]) => {
    const h = historyRef.current;
    h.past = [...h.past.slice(-49), snapshot];
    h.future = [];
    setHistTick((t) => t + 1);
  }, []);

  const commit = useCallback(
    (next: WbElement[]) => {
      pushHistory(elementsRef.current);
      onChange(next);
    },
    [onChange, pushHistory],
  );

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h.past.length === 0) return;
    const prev = h.past[h.past.length - 1];
    h.past = h.past.slice(0, -1);
    h.future = [elementsRef.current, ...h.future.slice(0, 49)];
    setHistTick((t) => t + 1);
    onChange(prev);
  }, [onChange]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (h.future.length === 0) return;
    const next = h.future[0];
    h.future = h.future.slice(1);
    h.past = [...h.past.slice(-49), elementsRef.current];
    setHistTick((t) => t + 1);
    onChange(next);
  }, [onChange]);

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect = rootRef.current?.getBoundingClientRect();
    const vp = viewportRef.current;
    const sx = clientX - (rect?.left ?? 0);
    const sy = clientY - (rect?.top ?? 0);
    return { x: (sx - vp.x) / vp.zoom, y: (sy - vp.y) / vp.zoom };
  }, []);

  const findHitAt = useCallback((wx: number, wy: number) => {
    const list = [...elementsRef.current].sort((a, b) => (b.z ?? 0) - (a.z ?? 0));
    return list.find((el) => {
      if (el.type === 'arrow' || el.type === 'freehand') return false;
      const b = elementBounds(el);
      return wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h;
    });
  }, []);

  const fitToContent = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    const list = elementsRef.current;
    if (!rect || list.length === 0) {
      onViewportChange({ x: 0, y: 0, zoom: 1 });
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of list) {
      const b = elementBounds(el);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }
    const pad = 64;
    const cw = Math.max(100, maxX - minX);
    const ch = Math.max(100, maxY - minY);
    const zoom = clampZoom(Math.min((rect.width - pad * 2) / cw, (rect.height - pad * 2) / ch, 1.25));
    onViewportChange({
      zoom,
      x: (rect.width - cw * zoom) / 2 - minX * zoom,
      y: (rect.height - ch * zoom) / 2 - minY * zoom,
    });
  }, [onViewportChange]);

  const deleteSelected = useCallback(() => {
    if (readOnly || selectedIds.length === 0) return;
    const set = new Set(selectedIds);
    commit(elementsRef.current.filter((e) => !set.has(e.id)));
    setSelectedIds([]);
  }, [commit, readOnly, selectedIds]);

  const duplicateSelected = useCallback(() => {
    if (readOnly || selectedIds.length === 0) return;
    const set = new Set(selectedIds);
    const clones: WbElement[] = [];
    for (const el of elementsRef.current) {
      if (!set.has(el.id)) continue;
      const id = uid();
      if (el.type === 'arrow') {
        clones.push({ ...el, id, fromId: undefined, toId: undefined, x1: el.x1 + 24, y1: el.y1 + 24, x2: el.x2 + 24, y2: el.y2 + 24 });
      } else if (el.type === 'freehand') {
        clones.push({ ...el, id, points: el.points.map(([px, py]) => [px + 24, py + 24]) });
      } else {
        clones.push({ ...el, id, x: el.x + 24, y: el.y + 24 });
      }
    }
    commit([...elementsRef.current, ...clones]);
    setSelectedIds(clones.map((c) => c.id));
  }, [commit, readOnly, selectedIds]);

  const reorderSelected = useCallback(
    (dir: 'front' | 'back') => {
      if (readOnly || selectedIds.length === 0) return;
      const set = new Set(selectedIds);
      const zs = elementsRef.current.map((e) => e.z ?? 0);
      const edge = dir === 'front' ? Math.max(0, ...zs) + 1 : Math.min(0, ...zs) - 1;
      commit(elementsRef.current.map((e) => (set.has(e.id) ? { ...e, z: edge } : e)));
    },
    [commit, readOnly, selectedIds],
  );

  const applyColor = useCallback(
    (color: string) => {
      if (readOnly || selectedIds.length === 0) return;
      const set = new Set(selectedIds);
      commit(
        elementsRef.current.map((el) => {
          if (!set.has(el.id)) return el;
          if (el.type === 'shape') return { ...el, fill: color };
          if (el.type === 'sticky' || el.type === 'section' || el.type === 'freehand') return { ...el, color };
          if (el.type === 'text' || el.type === 'arrow' || el.type === 'erp_card') return { ...el, color };
          return el;
        }),
      );
    },
    [commit, readOnly, selectedIds],
  );

  // Зум колесом мыши относительно курсора (passive: false)
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = node.getBoundingClientRect();
      const vp = viewportRef.current;
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.09 : 1 / 1.09;
      const nextZoom = clampZoom(vp.zoom * factor);
      const scale = nextZoom / vp.zoom;
      onViewportChange({
        zoom: nextZoom,
        x: sx - (sx - vp.x) * scale,
        y: sy - (sy - vp.y) * scale,
      });
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [onViewportChange]);

  // Горячие клавиши: Space, Undo/Redo, Duplicate, Delete, инструменты
  useEffect(() => {
    const isInput = () => {
      const tag = document.activeElement?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA';
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isInput()) return;
      if (e.code === 'Space') { e.preventDefault(); setSpaceDown(true); return; }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
      if (!mod && !e.altKey) {
        const found = TOOLS.find((t) => t.key.toLowerCase() === e.key.toLowerCase());
        if (found) setTool(found.id);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [deleteSelected, duplicateSelected, redo, undo]);

  const buildBoxElement = useCallback((t: WbTool, box: WbBox): WbElement | null => {
    const z = Math.max(0, ...elementsRef.current.map((e) => e.z ?? 0)) + 1;
    const id = uid();
    if (t === 'sticky') return { id, type: 'sticky', ...box, text: '', color: STICKY_COLORS[0], z };
    if (t === 'rect') return { id, type: 'shape', kind: 'rect', ...box, text: '', fill: SHAPE_COLORS[0], stroke: '#94a3b8', z };
    if (t === 'ellipse') return { id, type: 'shape', kind: 'ellipse', ...box, text: '', fill: SHAPE_COLORS[2], stroke: '#60a5fa', z };
    if (t === 'text') return { id, type: 'text', ...box, text: 'Заголовок', fontSize: 18, color: '#1d1c1a', z };
    if (t === 'section') return { id, type: 'section', ...box, title: 'Новая секция', color: SECTION_COLORS[1], z: 0 };
    return null;
  }, []);

  // Глобальный цикл перетаскивания, ресайза, рамки выделения и рисования
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const inter = interactionRef.current;
      if (!inter) return;
      if (inter.kind === 'pan') {
        onViewportChange({
          ...viewportRef.current,
          x: inter.origX + (e.clientX - inter.startX),
          y: inter.origY + (e.clientY - inter.startY),
        });
        return;
      }
      const w = toWorld(e.clientX, e.clientY);
      if (inter.kind === 'marquee') {
        setMarquee({
          x: Math.min(inter.startX, w.x),
          y: Math.min(inter.startY, w.y),
          w: Math.abs(w.x - inter.startX),
          h: Math.abs(w.y - inter.startY),
        });
        return;
      }
      if (inter.kind === 'drag') {
        const rawDx = w.x - inter.startX;
        const rawDy = w.y - inter.startY;
        if (Math.abs(rawDx) > 1 || Math.abs(rawDy) > 1) inter.moved = true;
        const selSet = new Set(inter.ids);
        const movingBoxes = inter.orig.filter((el) => selSet.has(el.id)).map(elementBounds);
        const otherBoxes = inter.orig.filter((el) => !selSet.has(el.id) && el.type !== 'arrow').map(elementBounds);
        let snapDx = 0, snapDy = 0;
        if (movingBoxes.length > 0 && otherBoxes.length > 0) {
          const union: WbBox = {
            x: Math.min(...movingBoxes.map((b) => b.x)) + rawDx,
            y: Math.min(...movingBoxes.map((b) => b.y)) + rawDy,
            w: Math.max(...movingBoxes.map((b) => b.x + b.w)) - Math.min(...movingBoxes.map((b) => b.x)),
            h: Math.max(...movingBoxes.map((b) => b.y + b.h)) - Math.min(...movingBoxes.map((b) => b.y)),
          };
          const snap = computeSnap(union, otherBoxes, 6 / viewportRef.current.zoom);
          snapDx = snap.dx;
          snapDy = snap.dy;
          setGuides(snap.guides);
        }
        const dx = rawDx + snapDx;
        const dy = rawDy + snapDy;
        onChange(
          inter.orig.map((el) => {
            if (!selSet.has(el.id)) return el;
            if (el.type === 'arrow') {
              return { ...el, x1: el.x1 + dx, y1: el.y1 + dy, x2: el.x2 + dx, y2: el.y2 + dy };
            }
            if (el.type === 'freehand') {
              return { ...el, points: el.points.map(([px, py]) => [px + dx, py + dy] as [number, number]) };
            }
            return { ...el, x: el.x + dx, y: el.y + dy };
          }),
        );
        return;
      }
      if (inter.kind === 'resize') {
        const dx = w.x - inter.startX;
        const dy = w.y - inter.startY;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) inter.moved = true;
        const target = inter.orig.find((el) => el.id === inter.id);
        const minW = target?.type === 'section' ? 160 : 48;
        const minH = target?.type === 'section' ? 100 : 34;
        let { x, y, w: bw, h: bh } = inter.box;
        if (inter.dir.includes('e')) bw = Math.max(minW, inter.box.w + dx);
        if (inter.dir.includes('s')) bh = Math.max(minH, inter.box.h + dy);
        if (inter.dir.includes('w')) {
          const nw = Math.max(minW, inter.box.w - dx);
          x = inter.box.x + (inter.box.w - nw);
          bw = nw;
        }
        if (inter.dir.includes('n')) {
          const nh = Math.max(minH, inter.box.h - dy);
          y = inter.box.y + (inter.box.h - nh);
          bh = nh;
        }
        onChange(
          inter.orig.map((el) => (el.id === inter.id && el.type !== 'arrow' && el.type !== 'freehand' ? { ...el, x, y, w: bw, h: bh } : el)),
        );
        return;
      }
      if (inter.kind === 'createBox') {
        const box = {
          x: Math.min(inter.startX, w.x),
          y: Math.min(inter.startY, w.y),
          w: Math.max(12, Math.abs(w.x - inter.startX)),
          h: Math.max(12, Math.abs(w.y - inter.startY)),
        };
        setDraft(buildBoxElement(inter.tool, box));
        return;
      }
      if (inter.kind === 'createArrow') {
        setDraft({ id: 'draft', type: 'arrow', x1: inter.startX, y1: inter.startY, x2: w.x, y2: w.y, fromId: inter.fromId, color: '#475569' });
        return;
      }
      if (inter.kind === 'createPen') {
        inter.points.push([w.x, w.y]);
        setDraft({ id: 'draft', type: 'freehand', points: [...inter.points], color: '#1e293b', width: 2.5 });
      }
    };

    const onUp = (e: PointerEvent) => {
      const inter = interactionRef.current;
      if (!inter) return;
      interactionRef.current = null;
      setGuides([]);
      const w = toWorld(e.clientX, e.clientY);

      if (inter.kind === 'marquee') {
        const box: WbBox = {
          x: Math.min(inter.startX, w.x),
          y: Math.min(inter.startY, w.y),
          w: Math.abs(w.x - inter.startX),
          h: Math.abs(w.y - inter.startY),
        };
        setMarquee(null);
        if (box.w > 4 || box.h > 4) {
          const hits = elementsRef.current.filter((el) => {
            const b = elementBounds(el);
            return b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y;
          });
          setSelectedIds(hits.map((h) => h.id));
        }
        return;
      }
      if ((inter.kind === 'drag' || inter.kind === 'resize') && inter.moved) {
        pushHistory(inter.orig);
        return;
      }
      if (inter.kind === 'createBox') {
        const dragged = Math.abs(w.x - inter.startX) > 12 || Math.abs(w.y - inter.startY) > 12;
        const defaults: Record<string, [number, number]> = { sticky: [190, 140], rect: [170, 100], ellipse: [150, 110], text: [200, 44], section: [340, 240] };
        const [dw, dh] = defaults[inter.tool] ?? [160, 100];
        const box: WbBox = dragged
          ? { x: Math.min(inter.startX, w.x), y: Math.min(inter.startY, w.y), w: Math.max(40, Math.abs(w.x - inter.startX)), h: Math.max(32, Math.abs(w.y - inter.startY)) }
          : { x: inter.startX - dw / 2, y: inter.startY - dh / 2, w: dw, h: dh };
        const created = buildBoxElement(inter.tool, box);
        setDraft(null);
        if (created) {
          commit([...elementsRef.current, created]);
          setSelectedIds([created.id]);
          setTool('select');
        }
        return;
      }
      if (inter.kind === 'createArrow') {
        setDraft(null);
        if (Math.hypot(w.x - inter.startX, w.y - inter.startY) > 10) {
          const toHit = findHitAt(w.x, w.y);
          const arrow: WbArrow = {
            id: uid(),
            type: 'arrow',
            x1: inter.startX,
            y1: inter.startY,
            x2: w.x,
            y2: w.y,
            fromId: inter.fromId,
            toId: toHit && toHit.id !== inter.fromId ? toHit.id : undefined,
            color: '#475569',
            z: 5,
          };
          commit([...elementsRef.current, arrow]);
          setSelectedIds([arrow.id]);
          setTool('select');
        }
        return;
      }
      if (inter.kind === 'createPen') {
        setDraft(null);
        if (inter.points.length > 1) {
          const fh: WbFreehand = { id: uid(), type: 'freehand', points: inter.points, color: '#1e293b', width: 2.5, z: 6 };
          commit([...elementsRef.current, fh]);
          setSelectedIds([fh.id]);
        }
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [buildBoxElement, commit, findHitAt, onChange, onViewportChange, pushHistory, toWorld]);

  const onViewportPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || tool === 'hand' || spaceDown) {
      e.preventDefault();
      interactionRef.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, origX: viewport.x, origY: viewport.y };
      return;
    }
    if (e.button !== 0) return;
    const w = toWorld(e.clientX, e.clientY);
    if (readOnly || tool === 'select') {
      if (!e.shiftKey) setSelectedIds([]);
      interactionRef.current = { kind: 'marquee', startX: w.x, startY: w.y };
      return;
    }
    if (tool === 'arrow') {
      const fromHit = findHitAt(w.x, w.y);
      interactionRef.current = { kind: 'createArrow', startX: w.x, startY: w.y, fromId: fromHit?.id };
      return;
    }
    if (tool === 'pen') {
      interactionRef.current = { kind: 'createPen', points: [[w.x, w.y]] };
      return;
    }
    interactionRef.current = { kind: 'createBox', tool, startX: w.x, startY: w.y };
  };

  const onElementPointerDown = (e: React.PointerEvent, el: WbElement) => {
    if (e.button === 1 || tool === 'hand' || spaceDown) {
      e.stopPropagation();
      interactionRef.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, origX: viewport.x, origY: viewport.y };
      return;
    }
    e.stopPropagation();
    const w = toWorld(e.clientX, e.clientY);
    if (!readOnly && tool === 'arrow') {
      interactionRef.current = { kind: 'createArrow', startX: w.x, startY: w.y, fromId: el.id };
      return;
    }
    const nextSel = e.shiftKey
      ? selectedIds.includes(el.id) ? selectedIds.filter((id) => id !== el.id) : [...selectedIds, el.id]
      : selectedIds.includes(el.id) ? selectedIds : [el.id];
    setSelectedIds(nextSel);
    if (readOnly) return;
    interactionRef.current = { kind: 'drag', startX: w.x, startY: w.y, ids: nextSel, orig: elementsRef.current, moved: false };
  };

  const onHandlePointerDown = (e: React.PointerEvent, dir: HandleDir, box: WbBox, id: string) => {
    if (readOnly) return;
    e.stopPropagation();
    const w = toWorld(e.clientX, e.clientY);
    interactionRef.current = { kind: 'resize', dir, id, startX: w.x, startY: w.y, box, orig: elementsRef.current, moved: false };
  };

  const updateText = useCallback(
    (id: string, text: string) => {
      commit(
        elementsRef.current.map((el) => {
          if (el.id !== id) return el;
          if (el.type === 'section') return { ...el, title: text };
          if (el.type === 'sticky' || el.type === 'shape' || el.type === 'text') return { ...el, text };
          return el;
        }),
      );
    },
    [commit],
  );

  const byId = useMemo(() => new Map(elements.map((e) => [e.id, e])), [elements]);
  const domElements = useMemo(
    () =>
      [...elements, ...(draft && draft.type !== 'arrow' && draft.type !== 'freehand' ? [draft] : [])]
        .filter((e) => e.type !== 'arrow' && e.type !== 'freehand')
        .sort((a, b) => (a.z ?? 0) - (b.z ?? 0)),
    [elements, draft],
  );
  const svgElements = useMemo(
    () => [
      ...elements.filter((e): e is WbArrow | WbFreehand => e.type === 'arrow' || e.type === 'freehand'),
      ...(draft && (draft.type === 'arrow' || draft.type === 'freehand') ? [draft] : []),
    ],
    [elements, draft],
  );

  const singleEl = selectedIds.length === 1 ? byId.get(selectedIds[0]) : undefined;
  const singleBox = singleEl && singleEl.type !== 'arrow' && singleEl.type !== 'freehand' ? elementBounds(singleEl) : null;
  const firstSel = selectedIds.length > 0 ? byId.get(selectedIds[0]) : undefined;
  const palette =
    firstSel?.type === 'sticky' ? STICKY_COLORS
    : firstSel?.type === 'shape' ? SHAPE_COLORS
    : firstSel?.type === 'section' ? SECTION_COLORS
    : STROKE_COLORS;
  const canUndo = histTick >= 0 && historyRef.current.past.length > 0;
  const canRedo = histTick >= 0 && historyRef.current.future.length > 0;

  return (
    <div
      ref={rootRef}
      className="wb-root"
      style={{
        cursor: spaceDown || tool === 'hand' ? 'grab' : tool === 'select' ? 'default' : 'crosshair',
        ['--wb-dot-size' as string]: `${24 * viewport.zoom}px`,
        ['--wb-dot-x' as string]: `${viewport.x}px`,
        ['--wb-dot-y' as string]: `${viewport.y}px`,
      }}
    >
      <div className="wb-viewport" onPointerDown={onViewportPointerDown}>
        <div className="wb-world" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}>
          {domElements.map((el) => (
            <ElementView
              key={el.id}
              element={el}
              selected={selectedIds.includes(el.id)}
              readOnly={readOnly}
              onPointerDown={onElementPointerDown}
              onUpdateText={updateText}
              onConvertStickyToTask={onConvertStickyToTask}
              onToggleTaskCard={onToggleTaskCard}
              onOpenErpCard={onOpenErpCard}
            />
          ))}

          <svg className="wb-svg-layer" width="1" height="1">
            <defs>
              <marker id="wb-head" markerWidth="10" markerHeight="10" refX="8" refY="3.5" orient="auto">
                <polygon points="0 0, 9 3.5, 0 7" fill="context-stroke" />
              </marker>
            </defs>
            {svgElements.map((el) => {
              const sel = selectedIds.includes(el.id);
              if (el.type === 'freehand') {
                const d = smoothSvgPath(el.points);
                return (
                  <g key={el.id} onPointerDown={(e) => onElementPointerDown(e, el)}>
                    <path d={d} fill="none" stroke="transparent" strokeWidth={14} className="wb-svg-hit" />
                    <path d={d} fill="none" stroke={sel ? 'var(--accent, #4b5bd6)' : el.color} strokeWidth={el.width ?? 2.5} strokeLinecap="round" strokeLinejoin="round" />
                  </g>
                );
              }
              const { x1, y1, x2, y2 } = resolveArrowEndpoints(el, byId);
              const color = sel ? 'var(--accent, #4b5bd6)' : (el.color ?? '#475569');
              return (
                <g key={el.id} onPointerDown={(e) => onElementPointerDown(e, el)}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={14} className="wb-svg-hit" />
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={2} markerEnd="url(#wb-head)" />
                </g>
              );
            })}
          </svg>

          {singleBox && !readOnly && (
            <div className="wb-selection-box" style={{ left: singleBox.x, top: singleBox.y, width: singleBox.w, height: singleBox.h, zIndex: 999 }}>
              {HANDLES.map((h) => (
                <div
                  key={h.dir}
                  className="wb-handle"
                  style={{ left: h.left, top: h.top, cursor: h.cursor }}
                  onPointerDown={(e) => onHandlePointerDown(e, h.dir, singleBox, singleEl!.id)}
                />
              ))}
            </div>
          )}

          {marquee && <div className="wb-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h, zIndex: 1000 }} />}
          {guides.map((g, idx) => (
            <div key={idx} className={`wb-guide wb-guide-${g.axis}`} style={g.axis === 'x' ? { left: g.pos } : { top: g.pos }} />
          ))}
        </div>
      </div>

      {!readOnly && selectedIds.length > 0 && (
        <div className="wb-props-bar" onPointerDown={(e) => e.stopPropagation()}>
          {palette.map((c) => (
            <button key={c} type="button" className="wb-swatch" style={{ background: c }} title="Цвет" onClick={() => applyColor(c)} />
          ))}
          <div className="wb-divider" />
          <button type="button" className="wb-tool-btn" onClick={() => reorderSelected('front')} title="На передний план">↑ Вперёд</button>
          <button type="button" className="wb-tool-btn" onClick={() => reorderSelected('back')} title="На задний план">↓ Назад</button>
          <button type="button" className="wb-tool-btn" onClick={duplicateSelected} title="Дублировать (⌘D)">Копия</button>
          <button type="button" className="wb-tool-btn" onClick={deleteSelected} title="Удалить (Del)">Удалить</button>
        </div>
      )}

      {!readOnly && (
        <div className="wb-dock" onPointerDown={(e) => e.stopPropagation()}>
          {TOOLS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                className={`wb-tool-btn wb-icon-btn${tool === t.id ? ' is-active' : ''}`}
                onClick={() => setTool(t.id)}
                title={`${t.label} (${t.key})`}
                aria-label={t.label}
              >
                <Icon size={17} strokeWidth={1.8} />
              </button>
            );
          })}
          <div className="wb-divider" />
          <button type="button" className="wb-tool-btn wb-icon-btn" disabled={!canUndo} onClick={undo} title="Отменить (⌘Z)" aria-label="Отменить">
            <Undo2 size={17} strokeWidth={1.8} />
          </button>
          <button type="button" className="wb-tool-btn wb-icon-btn" disabled={!canRedo} onClick={redo} title="Повторить (⌘⇧Z)" aria-label="Повторить">
            <Redo2 size={17} strokeWidth={1.8} />
          </button>
          {onAddErpCardClick && (
            <>
              <div className="wb-divider" />
              <button type="button" className="wb-tool-btn wb-icon-btn" onClick={onAddErpCardClick} title="Добавить ERP-карточку" aria-label="Добавить ERP-карточку">
                <SquarePlus size={17} strokeWidth={1.8} />
              </button>
            </>
          )}
        </div>
      )}

      <div className="wb-zoom-bar" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" className="wb-tool-btn wb-icon-btn" onClick={() => onViewportChange({ ...viewport, zoom: clampZoom(viewport.zoom - 0.15) })} title="Уменьшить" aria-label="Уменьшить">
          <Minus size={15} />
        </button>
        <span style={{ fontSize: 12, minWidth: 42, textAlign: 'center' }}>{Math.round(viewport.zoom * 100)}%</span>
        <button type="button" className="wb-tool-btn wb-icon-btn" onClick={() => onViewportChange({ ...viewport, zoom: clampZoom(viewport.zoom + 0.15) })} title="Увеличить" aria-label="Увеличить">
          <Plus size={15} />
        </button>
        <button type="button" className="wb-tool-btn wb-icon-btn" onClick={fitToContent} title="Вписать содержимое" aria-label="Вписать содержимое">
          <Maximize2 size={15} />
        </button>
        <div className="wb-divider" />
        <button type="button" className="wb-tool-btn" onClick={() => downloadSvg(exportBoardToSvg(elements, title), `${title}.svg`)}>SVG</button>
        <button type="button" className="wb-tool-btn" onClick={() => downloadPng(exportBoardToSvg(elements, title), `${title}.png`)}>PNG</button>
      </div>
    </div>
  );
}
