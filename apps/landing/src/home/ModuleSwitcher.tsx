/* Модули главной: список-вкладки (на телефоне — прокручиваемые «чипы») и карточка выбранного модуля с «записью» экрана.
   Названия и описания — alternative.modules, возможности — modules.<id>.features; записи — из demo/registry.ts */
import * as React from 'react';
import { DEFAULT_LOCALE, useI18n, type Dict, type Locale, type TKey } from '../i18n';
import { Recording } from '../demo/player';
import { SCENES, MODULE_IDS, type ModuleId } from '../demo/registry';

type Id = ModuleId;
type FeatId = keyof Dict['modules'];

export default function ModuleSwitcher({ locale = DEFAULT_LOCALE }: { locale?: Locale }) {
  const { t, dict, path } = useI18n(locale);
  const [active, setActive] = React.useState<Id>('production');
  const tabs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const modules = React.useMemo(
    () => MODULE_IDS.map(id => ({ id, feat: id in dict.modules ? (id as FeatId) : undefined })),
    [dict],
  );
  const mt = (id: Id, k: 'name' | 'title' | 'text') => t(`alternative.modules.${id}.${k}` as TKey);
  const mod = modules.find(m => m.id === active)!;
  const scene = SCENES[active];

  React.useEffect(() => {
    const el = tabs.current[modules.findIndex(m => m.id === active)];
    const list = el?.parentElement;
    if (!el || !list || list.scrollWidth <= list.clientWidth) return;
    const er = el.getBoundingClientRect();
    const lr = list.getBoundingClientRect();
    list.scrollTo({ left: list.scrollLeft + er.left - lr.left - (lr.width - er.width) / 2, behavior: 'smooth' });
  }, [active, modules]);

  const feats = mod.feat ? dict.modules[mod.feat].features : [];
  const caption = mod.feat && 'caption' in dict.modules[mod.feat] ? (dict.modules[mod.feat] as { caption: string }).caption : '';

  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + modules.length) % modules.length;
    setActive(modules[n]!.id);
    tabs.current[n]?.focus();
  };

  return (
    <div className="h-switch">
      <div className="h-tabs" role="tablist" aria-label={t('home.modules.tabs')}>
        {modules.map((m, i) => (
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
          <div className="h-panel-top">
            <span className="h-eyebrow">{mt(active, 'name')}</span>
            <a className="h-more-link" href={path(`/modules/${active}/`)}>{t('home.modules.more')} <span aria-hidden="true">→</span></a>
          </div>
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
        {scene ? <div className="h-rec"><Recording scene={scene} label={mt(active, 'title')} caption={caption} locale={locale} /></div> : <p className="h-soon">{t('home.modules.soon')}</p>}
      </div>
    </div>
  );
}
