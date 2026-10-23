/* Вход, регистрация, восстановление пароля, подтверждение почты — порт renderAuth и действий doLogin/doSignup/doForgot/doReset из pages/auth.js и actions/actions.js */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, CircleCheck, Eye, EyeOff, KeyRound, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui';
import { Logo } from '../components/brand';
import { AuthCard, AuthShell, FieldErr, SocialButtons, StrengthMeter, useBusy, useLoading } from '../components/auth-shell';
import { errorMessage } from '../data/api';
import { useSession } from '../data/session';
import { EMAIL_RE, authForm, pwWeak } from '../lib/auth';
import { SECTIONS } from '../routes';
import { useT } from '@/i18n';

/** Иконка в цветной плашке над заголовком (ftype 44×44) */
const Badge = ({ color, children }: { color: string; children: React.ReactNode }) => (
  <div style={{ display: 'flex', justifyContent: 'center' }}>
    <span className="ftype" style={{ '--c': color, width: 44, height: 44, borderRadius: 11 } as React.CSSProperties}>
      {children}
    </span>
  </div>
);

/** Вход через внешних провайдеров (OAuth) появится отдельным этапом */
const useSocialSoon = (tr: ReturnType<typeof useT>) => (name: string) =>
  toast.info(tr('pages.auth.socialSoon', { name }));

