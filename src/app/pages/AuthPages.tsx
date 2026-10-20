/* Вход, регистрация, восстановление пароля, подтверждение почты — порт renderAuth и действий doLogin/doSignup/doForgot/doReset из pages/auth.js и actions/actions.js */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, CircleCheck, Eye, EyeOff, Info, KeyRound, Mail, MailCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui';
import { Logo } from '../components/brand';
import { AuthCard, AuthShell, FieldErr, SocialButtons, StrengthMeter, useLoading } from '../components/auth-shell';
import { useWorkspace } from '../data/store';
import { EMAIL_RE, authForm, pwWeak, setSignedIn } from '../lib/auth';
import { SECTIONS } from '../routes';

/** Иконка в цветной плашке над заголовком (ftype 44×44) */
const Badge = ({ color, children }: { color: string; children: React.ReactNode }) => (
  <div style={{ display: 'flex', justifyContent: 'center' }}>
    <span className="ftype" style={{ '--c': color, width: 44, height: 44, borderRadius: 11 } as React.CSSProperties}>
      {children}
    </span>
  </div>
);

const PW_RULE = 'Use at least 10 characters, including a number or symbol';

/** Вход в приложение: флаг «вошёл» и переход на главную */
function useEnterApp() {
  const navigate = useNavigate();
  return (msg: string) => {
    setSignedIn(true);
    navigate(SECTIONS.home.path, { replace: true });
    toast(msg);
  };
}

