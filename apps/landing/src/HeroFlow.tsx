/* Первый экран, справа: сквозная цепочка одного заказа — шаги загораются по очереди, от звонка до аналитики.
   Играет только в зоне видимости и при видимой вкладке; при prefers-reduced-motion все шаги сразу пройдены. */
import * as React from 'react';
import { ChartNoAxesCombined, Check, Factory, Handshake, Phone, ReceiptText, UserPlus, Wallet } from 'lucide-react';
import { flowSteps, t } from './i18n';

const ICONS = [Phone, UserPlus, Handshake, Factory, ReceiptText, Wallet, ChartNoAxesCombined];
/** Сколько горит шаг, мс; пауза на полностью пройденной цепочке */
const STEP = 1100;
const HOLD = 2600;

export function HeroFlow() {
  const steps = flowSteps();
  const ref = React.useRef<HTMLDivElement>(null);
  const [reduced, setReduced] = React.useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [visible, setVisible] = React.useState(false);
  const [tabShown, setTabShown] = React.useState(true);
  // -1 — ещё ничего не горит; steps.length — пройдено всё
  const [at, setAt] = React.useState(-1);

  React.useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    const io = new IntersectionObserver(([e]) => setVisible(e!.isIntersecting), { threshold: 0.3 });
    io.observe(ref.current!);
    const vis = () => setTabShown(!document.hidden);
    document.addEventListener('visibilitychange', vis);
    return () => (mq.removeEventListener('change', on), io.disconnect(), document.removeEventListener('visibilitychange', vis));
  }, []);

  const playing = visible && tabShown && !reduced;
  React.useEffect(() => {
    if (!playing) return;
    const id = setTimeout(() => setAt(a => (a >= steps.length ? -1 : a + 1)), at >= steps.length ? HOLD : at < 0 ? 500 : STEP);
    return () => clearTimeout(id);
  }, [playing, at, steps.length]);

  const cur = reduced ? steps.length : at;

  // Заливка общей линии — до центра значка текущего шага. Значки меняют размер с анимацией,
  // поэтому центр отслеживаем покадрово, пока идёт переход
  const list = React.useRef<HTMLDivElement>(null);
  const fill = React.useRef<HTMLSpanElement>(null);
  React.useLayoutEffect(() => {
    const ol = list.current;
    if (!ol || !fill.current) return;
    const track = () => {
      const ics = ol.querySelectorAll<HTMLElement>('.l-step-ic');
      const first = ics[0];
      const target = ics[Math.min(cur, ics.length - 1)];
      if (!first || !target || cur < 0) return void (fill.current!.style.height = '0px');
      const top = ol.getBoundingClientRect().top;
      const center = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return r.top + r.height / 2 - top;
      };
      fill.current!.style.top = `${center(first)}px`;
      fill.current!.style.height = `${center(target) - center(first)}px`;
    };
    track();
    if (reduced) return;
    let raf = 0;
    const until = performance.now() + 650;
    const loop = () => {
      track();
      if (performance.now() < until) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [cur, reduced]);
  return (
    <div ref={ref} className="l-flow" role="img" aria-label={`${t('hero.flow.label')}: ${steps.map(s => s[0]).join(', ')}`}>
      <div className="l-flow-h" aria-hidden>
        {t('hero.flow.label')}
      </div>
      <div ref={list} className="l-flow-body" aria-hidden>
        <span ref={fill} className="l-flow-fill" />
        <ol className="l-flow-list">
        {steps.map(([name, what], i) => {
          const Icon = ICONS[i]!;
          const st = i < cur ? 'done' : i === cur ? 'on' : 'off';
          return (
            <li key={name} className={`l-step ${st}`}>
              <span className="l-step-ic">
                <Icon size={16} />
              </span>
              <span className="l-step-t">
                <b>{name}</b>
                <span>{what}</span>
              </span>
              <span className="l-step-ok">{st === 'done' && <Check size={14} />}</span>
            </li>
          );
        })}
        </ol>
      </div>
    </div>
  );
}
