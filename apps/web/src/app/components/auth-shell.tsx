/* Каркас экранов входа — порт authShell, socialBtns, ferr из pages/auth.js и strengthMeter из pages/settings.js */
import * as React from 'react';
import { Apple, CircleAlert, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePrefs } from '@/components/ui';
import { useT } from '@/i18n';
import { Logo } from './brand';

function useEffectiveDark() {
  const { prefs } = usePrefs();
  return prefs.theme === 'dark' || (prefs.theme === 'system' && typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches);
}

export function AuthShell({ topRight, children }: { topRight?: React.ReactNode; children: React.ReactNode }) {
  const { setPrefs } = usePrefs();
  const tt = useT();
  const dark = useEffectiveDark();
  return (
    <div className="auth">
      <div className="auth-top">
        <span className="brand">
          <Logo height={22} />
        </span>
        <div className="row">
          {topRight}
          <button type="button" className="ibtn" aria-label={tt('views.shell.toggleTheme')} onClick={() => setPrefs({ theme: dark ? 'light' : 'dark' })}>
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </div>
      <div className="auth-c">{children}</div>
      <div className="auth-foot" style={{ padding: 18, fontSize: 12 }}>
        <span className="faint">{tt('views.shell.copyright')}</span>
      </div>
    </div>
  );
}

/** Карточка по центру; fx-auth — анимация появления при смене экрана */
export function AuthCard({ as: Tag = 'div', fx = 'fx-auth', className, children, ...rest }: { as?: 'div' | 'form'; fx?: string; className?: string; children: React.ReactNode } & React.HTMLAttributes<HTMLElement> & { noValidate?: boolean }) {
  const P = Tag as React.ElementType;
  return (
    <P className={cn('auth-card', fx, className)} {...rest}>
      {children}
    </P>
  );
}

/** Сообщение об ошибке поля */
export function FieldErr({ id, children }: { id?: string; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <span className="err" id={id}>
      <CircleAlert size={12} />
      {children}
    </span>
  );
}

export function SocialButtons({ onPick, busy }: { onPick: (name: string) => void; busy: string | null }) {
  const tt = useT();
  const b = (name: string, icon: React.ReactNode) => (
    <button type="button" className={cn('btn btn-secondary btn-lg', busy === name && 'is-loading')} disabled={!!busy} onClick={() => onPick(name)}>
      {icon}
      {tt('views.auth.continueWith', { name })}
    </button>
  );
  return (
    <div className="social">
      {b(
        'Google',
        <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>,
      )}
      {b(
        'Microsoft',
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <rect width="6.4" height="6.4" fill="#F25022" />
          <rect x="7.6" width="6.4" height="6.4" fill="#7FBA00" />
          <rect y="7.6" width="6.4" height="6.4" fill="#00A4EF" />
          <rect x="7.6" y="7.6" width="6.4" height="6.4" fill="#FFB900" />
        </svg>,
      )}
      {b('Apple', <Apple size={15} />)}
    </div>
  );
}

/** Индикатор надёжности пароля (strengthMeter) */
export function StrengthMeter({ pw }: { pw: string }) {
  const t = useT();
  if (!pw) return null;
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[0-9]/.test(pw) && /[a-zA-Z]/.test(pw)) s++;
  if (/[^a-zA-Z0-9]/.test(pw)) s++;
  const labels = ['one', 'two', 'three', 'four', 'five'] as const;
  const c = ['var(--red)', 'var(--red)', 'var(--amber)', 'var(--green)', 'var(--green)'][s];
  const n = t(`views.auth.strength.${labels[s]}`);
  return (
    <div className="row" style={{ gap: 8 }}>
      <div className="strength grow" aria-hidden="true" style={{ flex: 1 }}>
        {[0, 1, 2, 3].map(i => (
          <i key={i} className={i < s ? 'on' : ''} style={{ '--c': c } as React.CSSProperties} />
        ))}
      </div>
      <span style={{ fontSize: 11.5, color: c, width: 60, textAlign: 'right' }}>{n}</span>
    </div>
  );
}

/** Кнопка с «загрузкой» на заданное время, как loadingBtn в оригинале */
export function useLoading(ms: number) {
  const [busy, setBusy] = React.useState(false);
  const t = React.useRef<number>(undefined);
  React.useEffect(() => () => window.clearTimeout(t.current), []);
  const run = (done: () => void) => {
    setBusy(true);
    t.current = window.setTimeout(() => {
      setBusy(false);
      done();
    }, ms);
  };
  return [busy, run] as const;
}

/** Кнопка в ожидании настоящего ответа сервера: run(async () => …) держит busy, пока промис не завершится */
export function useBusy() {
  const [busy, setBusy] = React.useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return [busy, run] as const;
}
