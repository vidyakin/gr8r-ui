/* Окно «Keyboard shortcuts» — порт shortcutsModal и SHORTCUTS из overlays/modals.js, действия shortcuts из actions/actions.js.
   Список — реальные клавиши приложения (палитра, форма задачи, сайдбар, карточка задачи). */
import * as React from 'react';
import { MOD } from '../lib/platform';
import { Modal } from './modal-shell';

export interface ShortcutsApi {
  open(): void;
}

const Ctx = React.createContext<ShortcutsApi | null>(null);

export const useShortcuts = () => {
  const c = React.useContext(Ctx);
  if (!c) throw new Error('useShortcuts вне ShortcutsProvider');
  return c;
};

export const SHORTCUTS: [string, [string, string[]][]][] = [
  [
    'General',
    [
      ['Command menu', [MOD, 'K']],
      ['Search', ['/']],
      ['Keyboard shortcuts', ['?']],
      ['Toggle sidebar', ['[']],
      ['Toggle dark mode', [MOD, 'Shift', 'L']],
      ['Close panel or dialog', ['Esc']],
    ],
  ],
  [
    'Create',
    [
      ['New task', ['N']],
      ['New project', ['P']],
      ['Submit form', [MOD, '↵']],
      ['Send comment', [MOD, '↵']],
    ],
  ],
  [
    'Navigate',
    [
      ['Go to Home', ['G', 'H']],
      ['Go to My Tasks', ['G', 'T']],
      ['Go to Projects', ['G', 'P']],
      ['Go to Inbox', ['G', 'I']],
      ['Go to Calendar', ['G', 'C']],
      ['Go to Settings', ['G', 'S']],
    ],
  ],
  [
    'Command menu',
    [
      ['Move selection', ['↑', '↓']],
      ['Run command', ['↵']],
      ['Search mode', ['Tab']],
    ],
  ],
];

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" size="lg" onClose={onClose}>
      <div className="modal-b keys-grid">
        {SHORTCUTS.map(([g, list]) => (
          <div key={g}>
            <div className="eyebrow">{g}</div>
            {list.map(([n, k]) => (
              <div key={n} className="row">
                <span className="grow" style={{ flex: 1 }}>
                  {n}
                </span>
                {k.map((x, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && k[0] === 'G' && <span className="faint then">then</span>}
                    <kbd>{x}</kbd>
                  </React.Fragment>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function ShortcutsProvider({ children }: { children: React.ReactNode }) {
  const [shown, setShown] = React.useState(false);
  const api = React.useMemo<ShortcutsApi>(() => ({ open: () => setShown(true) }), []);
  return (
    <Ctx.Provider value={api}>
      {children}
      {shown && <ShortcutsDialog onClose={() => setShown(false)} />}
    </Ctx.Provider>
  );
}
