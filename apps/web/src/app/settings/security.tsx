import * as React from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isIpAllowed, isValidIpRange, qrSvg, TOTP_CODE_RE } from '@erp/shared';
import { Button, Switch, toast } from '@/components/ui';
import { fmtDateTime, fmtNumber, useT } from '@/i18n';
import { AuthCard, AuthShell, useBusy } from '../components/auth-shell';
import { apiFor, errorMessage, ok } from '../data/api';
import { useSession } from '../data/session';
import { useWsId } from '../meta/data';
import { SRow, SettingsHead } from './parts';

export function TotpSection({ title, onContinue }: { title: string; onContinue?: () => void }) {
  const t = useT();
  const { user } = useSession();
  const qc = useQueryClient();
  const baseId = React.useId();
  const api = apiFor().auth['2fa'];
  const statusKey = ['account-totp', user?.id] as const;
  const status = useQuery({ queryKey: statusKey, queryFn: () => ok(api.status.$get()), refetchOnMount: 'always' });
  const [setup, setSetup] = React.useState<{ secret: string; qr: string } | null>(null);
  const [recovery, setRecovery] = React.useState<string[] | null>(null);
  const [disable, setDisable] = React.useState<'password' | 'code' | null>(null);
  const [value, setValue] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, run] = useBusy();

  const attempt = (action: () => Promise<void>) => {
    setError('');
    void run(async () => {
      try {
        await action();
      } catch (e) {
        setError(errorMessage(e));
      }
    });
  };
  const reset = () => {
    setSetup(null);
    setDisable(null);
    setValue('');
    setError('');
  };
  const continueButton = onContinue && <Button type="button" variant="primary" onClick={onContinue}>{t('settings.loginSecurity.continue')}</Button>;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    attempt(async () => {
      if (setup) {
        const { recoveryCodes } = await ok(api.verify.$post({ json: { code: value.trim() } }));
        setRecovery(recoveryCodes);
      } else if (disable) {
        await ok(api.disable.$post({ json: disable === 'password' ? { password: value } : { code: value.trim() } }));
      }
      reset();
      void qc.invalidateQueries({ queryKey: statusKey });
    });
  };

  return (
    <>
      <SettingsHead title={title} lead={t('settings.loginSecurity.personalLead')} />
      {recovery ? (
        <section className="col" style={{ gap: 16 }}>
          <h2>{t('settings.loginSecurity.recoveryTitle')}</h2>
          <p>{t('settings.loginSecurity.recoveryHelp')}</p>
          <ul style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, padding: 0, listStyle: 'none' }}>
            {recovery.map(item => <li key={item}><code>{item}</code></li>)}
          </ul>
          <div>
            <Button type="button" variant="primary" onClick={() => {
              setRecovery(null);
              onContinue?.();
            }}>{t('settings.loginSecurity.savedCodes')}</Button>
          </div>
        </section>
      ) : setup || disable ? (
        <form className="col" style={{ gap: 16, maxWidth: 480 }} onSubmit={submit}>
          {setup && (
            <>
              <p>{t('settings.loginSecurity.scanHelp')}</p>
              <img src={setup.qr} width={192} height={192} alt={t('settings.loginSecurity.qrAlt')} />
              <div className="field">
                <span className="label">{t('settings.loginSecurity.manualKey')}</span>
                <code style={{ overflowWrap: 'anywhere' }}>{setup.secret}</code>
              </div>
            </>
          )}
          {disable && (
            <div className="field">
              <label className="label" htmlFor={`${baseId}-proof`}>{t('settings.loginSecurity.proof')}</label>
              <select id={`${baseId}-proof`} className="select" disabled={busy} value={disable}
                onChange={e => { setDisable(e.target.value === 'code' ? 'code' : 'password'); setValue(''); setError(''); }}>
                <option value="password">{t('settings.password.current')}</option>
                <option value="code">{t('settings.loginSecurity.authenticatorCode')}</option>
              </select>
            </div>
          )}
          <div className="field">
            <label className="label" htmlFor={`${baseId}-code`}>{disable === 'password' ? t('settings.password.current') : t('settings.loginSecurity.authenticatorCode')}</label>
            <input id={`${baseId}-code`} className="input" type={disable === 'password' ? 'password' : 'text'}
              inputMode={disable === 'password' ? undefined : 'numeric'}
              autoComplete={disable === 'password' ? 'current-password' : 'one-time-code'}
              maxLength={disable === 'password' ? 1024 : 6} required disabled={busy}
              value={value} onChange={e => setValue(e.target.value)} />
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Button type="submit" variant="primary" loading={busy} disabled={disable === 'password' ? !value : !TOTP_CODE_RE.test(value.trim())}>
              {t(setup ? 'settings.loginSecurity.confirmSetup' : 'settings.loginSecurity.disable')}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={reset}>{t('settings.loginSecurity.cancel')}</Button>
          </div>
        </form>
      ) : status.isPending ? (
        <p role="status">{t('settings.loginSecurity.loading')}</p>
      ) : status.isError ? (
        <div className="col" style={{ gap: 8 }}>
          <p role="alert">{errorMessage(status.error)}</p>
          <div><Button type="button" onClick={() => void status.refetch()}>{t('settings.loginSecurity.refresh')}</Button></div>
        </div>
      ) : status.data.enabled ? (
        <>
          <SRow t={t('settings.loginSecurity.enabled')} d={t('settings.loginSecurity.remaining', { count: fmtNumber(status.data.recoveryCodesRemaining) })}>
            {continueButton ?? <Button type="button" onClick={() => setDisable('password')}>{t('settings.loginSecurity.disable')}</Button>}
          </SRow>
        </>
      ) : (
        <SRow t={t('settings.loginSecurity.disabled')} d={status.data.canSetup ? undefined : t('errors.demo_account_locked')}>
          <Button type="button" variant="primary" loading={busy} disabled={!status.data.canSetup} onClick={() => attempt(async () => {
            const { secret, otpauthUri } = await ok(api.setup.$post());
            const qr = `data:image/svg+xml,${encodeURIComponent(qrSvg(otpauthUri, 4))}`;
            setSetup({ secret, qr });
          })}>{t('settings.loginSecurity.startSetup')}</Button>
        </SRow>
      )}
      {error && <p className="err" role="alert">{error}</p>}
    </>
  );
}

