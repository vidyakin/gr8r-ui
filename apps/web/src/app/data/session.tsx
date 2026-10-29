/* Сессия: кто вошёл, мои воркспейсы, активный воркспейс (хранится в localStorage — это настройка просмотра, не данные). */
import * as React from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { ApiError, UNAUTHORIZED_EVENT, apiFor, ok } from './api';
import { resolveLocale, setLocale, type Locale } from '@/i18n';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  /** Личный язык интерфейса; null — как в воркспейсе */
  locale: string | null;
  /** Оператор установки: раздел «Арендаторы» в настройках */
  isOperator?: boolean;
}

/** Воркспейс из GET /workspaces: мой и роль в нём */
export interface WorkspaceRef {
  id: string;
  name: string;
  slug: string;
  color: string;
  brand: boolean;
  createdAt: string;
  role: 'owner' | 'admin' | 'member' | 'guest';
  /** Язык воркспейса по умолчанию (settings.locale) */
  locale: string | null;
}

interface SessionData {
  user: SessionUser;
  workspaces: WorkspaceRef[];
}

const SESSION_KEY = ['session'] as const;
const ACTIVE_KEY = 'gr8r-ui.workspace';

const readActive = () => {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
};

interface SessionCtx {
  status: 'loading' | 'anon' | 'authed';
  user: SessionUser | null;
  workspaces: WorkspaceRef[];
  /** Активный воркспейс (из localStorage, если он ещё мой; иначе первый) */
  active: WorkspaceRef | null;
  switchWorkspace: (id: string) => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (v: { email: string; password: string; name: string; workspaceName?: string }) => Promise<void>;
  signOut: () => Promise<void>;
  /** Перечитать список моих воркспейсов (после создания/переименования/удаления) */
  refreshWorkspaces: () => Promise<WorkspaceRef[]>;
  /** Личный язык интерфейса (null — как в воркспейсе); сохраняется на сервере */
  setMyLocale: (locale: Locale | null) => Promise<void>;
}

const Ctx = React.createContext<SessionCtx | null>(null);

async function fetchSession(): Promise<SessionData | null> {
  try {
    return await ok<SessionData>(apiFor().auth.me.$get());
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: SESSION_KEY, queryFn: fetchSession, staleTime: Infinity, retry: false });
  const [stored, setStored] = React.useState<string | null>(readActive);

  // Любой запрос вернул «нет сессии» — выходим на экран входа
  React.useEffect(() => {
    const onUnauthorized = () => {
      qc.removeQueries({ queryKey: ['ws'] });
      qc.setQueryData(SESSION_KEY, null);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [qc]);

  const data = q.data ?? null;
  const workspaces = data?.workspaces ?? [];
  const active = workspaces.find(w => w.id === stored) ?? workspaces[0] ?? null;

  // Язык интерфейса: личный → воркспейса → запомненный в браузере
  React.useEffect(() => {
    if (data) setLocale(resolveLocale(data.user.locale, active?.locale));
  }, [data?.user.locale, active?.locale]);

  const value = React.useMemo<SessionCtx>(() => {
    const set = (d: SessionData | null) => qc.setQueryData(SESSION_KEY, d);
    return {
      status: q.isPending ? 'loading' : data ? 'authed' : 'anon',
      user: data?.user ?? null,
      workspaces,
      active,
      switchWorkspace: id => {
        if (id === active?.id) return;
        // Данные прежнего воркспейса выбрасываем: при возврате они перечитаются, а не покажут устаревшее
        if (active) qc.removeQueries({ queryKey: ['ws', active.id] });
        setStored(id);
        try {
          localStorage.setItem(ACTIVE_KEY, id);
        } catch {
          /* хранилище недоступно */
        }
      },
      signIn: async (email, password) => {
        qc.removeQueries({ queryKey: ['ws'] });
        set(await ok<SessionData>(apiFor().auth.signin.$post({ json: { email, password } })));
      },
      signUp: async v => {
        qc.removeQueries({ queryKey: ['ws'] });
        set(await ok<SessionData>(apiFor().auth.signup.$post({ json: v })));
      },
      signOut: async () => {
        try {
          await ok(apiFor().auth.signout.$post());
        } finally {
          qc.removeQueries({ queryKey: ['ws'] });
          set(null);
        }
      },
      refreshWorkspaces: async () => {
        const { items } = await ok<{ items: WorkspaceRef[] }>(apiFor().workspaces.$get());
        if (data) set({ user: data.user, workspaces: items });
        return items;
      },
      setMyLocale: async locale => {
        const { user } = await ok<{ user: SessionUser }>(apiFor().auth.me.$patch({ json: { locale } }));
        if (data) set({ ...data, user });
      },
    };
  }, [qc, q.isPending, data, workspaces, active]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const c = React.useContext(Ctx);
  if (!c) throw new Error('useSession() нужно вызывать внутри <SessionProvider>');
  return c;
}

/** Запомнить активный воркспейс до того, как список обновится (например, сразу после создания) */
export function rememberWorkspace(id: string) {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* хранилище недоступно */
  }
}