export function SignInPage() {
  const tr = useT();
  const socialSoon = useSocialSoon(tr);
  const navigate = useNavigate();
  const session = useSession();
  const [email, setEmail] = React.useState(authForm.email);
  const [pw, setPw] = React.useState('');
  const [show, setShow] = React.useState(false);
  const [err, setErr] = React.useState<{ email?: string; pw?: string }>({});
  const [busy, run] = useBusy();
  const emailRef = React.useRef<HTMLInputElement>(null);
  const pwRef = React.useRef<HTMLInputElement>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const em = email.trim();
    const x: typeof err = {};
    authForm.email = em;
    if (!em) x.email = tr('pages.auth.err.emailMissing');
    else if (!EMAIL_RE.test(em)) x.email = tr('pages.auth.err.emailInvalid');
    if (!pw) x.pw = tr('pages.auth.err.pwMissing');
    setErr(x);
    if (x.email || x.pw) {
      (x.email ? emailRef : pwRef).current?.focus();
      return;
    }
    void run(async () => {
      try {
        await session.signIn(em, pw);
        navigate(SECTIONS.home.path, { replace: true });
        toast(tr('pages.auth.signedIn', { email: em }));
      } catch (e) {
        setErr({ pw: errorMessage(e) });
        pwRef.current?.focus();
      }
    });
  };

  return (
    <AuthShell
      topRight={
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/signup')}>
          {tr('pages.auth.signUp')}
        </button>
      }
    >
      <AuthCard as="form" noValidate onSubmit={submit}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Logo height={30} />
        </div>
        <h1>{tr('pages.auth.welcomeBack')}</h1>
        <p className="sub">{tr('pages.auth.signInSub')}</p>
        <div className="field">
          <label className="label" htmlFor="l-email">
            {tr('pages.auth.email')}
          </label>
          <input ref={emailRef} className={cn('input input-lg', err.email && 'is-error')} id="l-email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" aria-invalid={!!err.email} aria-describedby="email-err" />
          <FieldErr id="email-err">{err.email}</FieldErr>
        </div>
        <div className="field">
          <div className="row">
            <label className="label" htmlFor="l-pw">
              {tr('pages.auth.password')}
            </label>
            <span className="sp"></span>
            <button type="button" className="link" style={{ fontSize: 12.5 }} onClick={() => navigate('/forgot')}>
              {tr('pages.auth.forgot')}
            </button>
          </div>
          <div className="inwrap">
            <input ref={pwRef} className={cn('input input-lg', err.pw && 'is-error')} id="l-pw" type={show ? 'text' : 'password'} value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password" style={{ paddingRight: 38 }} aria-invalid={!!err.pw} />
            <button type="button" className="ibtn ibtn-sm" style={{ position: 'absolute', right: 5 }} aria-label={`${show ? tr('pages.auth.hidePw') : tr('pages.auth.showPw')}`} onClick={() => setShow(s => !s)}>
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <FieldErr>{err.pw}</FieldErr>
        </div>
        <label className="row" style={{ fontSize: 13, gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" className="check" id="l-rem" defaultChecked />
          {tr('pages.auth.remember')}
        </label>
        <button type="submit" className={cn('btn btn-primary btn-lg btn-block', busy && 'is-loading')} disabled={busy} id="login-btn">
          {tr('pages.auth.signIn')}
        </button>
        <div className="or">{tr('pages.auth.or')}</div>
        <SocialButtons onPick={socialSoon} busy={null} />
        <p className="auth-foot">
          {tr('pages.auth.noAccount')}{' '}
          <button type="button" className="link" onClick={() => navigate('/signup')}>
            {tr('pages.auth.signUp')}
          </button>
        </p>
      </AuthCard>
    </AuthShell>
  );
}

export function SignUpPage() {
  const tr = useT();
  const socialSoon = useSocialSoon(tr);
  const navigate = useNavigate();
  const session = useSession();
  const [name, setName] = React.useState(authForm.name);
  const [email, setEmail] = React.useState('');
  const [pw, setPw] = React.useState('');
  const [err, setErr] = React.useState<{ name?: string; email?: string; pw?: string }>({});
  const [busy, run] = useBusy();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const nm = name.trim();
    const em = email.trim();
    const x: typeof err = {};
    authForm.name = nm;
    authForm.email = em;
    if (!nm) x.name = tr('pages.auth.err.nameMissing');
    if (!EMAIL_RE.test(em)) x.email = tr('pages.auth.err.emailInvalidWork');
    if (pwWeak(pw)) x.pw = tr('pages.auth.pwRule');
    setErr(x);
    if (x.name || x.email || x.pw) return;
    void run(async () => {
      try {
        await session.signUp({ email: em, password: pw, name: nm });
        navigate('/onboarding', { replace: true });
      } catch (e) {
        const msg = errorMessage(e);
        setErr(/email/i.test(msg) ? { email: msg } : { pw: msg });
      }
    });
  };

  return (
    <AuthShell
      topRight={
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/signin')}>
          {tr('pages.auth.signIn')}
        </button>
      }
    >
      <AuthCard as="form" noValidate onSubmit={submit}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Logo height={30} />
        </div>
        <h1>{tr('pages.auth.createAccount')}</h1>
        <p className="sub">{tr('pages.auth.signUpSub')}</p>
        <SocialButtons onPick={socialSoon} busy={null} />
        <div className="or">{tr('pages.auth.orSignUpEmail')}</div>
        <div className="field">
          <label className="label" htmlFor="s-name">
            {tr('pages.auth.fullName')}
          </label>
          <input className={cn('input input-lg', err.name && 'is-error')} id="s-name" value={name} onChange={e => setName(e.target.value)} autoComplete="name" placeholder={tr('pages.auth.fullNamePlaceholder')} />
          <FieldErr>{err.name}</FieldErr>
        </div>
        <div className="field">
          <label className="label" htmlFor="s-email">
            {tr('pages.auth.workEmail')}
          </label>
          <input className={cn('input input-lg', err.email && 'is-error')} id="s-email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" placeholder={tr('pages.auth.workEmailPlaceholder')} />
          <FieldErr>{err.email}</FieldErr>
        </div>
        <div className="field">
          <label className="label" htmlFor="s-pw">
            {tr('pages.auth.password')}
          </label>
          <input className={cn('input input-lg', err.pw && 'is-error')} id="s-pw" type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" />
          <StrengthMeter pw={pw} />
          {err.pw ? <FieldErr>{err.pw}</FieldErr> : <span className="hint">{tr('pages.auth.pwHint')}</span>}
        </div>
        <button type="submit" className={cn('btn btn-primary btn-lg btn-block', busy && 'is-loading')} disabled={busy} id="signup-btn">
          {tr('pages.auth.createAccountBtn')}
        </button>
        <p className="hint" style={{ textAlign: 'center' }}>
          {tr('pages.auth.termsNotice')}
        </p>
        <p className="auth-foot">
          {tr('pages.auth.haveAccount')}{' '}
          <button type="button" className="link" onClick={() => navigate('/signin')}>
            {tr('pages.auth.signIn')}
          </button>
        </p>
      </AuthCard>
    </AuthShell>
  );
}

const BackToSignIn = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <button type="button" className="link row" style={{ display: 'inline-flex', gap: 6 }} onClick={onClick}>
    <ArrowLeft size={14} />
    {label}
  </button>
);

export function ForgotPage() {
  const tr = useT();
  const navigate = useNavigate();
  const [email, setEmail] = React.useState(authForm.email);
  const [err, setErr] = React.useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const em = email.trim();
    authForm.email = em;
    if (!EMAIL_RE.test(em)) {
      setErr(tr('pages.auth.err.emailNoAccount'));
      return;
    }
    setErr('');
    toast.info(tr('pages.auth.resetUnavailable'));
  };

  return (
    <AuthShell>
      <AuthCard as="form" noValidate onSubmit={submit}>
        <Badge color="var(--accent)">
          <KeyRound size={20} />
        </Badge>
        <h1>{tr('pages.auth.resetTitle')}</h1>
        <p className="sub">{tr('pages.auth.resetSub')}</p>
        <div className="field">
          <label className="label" htmlFor="f-email">
            {tr('pages.auth.email')}
          </label>
          <input className={cn('input input-lg', err && 'is-error')} id="f-email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
          <FieldErr>{err}</FieldErr>
        </div>
        <button type="submit" className="btn btn-primary btn-lg btn-block" id="forgot-btn">
          {tr('pages.auth.sendReset')}
        </button>
        <p className="auth-foot">
          <BackToSignIn onClick={() => navigate('/signin')} label={tr('pages.auth.backToSignIn')} />
        </p>
      </AuthCard>
    </AuthShell>
  );
}