function WorkspaceAccessActions({ onRetry }: { onRetry?: () => void }) {
  const t = useT();
  const { active, workspaces, switchWorkspace, signOut } = useSession();
  return (
    <div className="col" style={{ gap: 8 }}>
      {workspaces.length > 1 && (
        <label className="field">
          <span className="label">{t('settings.loginSecurity.switchWorkspace')}</span>
          <select className="select" value={active?.id} onChange={e => switchWorkspace(e.target.value)}>
            {workspaces.map(ws => <option key={ws.id} value={ws.id}>{ws.name}</option>)}
          </select>
        </label>
      )}
      {onRetry && <Button type="button" onClick={onRetry}>{t('settings.loginSecurity.refresh')}</Button>}
      <Button type="button" variant="ghost" onClick={() => { void signOut().catch(() => {}); }}>{t('settings.loginSecurity.signOut')}</Button>
    </div>
  );
}

export function TotpEnrollmentPage() {
  const t = useT();
  const { status, user, active } = useSession();
  const { state } = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const requested = state?.returnTo as unknown;
  const returnTo = typeof requested === 'string' && requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';
  const workspaceId = state?.workspaceId;
  const resume = () => {
    if (active) qc.removeQueries({ queryKey: ['ws', active.id] });
    navigate(returnTo, { replace: true });
  };
  if (status === 'loading') return null;
  if (status !== 'authed' || !user) return <Navigate to="/signin" replace />;
  if (workspaceId && workspaceId !== active?.id) return <Navigate to={returnTo} replace />;
  return (
    <AuthShell>
      <AuthCard>
        <p role="status">{t('errors.totp_required')}</p>
        <TotpSection key={user.id} title={t('settings.nav.items.twoFactor')} onContinue={resume} />
        <WorkspaceAccessActions />
      </AuthCard>
    </AuthShell>
  );
}

export function BlockedWorkspaceScreen({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <AuthShell>
      <AuthCard>
        <h1>{t('settings.nav.items.workspaceSecurity')}</h1>
        <p role="alert">{t('errors.ip_blocked')}</p>
        <WorkspaceAccessActions onRetry={onRetry} />
      </AuthCard>
    </AuthShell>
  );
}

type SecuritySettings = { require2fa: boolean; ipAllowlist: string[]; currentIp: string };

