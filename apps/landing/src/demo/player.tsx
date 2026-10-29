/* «Запись экрана» модуля: сцена из разметки настоящего интерфейса, которую ведёт сценарий.
   Сценарий — async-функция: курсор едет к элементу data-demo="…", кликает, печатает, меняет состояние сцены.
   Кадр рисуется в ширину контейнера (текст 1:1), а уже минимальной ширины — масштабируется; координаты курсора — в системе кадра.
   Играет только в зоне видимости и при видимой вкладке, у записи есть пауза; при prefers-reduced-motion — сразу конечное состояние. */
import * as React from 'react';
import { Pause, Play } from 'lucide-react';
import { t } from '../i18n';

export interface Cursor {
  x: number;
  y: number;
  /** Длительность перемещения, мс — та же у «призрака» перетаскиваемой карточки */
  dur: number;
  down: boolean;
  shown: boolean;
}

export interface Api<S> {
  set: (fn: (s: S) => S) => void;
  wait: (ms: number) => Promise<void>;
  /** Курсор к элементу data-demo; ax/ay — точка внутри элемента в долях (0.5 — центр) */
  move: (target: string, o?: { ax?: number; ay?: number; dur?: number }) => Promise<void>;
  click: () => Promise<void>;
  /** Печать по символу: put получает уже набранную часть строки */
  type: (text: string, put: (s: S, v: string) => S, speed?: number) => Promise<void>;
}

export interface SceneCtx {
  compact: boolean;
  cursor: Cursor;
}

export interface Scene<S> {
  initial: S;
  /** Конечное состояние — его видят при prefers-reduced-motion */
  final: S;
  script: (api: Api<S>) => Promise<void>;
  render: (s: S, ctx: SceneCtx) => React.ReactNode;
  /** Высота кадра: обычная и узкая (без боковой панели) */
  height: [number, number];
}

const ABORT = Symbol('abort');
const WIDE = 1280;
/** Минимальная ширина узкого кадра; уже — кадр масштабируется */
const NARROW = 560;
/** Уже этой ширины контейнера кадр перестраивается в узкий — без боковой панели */
const NARROW_BELOW = 960;

