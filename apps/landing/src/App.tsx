import * as React from 'react';
import { features, t, type TKey } from './i18n';
import { Recording, type Scene } from './demo/player';
import { tasksScene } from './demo/TasksScene';
import { crmScene } from './demo/CrmScene';
import { docScene } from './demo/DocScene';
import { servicesScene } from './demo/ServicesScene';
import { productionScene } from './demo/ProductionScene';
import { Brand } from './demo/shell';
import { LeadForm } from './LeadForm';
import { HeroFlow } from './HeroFlow';
import { MoreCards } from './MoreCards';

/** Адрес приложения: по плану лендинг на «/», приложение на «/app/» (docs/plans/2026-10-29-landing.md) */
const APP_URL = import.meta.env.VITE_APP_URL ?? '/app/';

type ModId = 'tasks' | 'crm' | 'docs' | 'services' | 'production' | 'automations';
/** Сцена модуля: тип состояния у каждой свой, поэтому храним готовую «запись» */
const rec = <S,>(scene: Scene<S>) => (label: string, caption: string) => <Recording scene={scene} label={label} caption={caption} />;
const MODULES: { id: ModId; rec?: (label: string, caption: string) => React.ReactNode }[] = [
  { id: 'tasks', rec: rec(tasksScene) },
  { id: 'crm', rec: rec(crmScene) },
  { id: 'docs', rec: rec(docScene) },
  { id: 'services', rec: rec(servicesScene) },
  { id: 'production', rec: rec(productionScene) },
  { id: 'automations' },
];

const mt = (id: ModId, k: 'name' | 'title' | 'text') => t(`modules.${id}.${k}` as TKey);

export function App() {
  return (
    <>
      <a className="skip" href="#main">
        {t('nav.skip')}
      </a>
      <header className="l-head">
        <div className="l-wrap l-head-in">
          <a className="l-brand" href="#top">
            <Brand size={24} />
            <span>
              Future<b>ERP</b>
            </span>
          </a>
          <nav className="l-nav">
            <a href="#modules">{t('nav.modules')}</a>
            <a href="#more">{t('nav.more')}</a>
            <a href="#request">{t('nav.request')}</a>
          </nav>
          <a className="btn btn-secondary" href={APP_URL}>
            {t('nav.signIn')}
          </a>
        </div>
      </header>

      <main id="main">
        <section className="l-wrap l-hero" id="top">
          <div>
            <h1>{t('hero.title')}</h1>
            <p className="l-lead">{t('hero.lead')}</p>
            <div className="l-ctas">
              <a className="btn btn-primary btn-lg" href="#request">
                {t('hero.request')}
              </a>
              <a className="btn btn-ghost btn-lg" href="#modules">
                {t('hero.watch')}
              </a>
            </div>
          </div>
          <HeroFlow />
        </section>

        <Modules />

        <section className="l-wrap l-more" id="more" aria-labelledby="h-more">
          <div className="l-more-h">
            <h2 id="h-more">{t('more.title')}</h2>
            <p>{t('more.lead')}</p>
          </div>
          <MoreCards />
          <p className="l-platform">{t('more.platform')}</p>
        </section>

        <section className="l-wrap l-req" id="request" aria-labelledby="h-req">
          <div>
            <h2 id="h-req">{t('form.title')}</h2>
            <p>{t('form.lead')}</p>
          </div>
          <LeadForm />
        </section>
      </main>

      <footer className="l-wrap l-foot">
        <span>{t('footer.rights', { year: new Date().getFullYear() })}</span>
        <a href={APP_URL}>{t('nav.signIn')}</a>
      </footer>
    </>
  );
}

/** Модули — вкладками: у каждой своя «страница» — возможности слева, запись справа */
function Modules() {
  const [active, setActive] = React.useState<ModId>('tasks');
  const tabs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const mod = MODULES.find(m => m.id === active)!;

  // Стрелки переключают вкладки, как в tablist по WAI-ARIA
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + MODULES.length) % MODULES.length;
    setActive(MODULES[n]!.id);
    tabs.current[n]?.focus();
  };

  return (
    <section className="l-wrap l-mods" id="modules" aria-label={t('nav.modules')}>
      <div className="l-tabs" role="tablist">
        {MODULES.map((m, i) => (
          <button
            key={m.id}
            ref={el => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${m.id}`}
            aria-selected={m.id === active}
            aria-controls="mod-panel"
            tabIndex={m.id === active ? 0 : -1}
            className="l-tab"
            onClick={() => setActive(m.id)}
            onKeyDown={e => onKey(e, i)}
          >
            {mt(m.id, 'name')}
          </button>
        ))}
      </div>
      <div className="l-panel" role="tabpanel" id="mod-panel" aria-labelledby={`tab-${active}`} key={active}>
        <div className="l-panel-text">
          <h2>{mt(active, 'title')}</h2>
          <p>{mt(active, 'text')}</p>
          <dl className="l-feats">
            {features(active).map(([name, what]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="l-panel-shot">
          {mod.rec ? mod.rec(`${t('player.recording')}: ${mt(active, 'name')}`, t(`modules.${active as 'tasks'}.caption`)) : <div className="l-soon">{t('modules.automations.soon')}</div>}
        </div>
      </div>
    </section>
  );
}