export function ResetPage() {
  const tr = useT();
  const navigate = useNavigate();
  const [done, setDone] = React.useState(false);
  const [pw, setPw] = React.useState('');
  const [pw2, setPw2] = React.useState('');
  const [err, setErr] = React.useState<{ pw?: string; pw2?: string }>({});
  const [busy, run] = useLoading(700);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const x: typeof err = {};
    if (pwWeak(pw)) x.pw = tr('pages.auth.pwRule');
    if (pw !== pw2) x.pw2 = tr('pages.auth.err.pwMismatch');
    setErr(x);
    if (x.pw || x.pw2) return;
    run(() => setDone(true));
  };

  if (done)
    return (
      <AuthShell>
        <AuthCard>
          <Badge color="var(--green)">
            <CircleCheck size={20} />
          </Badge>
          <h1>{tr('pages.auth.passwordUpdated')}</h1>
          <p className="sub">{tr('pages.auth.passwordUpdatedSub')}</p>
          <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => navigate('/signin')}>
            {tr('pages.auth.signIn')}
          </button>
        </AuthCard>
      </AuthShell>
    );

  return (
    <AuthShell>
      <AuthCard as="form" noValidate onSubmit={submit}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Logo height={30} />
        </div>
        <h1>{tr('pages.auth.chooseNewPw')}</h1>
        <p className="sub">{tr('pages.auth.chooseNewPwSub', { email: authForm.email })}</p>
        <div className="field">
          <label className="label" htmlFor="r-pw">
            {tr('pages.auth.newPassword')}
          </label>
          <input className={cn('input input-lg', err.pw && 'is-error')} id="r-pw" type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" />
          <StrengthMeter pw={pw} />
          <FieldErr>{err.pw}</FieldErr>
        </div>
        <div className="field">
          <label className="label" htmlFor="r-pw2">
            {tr('pages.auth.confirmPassword')}
          </label>
          <input className={cn('input input-lg', err.pw2 && 'is-error')} id="r-pw2" type="password" value={pw2} onChange={e => setPw2(e.target.value)} autoComplete="new-password" />
          <FieldErr>{err.pw2}</FieldErr>
        </div>
        <button type="submit" className={cn('btn btn-primary btn-lg btn-block', busy && 'is-loading')} disabled={busy} id="reset-btn">
          {tr('pages.auth.resetPassword')}
        </button>
      </AuthCard>
    </AuthShell>
  );
}

export function VerifyPage() {
  const tr = useT();
  const navigate = useNavigate();
  const [left, setLeft] = React.useState(30);
  React.useEffect(() => {
    if (left <= 0) return;
    const t = window.setTimeout(() => setLeft(l => l - 1), 1000);
    return () => window.clearTimeout(t);
  }, [left]);

  return (
    <AuthShell>
      <AuthCard>
        <Badge color="var(--accent)">
          <Mail size={20} />
        </Badge>
        <h1>{tr('pages.auth.verifyTitle')}</h1>
        <p className="sub">
          {tr('pages.auth.verifySubBefore')} <b style={{ color: 'var(--text)' }}>{authForm.email}</b>{' '}{tr('pages.auth.verifySubAfter')}
        </p>
        <div className="panel" style={{ padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className="sk" style={{ width: 8, height: 8, borderRadius: '50%', animationDuration: '1.1s' }}></span>
          <span className="muted" style={{ fontSize: 13 }}>
            {tr('pages.auth.waitingVerify')}
          </span>
        </div>
        <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => navigate('/onboarding')}>
          {tr('pages.auth.verified')}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-lg btn-block"
          disabled={left > 0}
          onClick={() => {
            setLeft(30);
            toast(tr('pages.auth.resentEmail', { email: authForm.email }));
          }}
        >
          {left > 0 ? (
            <>
              {tr('pages.auth.resendIn')} <span className="num">{left}</span>{tr('pages.auth.seconds')}
            </>
          ) : (
            tr('pages.auth.resend')
          )}
        </button>
        <p className="auth-foot">
          {tr('pages.auth.wrongEmail')}{' '}
          <button type="button" className="link" onClick={() => navigate('/signup')}>
            {tr('pages.auth.changeIt')}
          </button>
        </p>
      </AuthCard>
    </AuthShell>
  );
}