function useReducedMotion() {
  const [reduced, setReduced] = React.useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  React.useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

export function Recording<S>({ scene, label, caption }: { scene: Scene<S>; label: string; caption: string }) {
  const reduced = useReducedMotion();
  const outer = React.useRef<HTMLDivElement>(null);
  const stage = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(0);
  const [state, setState] = React.useState<S>(reduced ? scene.final : scene.initial);
  const [cursor, setCursor] = React.useState<Cursor>({ x: 0, y: 0, dur: 0, down: false, shown: false });
  const [userPaused, setUserPaused] = React.useState(false);
  const [visible, setVisible] = React.useState(false);
  const [tabShown, setTabShown] = React.useState(true);
  const playing = visible && tabShown && !userPaused && !reduced;
  const playingRef = React.useRef(playing);
  playingRef.current = playing;

  const compact = width > 0 && width < NARROW_BELOW;
  const designW = width ? Math.min(WIDE, Math.max(compact ? NARROW : NARROW_BELOW, width)) : WIDE;
  const scale = width ? width / designW : 1;
  const h = scene.height[compact ? 1 : 0];

  React.useLayoutEffect(() => {
    const el = outer.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  React.useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e!.isIntersecting), { threshold: 0.35 });
    io.observe(outer.current!);
    const vis = () => setTabShown(!document.hidden);
    document.addEventListener('visibilitychange', vis);
    return () => (io.disconnect(), document.removeEventListener('visibilitychange', vis));
  }, []);

  React.useEffect(() => {
    if (reduced) {
      setState(scene.final);
      setCursor(c => ({ ...c, shown: false }));
      return;
    }
    let aborted = false;
    const wait = (ms: number) =>
      new Promise<void>((res, rej) => {
        let left = ms;
        let last = performance.now();
        const tick = (now: number) => {
          if (aborted) return rej(ABORT);
          // На паузе время сценария стоит
          if (playingRef.current) {
            const d = Math.min(now - last, 100);
            left -= d;
          }
          last = now;
          if (left <= 0) res();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    const pos = (target: string, ax = 0.5, ay = 0.5) => {
      const el = stage.current?.querySelector<HTMLElement>(`[data-demo="${target}"]`);
      const st = stage.current;
      if (!el || !st) return null;
      const r = el.getBoundingClientRect();
      const s = st.getBoundingClientRect();
      // getBoundingClientRect отдаёт размеры после transform: scale — переводим в координаты кадра
      const k = s.width / st.offsetWidth || 1;
      return { x: (r.left + r.width * ax - s.left) / k, y: (r.top + r.height * ay - s.top) / k };
    };
    let cur = { x: 0, y: 0 };
    const api: Api<S> = {
      set: fn => !aborted && setState(fn),
      wait,
      move: async (target, o = {}) => {
        const p = pos(target, o.ax, o.ay);
        if (!p) return;
        const dist = Math.hypot(p.x - cur.x, p.y - cur.y);
        const dur = o.dur ?? Math.round(Math.min(900, Math.max(320, dist * 0.9)));
        cur = p;
        setCursor(c => ({ ...c, ...p, dur, shown: true }));
        await wait(dur + 60);
      },
      click: async () => {
        setCursor(c => ({ ...c, down: true }));
        await wait(140);
        setCursor(c => ({ ...c, down: false }));
        await wait(120);
      },
      type: async (text, put, speed = 55) => {
        for (let i = 1; i <= text.length; i++) {
          const v = text.slice(0, i);
          api.set(s => put(s, v));
          await wait(speed + (text[i - 1] === ' ' ? 40 : (i * 7) % 30));
        }
      },
    };
    (async () => {
      try {
        for (;;) {
          setState(scene.initial);
          const start = { x: designW * 0.62, y: h * 0.78 };
          cur = start;
          setCursor({ ...start, dur: 0, down: false, shown: true });
          await wait(700);
          await scene.script(api);
          await wait(2800);
          setCursor(c => ({ ...c, shown: false }));
          await wait(400);
        }
      } catch (e) {
        if (e !== ABORT) throw e;
      }
    })();
    return () => {
      aborted = true;
    };
    // Перезапуск при смене режима: узкий кадр — другая раскладка, координаты прежнего прогона не годятся
  }, [scene, reduced, compact]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <figure className="rec" aria-label={label}>
      <div ref={outer} className="rec-frame" style={{ height: h * scale }}>
        <div
          ref={stage}
          className={'stage' + (compact ? ' compact' : '')}
          style={{ width: designW, height: h, transform: `scale(${scale})` }}
          inert
          aria-hidden
        >
          {scene.render(state, { compact, cursor })}
          {!reduced && (
            <div
              className={'cursor' + (cursor.down ? ' down' : '') + (cursor.shown ? '' : ' gone')}
              style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)`, transitionDuration: `${cursor.dur}ms, 200ms` }}
            >
              <svg width="20" height="22" viewBox="0 0 20 22" aria-hidden>
                <path d="M2 1.5 17 12l-6.6 1.2L13.8 20l-3 1.3-3.3-6.9L2 18.8z" fill="#151514" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
              </svg>
              <span className="ring" />
            </div>
          )}
        </div>
      </div>
      <figcaption className="rec-bar">
        {!reduced && (
          <button type="button" className="rec-btn" onClick={() => setUserPaused(p => !p)} aria-label={userPaused ? t('player.play') : t('player.pause')}>
            {userPaused ? <Play size={13} /> : <Pause size={13} />}
          </button>
        )}
        <span className="rec-cap">{caption}</span>
      </figcaption>
    </figure>
  );
}
