/* Модули главной: список-вкладки (на телефоне — прокручиваемые «чипы») и карточка выбранного модуля с «записью» экрана.
   Названия и описания — alternative.modules, возможности — modules.<id>.features; записи есть у пяти модулей */
import * as React from 'react';
import { t, type TKey } from '../i18n';
import { ru } from '../i18n/ru';
import { Recording, type Scene } from '../demo/player';
import { tasksScene } from '../demo/TasksScene';
import { crmScene } from '../demo/CrmScene';
import { docScene } from '../demo/DocScene';
import { servicesScene } from '../demo/ServicesScene';
import { productionScene } from '../demo/ProductionScene';

type Id = keyof typeof ru.alternative.modules;
type FeatId = keyof typeof ru.modules;

const rec = <S,>(scene: Scene<S>) => (label: string, caption: string) => <Recording scene={scene} label={label} caption={caption} />;

/** Порядок — как в макете; feat — ключ возможностей в modules.*, rec — запись экрана */
const MODULES: { id: Id; feat?: FeatId; rec?: (label: string, caption: string) => React.ReactNode }[] = [
  { id: 'tasks', feat: 'tasks', rec: rec(tasksScene) },
  { id: 'crm', feat: 'crm', rec: rec(crmScene) },
  { id: 'docs', feat: 'docs', rec: rec(docScene) },
  { id: 'services', feat: 'services', rec: rec(servicesScene) },
  { id: 'production', feat: 'production', rec: rec(productionScene) },
  { id: 'sales' },
  { id: 'logistics' },
  { id: 'automations', feat: 'automations' },
  { id: 'payroll' },
];

const mt = (id: Id, k: 'name' | 'title' | 'text') => t(`alternative.modules.${id}.${k}` as TKey);

export default function ModuleSwitcher() {
  const [active, setActive] = React.useState<Id>('production');
  const tabs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const mod = MODULES.find(m => m.id === active)!;

  // На телефоне вкладки — горизонтальная лента: выбранная прокручивается в видимую часть (только сама лента, не страница)
  React.useEffect(() => {
    const el = tabs.current[MODULES.findIndex(m => m.id === active)];
    const list = el?.parentElement;
    if (!el || !list || list.scrollWidth <= list.clientWidth) return;
    const er = el.getBoundingClientRect();
    const lr = list.getBoundingClientRect();
    list.scrollTo({ left: list.scrollLeft + er.left - lr.left - (lr.width - er.width) / 2, behavior: 'smooth' });
  }, [active]);
  const feats = mod.feat ? ru.modules[mod.feat].features : [];
  const caption = mod.feat && 'caption' in ru.modules[mod.feat] ? (ru.modules[mod.feat] as { caption: string }).caption : '';

  // Стрелки переключают вкладки, как в tablist по WAI-ARIA; вниз/вправо и вверх/влево — список вертикальный на десктопе
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + MODULES.length) % MODULES.length;
    setActive(MODULES[n]!.id);
    tabs.current[n]?.focus();
  };

  return (
    <div className="h-switch">
      <div className="h-tabs" role="tablist" aria-label={t('home.modules.tabs')}>
        {MODULES.map((m, i) => (
          <button
            key={m.id}
            ref={el => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`h-tab-${m.id}`}
            aria-selected={m.id === active}
            aria-controls="h-mod-panel"
            tabIndex={m.id === active ? 0 : -1}
            className="h-tab"
            onClick={() => setActive(m.id)}
            onKeyDown={e => onKey(e, i)}
          >
            {mt(m.id, 'name')}
          </button>
        ))}
      </div>
      <div className="h-panel" role="tabpanel" id="h-mod-panel" aria-labelledby={`h-tab-${active}`} key={active}>
        <div className="h-panel-head">
          <span className="h-eyebrow">{mt(active, 'name')}</span>
          <h3>{mt(active, 'title')}</h3>
          <p>{mt(active, 'text')}</p>
        </div>
        {feats.length > 0 && (
          <dl className="h-feats">
            {feats.map(([name, text]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        )}
        {mod.rec ? <div className="h-rec">{mod.rec(mt(active, 'title'), caption)}</div> : <p className="h-soon">{t('home.modules.soon')}</p>}
      </div>
    </div>
  );
}
