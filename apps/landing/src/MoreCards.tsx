/* «Что ещё есть»: модули карточками — слева плитка с небольшим скриншотом экрана, справа название и пояснение.
   Скриншот — public/more/<slug>.jpg (960×620, без шапки приложения); пока файла нет, на плитке значок модуля.
   Каждые 5 секунд подсвечиваются две другие плитки; только в зоне видимости и при видимой вкладке, без подсветки при prefers-reduced-motion. */
import * as React from 'react';
import { Banknote, CalendarCheck, Package, Tag, TrendingUp, Truck, Wallet, Warehouse } from 'lucide-react';
import { moreItems } from './i18n';

/** Порядок совпадает с more.items словаря */
const CARDS = [
  ['catalog', Package],
  ['pricing', Tag],
  ['stock', Warehouse],
  ['deliveries', Truck],
  ['money', Wallet],
  ['payroll', Banknote],
  ['closing', CalendarCheck],
  ['investments', TrendingUp],
] as const;
const EVERY = 5000;
const LIT = 2;

/** Следующая пара плиток: не повторяет ни одну из горящих сейчас */
const next = (n: number, prev: number[]) => {
  const pool = [...Array(n).keys()].filter(i => !prev.includes(i));
  const out: number[] = [];
  while (out.length < LIT && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]!);
  return out;
};

function Shot({ slug, Icon }: { slug: string; Icon: (typeof CARDS)[number][1] }) {
  const [missing, setMissing] = React.useState(false);
  if (missing)
    return (
      <span className="l-card-ic" aria-hidden>
        <Icon size={22} />
      </span>
    );
  return <img className="l-card-shot" src={`${import.meta.env.BASE_URL}more/${slug}.jpg`} alt="" loading="lazy" decoding="async" onError={() => setMissing(true)} />;
}

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
        const [slug, Icon] = CARDS[i] ?? CARDS[0];
        return (
          <div key={name} className={'l-card' + (active && lit.includes(i) ? ' lit' : '')}>
            <div className="l-card-tile">
              <Shot slug={slug} Icon={Icon} />
            </div>
            <div className="l-card-t">
              <dt>{name}</dt>
              <dd>{what}</dd>
            </div>
          </div>
        );
      })}
    </dl>
  );
}
