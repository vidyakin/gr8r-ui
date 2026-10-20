/* FloatingWindow — немодальное окно поверх страницы: тянется за шапку, меняет размер за правый нижний угол.
   Геометрия управляется снаружи (x, y, w, h); во время жеста окно держит её у себя и сообщает наверх только по его окончании,
   поэтому содержимое не перерисовывается на каждое движение. На узком экране (≤640px) окно — лист снизу без перетаскивания. */
import * as React from 'react';
import { cn } from '@/lib/utils';

export interface WindowGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const WINDOW_MIN = { w: 360, h: 280 };
const SHEET_QUERY = '(max-width: 640px)';

/** Геометрия, вписанная в экран: размер не меньше минимума (если экран позволяет), окно целиком на экране */
export function clampGeometry(g: WindowGeometry, vw = window.innerWidth, vh = window.innerHeight): WindowGeometry {
  const w = Math.min(Math.max(g.w, WINDOW_MIN.w), vw);
  const h = Math.min(Math.max(g.h, WINDOW_MIN.h), vh);
  return { w, h, x: Math.min(Math.max(g.x, 0), vw - w), y: Math.min(Math.max(g.y, 0), vh - h) };
}

export function useIsSheet() {
  const [sheet, setSheet] = React.useState(() => window.matchMedia(SHEET_QUERY).matches);
  React.useEffect(() => {
    const mq = window.matchMedia(SHEET_QUERY);
    const on = () => setSheet(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return sheet;
}

export interface FloatingWindowProps {
  /** Подпись окна для скринридеров */
  label: string;
  /** Заголовок в шапке */
  title: React.ReactNode;
  /** Кнопки справа в шапке */
  actions?: React.ReactNode;
  geometry: WindowGeometry;
  onGeometryChange: (g: WindowGeometry) => void;
  /** Клик или фокус внутри окна — поднять его наверх */
  onRaise?: () => void;
  /** Двойной клик по шапке — вернуть размер и позицию по умолчанию */
  onReset?: () => void;
  /** z-index внутри слоя окон */
  zIndex?: number;
  className?: string;
  children: React.ReactNode;
}

type Gesture = { kind: 'move' | 'size'; px: number; py: number; start: WindowGeometry };

export const FloatingWindow = React.forwardRef<HTMLElement, FloatingWindowProps>(function FloatingWindow(
  { label, title, actions, geometry, onGeometryChange, onRaise, onReset, zIndex, className, children },
  ref,
) {
  const sheet = useIsSheet();
  const [live, setLive] = React.useState<WindowGeometry | null>(null);
  const gesture = React.useRef<Gesture | null>(null);
  const g = live ?? clampGeometry(geometry);

  const begin = (kind: Gesture['kind']) => (e: React.PointerEvent<HTMLElement>) => {
    if (sheet || e.button > 0 || (kind === 'move' && (e.target as HTMLElement).closest('button, a, input'))) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { kind, px: e.clientX, py: e.clientY, start: g };
    if (kind === 'size') e.stopPropagation();
  };
  const step = (e: React.PointerEvent) => {
    const s = gesture.current;
    if (!s) return;
    const dx = e.clientX - s.px;
    const dy = e.clientY - s.py;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (s.kind === 'move') {
      setLive({ ...s.start, x: Math.min(Math.max(s.start.x + dx, 0), vw - s.start.w), y: Math.min(Math.max(s.start.y + dy, 0), vh - s.start.h) });
    } else {
      const w = Math.min(Math.max(s.start.w + dx, WINDOW_MIN.w), vw - s.start.x);
      const h = Math.min(Math.max(s.start.h + dy, WINDOW_MIN.h), vh - s.start.y);
      setLive({ ...s.start, w, h });
    }
  };
  const end = () => {
    if (!gesture.current) return;
    gesture.current = null;
    if (live) onGeometryChange(live);
    setLive(null);
  };

  // Клавиатура: стрелки на шапке двигают окно, Shift+стрелки меняют размер
  const onHeadKey = (e: React.KeyboardEvent) => {
    if (sheet || e.target !== e.currentTarget) return;
    const d = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[e.key];
    if (!d) return;
    e.preventDefault();
    const k = e.altKey || e.ctrlKey || e.metaKey ? 1 : 24;
    onGeometryChange(clampGeometry(e.shiftKey ? { ...g, w: g.w + d[0] * k, h: g.h + d[1] * k } : { ...g, x: g.x + d[0] * k, y: g.y + d[1] * k }));
  };

  // При сужении окна браузера возвращаем окно в экран
  React.useEffect(() => {
    if (sheet) return;
    const on = () => {
      const c = clampGeometry(geometry);
      if (c.x !== geometry.x || c.y !== geometry.y || c.w !== geometry.w || c.h !== geometry.h) onGeometryChange(c);
    };
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [sheet, geometry, onGeometryChange]);

  return (
    <section
      ref={ref}
      className={cn('fwin', sheet && 'sheet', live && 'dragging', className)}
      role="dialog"
      aria-modal="false"
      aria-label={label}
      tabIndex={-1}
      style={sheet ? { zIndex } : { left: g.x, top: g.y, width: g.w, height: g.h, zIndex }}
      onPointerDownCapture={onRaise}
      onFocusCapture={onRaise}
      // Esc внутри окна его не закрывает: закрытие только кнопкой; событие не доходит до глобальных обработчиков карточки
      onKeyDown={e => e.key === 'Escape' && e.stopPropagation()}
    >
      <header
        className="fwin-h"
        tabIndex={sheet ? undefined : 0}
        aria-label={sheet ? undefined : `${label}: move with arrow keys, resize with Shift and arrow keys`}
        onPointerDown={begin('move')}
        onPointerMove={step}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={e => !sheet && !(e.target as HTMLElement).closest('button, a') && onReset?.()}
        onKeyDown={onHeadKey}
      >
        <div className="fwin-t">{title}</div>
        <div className="fwin-acts">{actions}</div>
      </header>
      <div className="fwin-b">{children}</div>
      {!sheet && <div className="fwin-grip" aria-hidden onPointerDown={begin('size')} onPointerMove={step} onPointerUp={end} onPointerCancel={end} />}
    </section>
  );
});
