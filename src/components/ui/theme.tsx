import * as React from 'react';
import { TooltipProvider } from './tooltip';
import { Toaster } from './feedback';

export type ThemeMode = 'system' | 'light' | 'dark';
export type Accent = 'indigo' | 'blue' | 'violet' | 'teal' | 'rose' | 'graphite';
export type Density = 'comfortable' | 'compact';
export type Motion = 'system' | 'reduce';

export interface Prefs {
  theme: ThemeMode;
  accent: Accent;
  density: Density;
  /** Плотность сайдбара (data-side) */
  side: Density;
  /** reduce — гасит анимации оверлеев и переходов независимо от системной настройки (data-motion) */
  motion: Motion;
}

const DEFAULTS: Prefs = { theme: 'system', accent: 'indigo', density: 'comfortable', side: 'comfortable', motion: 'system' };
const KEY = 'gr8r-ui.prefs';

const Ctx = React.createContext<{ prefs: Prefs; setPrefs: (p: Partial<Prefs>) => void } | null>(null);

function read(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return DEFAULTS;
  }
}

/**
 * Корневой провайдер: тема, акцент и плотность (data-атрибуты на <html>, как в оригинале),
 * плюс провайдер тултипов и контейнер тостов.
 */
export function Gr8rProvider({ children, initial }: { children: React.ReactNode; initial?: Partial<Prefs> }) {
  const [prefs, set] = React.useState<Prefs>(() => ({ ...read(), ...initial }));
  React.useLayoutEffect(() => {
    const r = document.documentElement;
    if (prefs.theme === 'system') delete r.dataset.theme;
    else r.dataset.theme = prefs.theme;
    if (prefs.accent === 'indigo') delete r.dataset.accent;
    else r.dataset.accent = prefs.accent;
    if (prefs.density === 'comfortable') delete r.dataset.density;
    else r.dataset.density = prefs.density;
    if (prefs.side === 'comfortable') delete r.dataset.side;
    else r.dataset.side = prefs.side;
    if (prefs.motion === 'reduce') r.dataset.motion = 'reduce';
    else delete r.dataset.motion;
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* хранилище недоступно — работаем в памяти */
    }
  }, [prefs]);
  const value = React.useMemo(() => ({ prefs, setPrefs: (p: Partial<Prefs>) => set(s => ({ ...s, ...p })) }), [prefs]);
  return (
    <Ctx.Provider value={value}>
      <TooltipProvider>
        {children}
        <Toaster />
      </TooltipProvider>
    </Ctx.Provider>
  );
}

export function usePrefs() {
  const c = React.useContext(Ctx);
  if (!c) throw new Error('usePrefs() нужно вызывать внутри <Gr8rProvider>');
  return c;
}
