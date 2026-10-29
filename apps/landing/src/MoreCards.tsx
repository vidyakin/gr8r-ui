/* «Что ещё есть»: модули карточками. Каждые 5 секунд подсвечиваются две другие карточки — чтобы взгляд задерживался на списке.
   Подсветка идёт только в зоне видимости и при видимой вкладке; при prefers-reduced-motion её нет. */
import * as React from 'react';
import { Banknote, CalendarCheck, Package, Tag, TrendingUp, Truck, Wallet, Warehouse } from 'lucide-react';
import { moreItems } from './i18n';

const ICONS = [Package, Tag, Warehouse, Truck, Wallet, Banknote, CalendarCheck, TrendingUp];
const EVERY = 5000;
const LIT = 2;

/** Следующая пара карточек: не повторяет ни одну из горящих сейчас */
const next = (n: number, prev: number[]) => {
  const pool = [...Array(n).keys()].filter(i => !prev.includes(i));
  const out: number[] = [];
  while (out.length < LIT && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]!);
  return out;
};

export function MoreCards() {
  const items = moreItems();
  const ref = React.useRef<HTMLDListElement>(null);
  const [lit, setLit] = React.useState<number[]>([1, 6]);
  const [active, setActive] = React.useState(false);

  React.useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false;
    const upd = () => setActive(visible && !document.hidden && !mq.matches);
    const io = new IntersectionObserver(([e]) => ((visible = e!.isIntersecting), upd()), { threshold: 0.2 });
    io.observe(ref.current!);
    document.addEventListener('visibilitychange', upd);
    mq.addEventListener('change', upd);
    return () => (io.disconnect(), document.removeEventListener('visibilitychange', upd), mq.removeEventListener('change', upd));
  }, []);

  React.useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setLit(p => next(items.length, p)), EVERY);
    return () => clearInterval(id);
  }, [active, items.length]);

  return (
    <dl ref={ref} className="l-more-list">
      {items.map(([name, what], i) => {
        const Icon = ICONS[i] ?? Package;
        return (
          <div key={name} className={'l-card' + (active && lit.includes(i) ? ' lit' : '')}>
            <span className="l-card-ic" aria-hidden>
              <Icon size={17} />
            </span>
            <dt>{name}</dt>
            <dd>{what}</dd>
          </div>
        );
      })}
    </dl>
  );
}