export function SignInPage() {
  const navigate = useNavigate();
  const { data } = useWorkspace();
  const enter = useEnterApp();
  const [email, setEmail] = React.useState(authForm.email);
  const [pw, setPw] = React.useState('');
  const [show, setShow] = React.useState(false);
  const [err, setErr] = React.useState<{ email?: string; pw?: string }>({});
  const [busy, run] = useLoading(750);
  const [social, setSocial] = React.useState<string | null>(null);
  const emailRef = React.useRef<HTMLInputElement>(null);
  const pwRef = React.useRef<HTMLInputElement>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const em = email.trim();
    const x: typeof err = {};
    authForm.email = em;
    if (!em) x.email = 'Enter your email address';
    else if (!EMAIL_RE.test(em)) x.email = 'Enter a valid email, like name@company.com';
    if (!pw) x.pw = 'Enter your password';
    setErr(x);
    if (x.email || x.pw) {
      (x.email ? emailRef : pwRef).current?.focus();
      return;
    }
    run(() => enter(`Signed in as ${em}`));
  };
  const pick = (name: string) => {
    setSocial(name);
    window.setTimeout(() => enter(`Signed in with ${name}`), 800);
  };

  return (
    <AuthShell
      topRight={
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/signup')}>
          Sign up
        </button>
      }
    >
      <AuthCard as="form" noValidate onSubmit={submit}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Logo height={30} />
        </div>
        <h1>Welcome back</h1>
        <p className="sub">Sign in to {data.ws.name}</p>
        <div className="field">
          <label className="label" htmlFor="l-email">
            Email
          </label>
          <input ref={emailRef} className={cn('input input-lg', err.email && 'is-error')} id="l-email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" aria-invalid={!!err.email} aria-describedby="email-err" />
          <FieldErr id="email-err">{err.email}</FieldErr>
        </div>
        <div className="field">
          <div className="row">
            <label className="label" htmlFor="l-pw">
              Password
            </label>
            <span className="sp"></span>
            <button type="button" className="link" style={{ fontSize: 12.5 }} onClick={() => navigate('/forgot')}>
              Forgot password?
            </button>
          </div>
          <div className="inwrap">
            <input ref={pwRef} className={cn('input input-lg', err.pw && 'is-error')} id="l-pw" type={show ? 'text' : 'password'} value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password" style={{ paddingRight: 38 }} aria-invalid={!!err.pw} />
            <button type="button" className="ibtn ibtn-sm" style={{ position: 'absolute', right: 5 }} aria-label={`${show ? 'Hide' : 'Show'} password`} onClick={() => setShow(s => !s)}>
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <FieldErr>{err.pw}</FieldErr>
        </div>
        <label className="row" style={{ fontSize: 13, gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" className="check" id="l-rem" defaultChecked />
          Remember me for 30 days
        </label>
        <button type="submit" className={cn('btn btn-primary btn-lg btn-block', busy && 'is-loading')} disabled={busy} id="login-btn">
          Sign in
        </button>
        <div className="or">or</div>
        <SocialButtons onPick={pick} busy={social} />
        <p className="auth-foot">
          Don't have an account?{' '}
          <button type="button" className="link" onClick={() => navigate('/signup')}>
            Sign up
          </button>
        </p>
      </AuthCard>
    </AuthShell>
  );
}

export function SignUpPage() {
  const navigate = useNavigate();
  const enter = useEnterApp();
  const [name, setName] = React.useState(authForm.name);
  const [email, setEmail] = React.useState('');
  const [pw, setPw] = React.useState('');
  const [err, setErr] = React.useState<{ name?: string; email?: string; pw?: string }>({});
  const [busy, run] = useLoading(800);
  const [social, setSocial] = React.useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const nm = name.trim();
    const em = email.trim();
    const x: typeof err = {};
    authForm.name = nm;
    authForm.email = em;
    if (!nm) x.name = 'Enter your name';
    if (!EMAIL_RE.test(em)) x.email = 'Enter a valid work email';
    if (pwWeak(pw)) x.pw = PW_RULE;
    setErr(x);
    if (x.name || x.email || x.pw) return;
    run(() => navigate('/verify'));
  };
  const pick = (n: string) => {
    setSocial(n);
    window.setTimeout(() => enter(`Signed in with ${n}`), 800);
  };

  return (
    <AuthShell
      topRight={
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/signin')}>
          Log in
        </button>
      }
    >
      <AuthCard as="form" noValidate onSubmit={submit}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Logo height={30} />
        </div>
        <h1>Create your account</h1>
        <p className="sub">Free for up to 3 members. No credit card required.</p>
        <SocialButtons onPick={pick} busy={social} />
        <div className="or">or sign up with email</div>
        <div className="field">
          <label className="label" htmlFor="s-name">
            Full name
          </label>
          <input className={cn('input input-lg', err.name && 'is-error')} id="s-name" value={name} onChange={e => setName(e.target.value)} autoComplete="name" placeholder="Tanjim Islam" />
          <FieldErr>{err.name}</FieldErr>
        </div>
        <div className="field">
          <label className="label" htmlFor="s-email">
            Work email
          </label>
          <input className={cn('input input-lg', err.email && 'is-error')} id="s-email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" placeholder="you@company.com" />
          <FieldErr>{err.email}</FieldErr>
        </div>
        <div className="field">
          <label className="label" htmlFor="s-pw">
            Password
          </label>
          <input className={cn('input input-lg', err.pw && 'is-error')} id="s-pw" type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" />
          <StrengthMeter pw={pw} />
          {err.pw ? <FieldErr>{err.pw}</FieldErr> : <span className="hint">At least 10 characters with a number or symbol.</span>}
        </div>
        <button type="submit" className={cn('btn btn-primary btn-lg btn-block', busy && 'is-loading')} disabled={busy} id="signup-btn">
          Create account
        </button>
        <p className="hint" style={{ textAlign: 'center' }}>
          By creating an account you agree to the Terms and Privacy Policy.
        </p>
        <p className="auth-foot">
          Already have an account?{' '}
          <button type="button" className="link" onClick={() => navigate('/signin')}>
            Sign in
          </button>
        </p>
      </AuthCard>
    </AuthShell>
  );
}

const BackToSignIn = ({ onClick }: { onClick: () => void }) => (
  <button type="button" className="link row" style={{ display: 'inline-flex', gap: 6 }} onClick={onClick}>
    <ArrowLeft size={14} />
    Back to sign in
  </button>
);