export function WorkspaceSecuritySection({ title }: { title: string }) {
  const t = useT();
  const ws = useWsId();
  const api = apiFor(ws).security;
  const qc = useQueryClient();
  const settingsKey = ['ws', ws, 'security', 'settings'] as const;
  const settings = useQuery({ queryKey: settingsKey, queryFn: () => ok(api.settings.$get()), refetchOnMount: 'always' });
  const [draft, setDraft] = React.useState<{ required?: boolean; allowlist?: string }>({});
  const required = draft.required ?? settings.data?.require2fa ?? false;
  const allowlist = draft.allowlist ?? settings.data?.ipAllowlist.join('\n') ?? '';
  const entries = allowlist.split(/[\r\n,]+/).map(entry => entry.trim()).filter(Boolean);
  const invalid = entries.find(entry => !isValidIpRange(entry));
  const lockout = !!settings.data && !invalid && !isIpAllowed(settings.data.currentIp, entries);
  const save = useMutation({
    mutationFn: (patch: Partial<Pick<SecuritySettings, 'require2fa' | 'ipAllowlist'>>) => ok(api.settings.$patch({ json: patch })),
    onSuccess: fresh => {
      qc.setQueryData(settingsKey, fresh);
      setDraft({});
      toast(t('settings.loginSecurity.settingsSaved'));
    },
  });
  const requireId = React.useId();
  const allowlistId = React.useId();

  return (
    <>
      <SettingsHead title={title} lead={t('settings.loginSecurity.workspaceLead')} />
      {settings.isPending && <p role="status">{t('settings.loginSecurity.loading')}</p>}
      {settings.isError && <p role="alert">{errorMessage(settings.error)}</p>}
      {settings.data && (
        <form className="col" style={{ gap: 16 }} onSubmit={event => {
          event.preventDefault();
          if (invalid || lockout) return;
          save.mutate({
            ...(draft.required !== undefined && { require2fa: required }),
            ...(draft.allowlist !== undefined && { ipAllowlist: entries }),
          });
        }}>
          <SRow t={<label htmlFor={requireId}>{t('settings.loginSecurity.require2fa')}</label>} d={t('settings.loginSecurity.requireHelp')}>
            <Switch id={requireId} checked={required} disabled={save.isPending} onChange={event => setDraft({ ...draft, required: event.target.checked })} />
          </SRow>
          <div className="field">
            <label className="label" htmlFor={allowlistId}>{t('settings.loginSecurity.allowlist')}</label>
            <textarea className="input" rows={5} style={{ height: 'auto' }} id={allowlistId} value={allowlist}
              spellCheck={false} disabled={save.isPending} aria-describedby={`${allowlistId}-help`}
              onChange={event => setDraft({ ...draft, allowlist: event.target.value })} placeholder={'192.168.1.0/24\n2001:db8::/32'} />
            <p className="hint" id={`${allowlistId}-help`}>{t('settings.loginSecurity.allowlistHelp')}</p>
            <p className="hint">{t('settings.loginSecurity.currentIp', { ip: settings.data.currentIp })}</p>
            {invalid && <p className="err" role="alert">{t('errors.invalid_ip_range', { entry: invalid })}</p>}
            {lockout && <p className="err" role="alert">{t('errors.ip_self_lockout')}</p>}
            {save.isError && <p className="err" role="alert">{errorMessage(save.error)}</p>}
          </div>
          <div><Button type="submit" variant="primary" loading={save.isPending}
            disabled={!!invalid || lockout || Object.keys(draft).length === 0}>{t('settings.loginSecurity.saveSettings')}</Button></div>
        </form>
      )}
      <LoginLog />
    </>
  );
}

function LoginLog() {
  const t = useT();
  const ws = useWsId();
  const [offset, setOffset] = React.useState(0);
  const { data, error, isPending, isFetching, refetch } = useQuery({
    queryKey: ['ws', ws, 'security', 'login-log', offset],
    queryFn: () => ok(apiFor(ws).security['login-log'].$get({ query: { offset: String(offset) } })),
    refetchOnMount: 'always',
    refetchInterval: offset === 0 ? 30_000 : false,
  });

  return (
    <section className="col" style={{ gap: 16, marginTop: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <h2>{t('settings.loginSecurity.logTitle')}</h2>
        <Button type="button" disabled={isFetching} onClick={() => void refetch()}>{t('settings.loginSecurity.refresh')}</Button>
      </div>
      {isPending && <p role="status">{t('settings.loginSecurity.loading')}</p>}
      {error && <p role="alert">{errorMessage(error)}</p>}
      {data && (data.items.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table className="perm-t">
            <caption className="sr-only">{t('settings.loginSecurity.logTitle')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('settings.loginSecurity.columns.time')}</th>
                <th scope="col">{t('pages.auth.email')}</th>
                <th scope="col">{t('settings.loginSecurity.columns.ip')}</th>
                <th scope="col">{t('settings.loginSecurity.columns.method')}</th>
                <th scope="col">{t('settings.loginSecurity.columns.status')}</th>
                <th scope="col">{t('settings.loginSecurity.columns.agent')}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map(item => (
                <tr key={item.id}>
                  <td>{fmtDateTime(item.createdAt)}</td>
                  <td>{item.email}</td>
                  <td><code>{item.ip}</code></td>
                  <td>{t(item.viaApiToken ? 'settings.loginSecurity.method.token' : `settings.loginSecurity.method.${item.method}`)}</td>
                  <td>{t(`settings.loginSecurity.status.${item.status}`)}</td>
                  <td style={{ minWidth: 160, overflowWrap: 'anywhere' }}>{item.userAgent ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p>{t('settings.loginSecurity.emptyLog')}</p>)}
      {(offset > 0 || data?.hasMore) && (
        <div className="row" style={{ gap: 8 }}>
          <Button type="button" disabled={offset === 0 || isFetching} onClick={() => setOffset(n => Math.max(0, n - 50))}>{t('settings.loginSecurity.previous')}</Button>
          <Button type="button" disabled={!data?.hasMore || isFetching} onClick={() => setOffset(n => n + 50)}>{t('settings.loginSecurity.next')}</Button>
        </div>
      )}
    </section>
  );
}
