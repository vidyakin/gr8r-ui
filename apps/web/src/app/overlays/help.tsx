/* Справка в приложении: открывается кнопкой «?» в шапке, клавишей F1 или из палитры команд.
   Панель и тексты статей грузятся лениво при первом открытии (app/help). «?» занят окном горячих клавиш — поэтому F1. */
import * as React from 'react';
import type { HelpInit } from '../help/HelpPanel';

const HelpPanel = React.lazy(() => import('../help/HelpPanel'));

export interface HelpApi {
  /** Открыть справку: статья раздела по адресу, либо указанная статья или поиск */
  open(init?: HelpInit): void;
  close(): void;
  toggle(): void;
}

const Ctx = React.createContext<HelpApi | null>(null);

export const useHelp = () => {
  const c = React.useContext(Ctx);
  if (!c) throw new Error('useHelp вне HelpProvider');
  return c;
};

export function HelpProvider({ children }: { children: React.ReactNode }) {
  const [st, setSt] = React.useState<{ open: boolean; nonce: number; init: HelpInit }>({ open: false, nonce: 0, init: {} });
  const api = React.useMemo<HelpApi>(
    () => ({
      open: init => setSt(s => ({ open: true, nonce: s.nonce + 1, init: init ?? {} })),
      close: () => setSt(s => ({ ...s, open: false })),
      toggle: () => setSt(s => (s.open ? { ...s, open: false } : { open: true, nonce: s.nonce + 1, init: {} })),
    }),
    [],
  );

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F1' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      e.preventDefault();
      api.toggle();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [api]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {st.open && (
        <React.Suspense fallback={null}>
          <HelpPanel key={st.nonce} init={st.init} onClose={api.close} />
        </React.Suspense>
      )}
    </Ctx.Provider>
  );
}