/** Восстановление: форма, затем «Check your email»; ссылка из письма в прототипе — кнопка */
export function ForgotPage() {
  const navigate = useNavigate();
  const [sent, setSent] = React.useState(false);
  const [email, setEmail] = React.useState(authForm.email);
  const [err, setErr] = React.useState('');
  const [busy, run] = useLoading(700);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const em = email.trim();
    authForm.email = em;
    if (!EMAIL_RE.test(em)) {
      setErr('Enter the email you use to sign in');
      return;
    }
    setErr('');
    run(() => setSent(true));
  };

  if (sent)
    return (
      <AuthShell>
        <AuthCard>
          <Badge color="var(--green)">
            <MailCheck size={20} />
          </Badge>
          <h1>Check your email</h1>
          <p className="sub">
            We sent a reset link to <b style={{ color: 'var(--text)' }}>{authForm.email}</b>. It expires in 30 minutes.
          </p>
          <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => navigate('/reset')}>
            Open reset link
          </button>
          <div className="alert info">
            <Info size={14} />
            <span>In this prototype, the button above stands in for the link in your email.</span>
          </div>
          <p className="auth-foot">
            Didn't get it?{' '}
            <button type="button" className="link" onClick={() => toast(`Reset link sent to ${authForm.email}`)}>
              Resend email
            </button>
          </p>
          <p className="auth-foot">
            <BackToSignIn onClick={() => navigate('/signin')} />
          </p>
        </AuthCard>
      </AuthShell>
    );

  return (
    <AuthShell>
      <AuthCard as="form" noValidate onSubmit={submit}>
        <Badge color="var(--accent)">
          <KeyRound size={20} />
        </Badge>
        <h1>Reset your password</h1>
        <p className="sub">Enter your account email and we'll send you a reset link.</p>
        <div className="field">
          <label className="label" htmlFor="f-email">
            Email
          </label>
          <input className={cn('input input-lg', err && 'is-error')} id="f-email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
          <FieldErr>{err}</FieldErr>
        </div>
        <button type="submit" className={cn('btn btn-primary btn-lg btn-block', busy && 'is-loading')} disabled={busy} id="forgot-btn">
          Send reset link
        </button>
        <p className="auth-foot">
          <BackToSignIn onClick={() => navigate('/signin')} />
        </p>
      </AuthCard>
    </AuthShell>
  );
}

/** Новый пароль: форма, затем «Password updated» */
export function ResetPage() {
  const navigate = useNavigate();
  const [done, setDone] = React.useState(false);
  const [pw, setPw] = React.useState('');
  const [pw2, setPw2] = React.useState('');
  const [err, setErr] = React.useState<{ pw?: string; pw2?: string }>({});
  const [busy, run] = useLoading(700);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const x: typeof err = {};
    if (pwWeak(pw)) x.pw = PW_RULE;
    if (pw !== pw2) x.pw2 = "Passwords don't match";
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
          <h1>Password updated</h1>
          <p className="sub">You can now sign in with your new password.</p>
          <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => navigate('/signin')}>
            Sign in
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
        <h1>Choose a new password</h1>
        <p className="sub">for {authForm.email}</p>
        <div className="field">
          <label className="label" htmlFor="r-pw">
            New password
          </label>
          <input className={cn('input input-lg', err.pw && 'is-error')} id="r-pw" type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" />
          <StrengthMeter pw={pw} />
          <FieldErr>{err.pw}</FieldErr>
        </div>
        <div className="field">
          <label className="label" htmlFor="r-pw2">
            Confirm password
          </label>
          <input className={cn('input input-lg', err.pw2 && 'is-error')} id="r-pw2" type="password" value={pw2} onChange={e => setPw2(e.target.value)} autoComplete="new-password" />
          <FieldErr>{err.pw2}</FieldErr>
        </div>
        <button type="submit" className={cn('btn btn-primary btn-lg btn-block', busy && 'is-loading')} disabled={busy} id="reset-btn">
          Reset password
        </button>
      </AuthCard>
    </AuthShell>
  );
}

/** Подтверждение почты после регистрации; повторная отправка доступна через 30 с */
export function VerifyPage() {
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
        <h1>Verify your email</h1>
        <p className="sub">
          We sent a verification link to <b style={{ color: 'var(--text)' }}>{authForm.email}</b>. Click it to activate your account.
        </p>
        <div className="panel" style={{ padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className="sk" style={{ width: 8, height: 8, borderRadius: '50%', animationDuration: '1.1s' }}></span>
          <span className="muted" style={{ fontSize: 13 }}>
            Waiting for verification…
          </span>
        </div>
        <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => navigate('/onboarding')}>
          I've verified my email
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-lg btn-block"
          disabled={left > 0}
          onClick={() => {
            setLeft(30);
            toast(`Verification email sent to ${authForm.email}`);
          }}
        >
          {left > 0 ? (
            <>
              Resend email in <span className="num">{left}</span>s
            </>
          ) : (
            'Resend email'
          )}
        </button>
        <p className="auth-foot">
          Wrong email?{' '}
          <button type="button" className="link" onClick={() => navigate('/signup')}>
            Change it
          </button>
        </p>
      </AuthCard>
    </AuthShell>
  );
}
