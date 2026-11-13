import * as React from 'react';
import { Banknote, Factory, FileText, FolderKanban, GitBranch, Handshake, Pause, Play, ShoppingBag, Truck, Wrench } from 'lucide-react';
import { t } from '../i18n';
import { ModulePreview } from './ModulePreview';
import { SilkBackground } from './SilkBackground';
import './alternative.css';

const APP_URL = import.meta.env.VITE_APP_URL ?? '/app/';
const DURATION = 9000;
const GradientWave = React.lazy(() => import('../components/ui/gradient-wave').then(module => ({ default: module.GradientWave })));
const MODULES = [
  { id: 'tasks', Icon: FolderKanban },
  { id: 'crm', Icon: Handshake },
  { id: 'docs', Icon: FileText },
  { id: 'services', Icon: Wrench },
  { id: 'production', Icon: Factory },
  { id: 'sales', Icon: ShoppingBag },
  { id: 'logistics', Icon: Truck },
  { id: 'automations', Icon: GitBranch },
  { id: 'payroll', Icon: Banknote },
] as const;
export type AlternativeModuleId = (typeof MODULES)[number]['id'];

export default function AlternativeLanding({ background = 'silk' }: { background?: 'silk' | 'wave' }) {
  const [active, setActive] = React.useState(4);
  const [paused, setPaused] = React.useState(false);
  const [reduced, setReduced] = React.useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [visible, setVisible] = React.useState(false);
  const [tabShown, setTabShown] = React.useState(() => !document.hidden);
  const section = React.useRef<HTMLElement>(null);
  const tabs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const ring = React.useRef<SVGCircleElement>(null);
  const elapsed = React.useRef(0);
  const id = MODULES[active]!.id;
  const playing = !paused && !reduced && visible && tabShown;

  React.useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => setReduced(mq.matches);
    const visibility = () => setTabShown(!document.hidden);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry!.isIntersecting), { threshold: 0.15 });
    observer.observe(section.current!);
    mq.addEventListener('change', motion);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      observer.disconnect();
      mq.removeEventListener('change', motion);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  React.useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      elapsed.current += Math.min(now - last, 100);
      last = now;
      ring.current?.style.setProperty('stroke-dashoffset', String(100 * (1 - elapsed.current / DURATION)));
      if (elapsed.current >= DURATION) {
        elapsed.current = 0;
        setActive(index => (index + 1) % MODULES.length);
      } else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, active]);

  const select = (index: number) => {
    elapsed.current = 0;
    ring.current?.style.setProperty('stroke-dashoffset', '100');
    setActive(index);
  };

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const destinations: Record<string, number> = {
      ArrowRight: (index + 1) % MODULES.length,
      ArrowLeft: (index + MODULES.length - 1) % MODULES.length,
      ArrowDown: (index + 3) % MODULES.length,
      ArrowUp: (index + MODULES.length - 3) % MODULES.length,
      Home: 0,
      End: MODULES.length - 1,
    };
    const next = destinations[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(next);
    tabs.current[next]?.focus();
  };

  return (
    <div className={`alt-page${background === 'wave' ? ' alt-page--wave' : ''}`}>
      {background === 'wave' ? <React.Suspense fallback={null}><GradientWave className="alt-wave" /></React.Suspense> : <SilkBackground />}
      <a className="skip" href="#alt-modules">{t('nav.skip')}</a>
      <section className="alt-hero" ref={section} aria-labelledby="alt-title">
        <header className="alt-header">
          <nav className="alt-nav" aria-label={t('alternative.navigation')}>
            <a href="#alt-modules">{t('nav.modules')}</a>
            <a href="/#request">{t('alternative.implementation')}</a>
            <a href="/#more">{t('alternative.alternatives')}</a>
            <a className="alt-nav-demo" href="/#request">{t('alternative.request')}</a>
          </nav>
        </header>

        <main className="alt-layout">
          <div className="alt-heading">
            <h1 id="alt-title">FUTURE<span>ERP</span></h1>
            <p>{t('alternative.tagline')}</p>
          </div>

          <div className="alt-modules" id="alt-modules">
            <div className="alt-grid" role="tablist" aria-label={t('nav.modules')}>
              {MODULES.map(({ id: moduleId, Icon }, index) => (
                <button
                  type="button"
                  className="alt-module"
                  key={moduleId}
                  ref={element => { tabs.current[index] = element; }}
                  id={`alt-tab-${moduleId}`}
                  role="tab"
                  aria-selected={index === active}
                  aria-controls="alt-module-panel"
                  tabIndex={index === active ? 0 : -1}
                  onClick={() => select(index)}
                  onKeyDown={event => onKeyDown(event, index)}
                >
                  <Icon size={26} aria-hidden="true" />
                  <span>{t(`alternative.modules.${moduleId}.name`)}</span>
                  {index === active && !reduced && (
                    <svg className="alt-timer" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                      <circle className="alt-timer-track" cx="10" cy="10" r="7" />
                      <circle ref={ring} className="alt-timer-fill" cx="10" cy="10" r="7" pathLength="100" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
            <div className="alt-description" aria-live="off">
              <h2>{t(`alternative.modules.${id}.title`)}</h2>
              <p>{t(`alternative.modules.${id}.text`)}</p>
            </div>
          </div>

          <div className="alt-preview" role="tabpanel" id="alt-module-panel" aria-labelledby={`alt-tab-${id}`} tabIndex={0}>
            <ModulePreview id={id} />
          </div>

          <div className="alt-intro">
            <p><strong>FutureERP</strong> {t('alternative.intro')}</p>
            <div className="alt-cta-row">
              <a className="alt-demo" href={APP_URL}>{t('alternative.openDemo')}</a>
              <p>{t('alternative.demoHint')}</p>
            </div>
          </div>
        </main>
        {!reduced && (
          <button className="alt-playback" type="button" onClick={() => setPaused(value => !value)} aria-label={t(paused ? 'alternative.resume' : 'alternative.pause')} aria-pressed={paused}>
            {paused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
          </button>
        )}
      </section>
    </div>
  );
}
