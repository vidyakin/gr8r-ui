/* Настройки: Security и Billing — порт ветвей password, sessions, 2fa, plan, payment, invoices из settingsBody (pages/settings.js).
   Смена пароля, 2FA, оплата и тарифы зависят от бэкенда: формы валидируют ввод и показывают тосты, реального действия нет. */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { Check, CircleAlert, CircleCheck, CreditCard, Gem, LogOut, Monitor, ShieldAlert, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { Badge, Button, toast } from '@/components/ui';
import { useWorkspace } from '../data/store';
import { useSettings, type Plan } from '../data/settings';
import { dOff, fmtDate } from '../lib/dates';
import { ConfirmModal, type ConfirmSpec } from '../overlays/project-dialogs';
import { SECTIONS } from '../routes';
import { PasswordStrength, SRow, SettingsHead } from './parts';

const ErrText = ({ children }: { children: React.ReactNode }) => (
  <span className="err">
    <CircleAlert size={12} />
    {children}
  </span>
);

/** Окно подтверждения секции; spec = null — закрыто */
function useConfirm() {
  const [spec, setSpec] = React.useState<ConfirmSpec | null>(null);
  return [spec && <ConfirmModal spec={spec} onClose={() => setSpec(null)} />, setSpec] as const;
}

/* ---------- Security ---------- */

export function PasswordSection({ title }: { title: string }) {
  const [cur, setCur] = React.useState('');
  const [pw, setPw] = React.useState('');
  const [conf, setConf] = React.useState('');
  const [e, setE] = React.useState<{ cur?: string; pw?: string; conf?: string }>({});
  const [done, setDone] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    if (!saving) return;
    const t = setTimeout(() => {
      setSaving(false);
      setDone(true);
      setCur('');
      setPw('');
      setConf('');
      toast('Password updated');
    }, 800);
    return () => clearTimeout(t);
  }, [saving]);
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const n: typeof e = {};
    setDone(false);
    if (!cur) n.cur = 'Enter your current password';
    if (pw.length < 10 || !/[0-9\W]/.test(pw)) n.pw = 'Use at least 10 characters, including a number or symbol';
    if (pw !== conf) n.conf = "Passwords don't match";
    setE(n);
    if (!Object.keys(n).length) setSaving(true);
  };
  return (
    <>
      <SettingsHead title={title} lead="Use a long password you don't use anywhere else." />
      {done && (
        <div className="alert ok" style={{ marginBottom: 14 }}>
          <CircleCheck size={15} />
          <span>Password updated. Other sessions stay signed in.</span>
        </div>
      )}
      <form onSubmit={submit} className="col" style={{ gap: 14, maxWidth: 400 }}>
        <div className="field">
          <label className="label" htmlFor="pw-cur">
            Current password
          </label>
          <input type="password" className={`input ${e.cur ? 'is-error' : ''}`} id="pw-cur" autoComplete="current-password" value={cur} onChange={x => setCur(x.target.value)} />
          {e.cur && <ErrText>{e.cur}</ErrText>}
        </div>
        <div className="field">
          <label className="label" htmlFor="pw-new">
            New password
          </label>
          <input type="password" className={`input ${e.pw ? 'is-error' : ''}`} id="pw-new" autoComplete="new-password" value={pw} onChange={x => setPw(x.target.value)} />
          <PasswordStrength value={pw} />
          {e.pw ? <ErrText>{e.pw}</ErrText> : <span className="hint">At least 10 characters with a number or symbol.</span>}
        </div>
        <div className="field">
          <label className="label" htmlFor="pw-conf">
            Confirm new password
          </label>
          <input type="password" className={`input ${e.conf ? 'is-error' : ''}`} id="pw-conf" autoComplete="new-password" value={conf} onChange={x => setConf(x.target.value)} />
          {e.conf && <ErrText>{e.conf}</ErrText>}
        </div>
        <div>
          <Button variant="primary" type="submit" loading={saving}>
            Update password
          </Button>
        </div>
      </form>
    </>
  );
}

export function SessionsSection({ title }: { title: string }) {
  const [s, set] = useSettings();
  const [dlg, ask] = useConfirm();
  return (
    <>
      <SettingsHead title={title} lead="Devices currently signed in to your account." />
      {s.sessions.map(x => (
        <SRow
          key={x.id}
          t={
            <span className="row" style={{ gap: 8 }}>
              {x.dev.includes('iPhone') ? <Smartphone size={15} /> : <Monitor size={15} />}
              {x.dev}
              {x.cur && <Badge tone="green">This device</Badge>}
            </span>
          }
          d={`${x.loc} · ${x.at}`}
        >
          {!x.cur && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                set({ sessions: s.sessions.filter(y => y.id !== x.id) });
                toast('Session signed out');
              }}
            >
              Sign out
            </Button>
          )}
        </SRow>
      ))}
      <div style={{ marginTop: 16 }}>
        <Button
          variant="danger-ghost"
          disabled={s.sessions.length <= 1}
          onClick={() =>
            ask({
              title: 'Sign out of all other sessions?',
              body: "You'll stay signed in on this device. Other devices will need to sign in again.",
              ok: 'Sign out others',
              danger: true,
              icon: LogOut,
              run: () => {
                set({ sessions: s.sessions.filter(y => y.cur) });
                toast('Signed out of other sessions');
              },
            })
          }
        >
          Sign out of all other sessions
        </Button>
      </div>
      {dlg}
    </>
  );
}

const RECOVERY = ['7KQ2-M8PX', 'D4TN-9WRE', 'HV3C-QZ6L', 'P2YB-J7SK', 'R9FG-4NUD', 'X6MA-T3HE'];

/** Заглушка QR-кода: 11×11 клеток с тремя «позиционными» метками, как в оригинале */
function QrStub() {
  return (
    <div style={{ width: 132, height: 132, display: 'grid', gridTemplateColumns: 'repeat(11,1fr)', gap: 1, padding: 8, background: '#fff', borderRadius: 8, border: '1px solid var(--border)' }} aria-label="QR code">
      {Array.from({ length: 121 }, (_, i) => {
        const r = Math.floor(i / 11);
        const c = i % 11;
        const f = (r < 3 && c < 3) || (r < 3 && c > 7) || (r > 7 && c < 3);
        const on = f ? !((r === 1 && c === 1) || (r === 1 && c === 9) || (r === 9 && c === 1)) : (i * 7919) % 13 < 6;
        return <i key={i} style={{ background: on ? '#1D1C1A' : '#fff' }} />;
      })}
    </div>
  );
}

export function TwoFactorSection({ title }: { title: string }) {
  const [s, set] = useSettings();
  const [setup, setSetup] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [err, setErr] = React.useState('');
  const [dlg, ask] = useConfirm();
  const verify = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) return setErr('Enter the 6-digit code from your app');
    setErr('');
    setSetup(false);
    setCode('');
    set({ tfa: true });
    toast('Two-factor authentication enabled');
  };
  return (
    <>
      <SettingsHead title={title} lead="Add a second step when signing in." />
      {s.tfa ? (
        <>
          <div className="alert ok">
            <ShieldCheck size={16} />
            <div>
              <b>Two-factor authentication is on.</b>
              <div className="muted">You'll enter a code from your authenticator app when signing in on a new device.</div>
            </div>
          </div>
          <div className="sblock">
            <h2>Recovery codes</h2>
            <p className="muted" style={{ fontSize: 13, margin: '1em 0' }}>
              Store these somewhere safe. Each code works once.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,max-content)', gap: '6px 28px', fontFamily: 'var(--mono)', fontSize: 13, padding: 14, border: '1px solid var(--border)', borderRadius: 'var(--r)', background: 'var(--sunken)', userSelect: 'all' }}>
              {RECOVERY.map(c => (
                <span key={c}>{c}</span>
              ))}
            </div>
            <div style={{ marginTop: 14 }}>
              <Button
                variant="danger-ghost"
                onClick={() =>
                  ask({
                    title: 'Turn off two-factor authentication?',
                    body: 'Your account will be protected by your password only.',
                    ok: 'Turn off',
                    danger: true,
                    icon: ShieldOff,
                    run: () => {
                      set({ tfa: false });
                      toast('Two-factor authentication turned off');
                    },
                  })
                }
              >
                Turn off two-factor authentication
              </Button>
            </div>
          </div>
        </>
      ) : setup ? (
        <div className="panel" style={{ padding: 18, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <QrStub />
          <div className="grow col" style={{ gap: 10, minWidth: 220 }}>
            <div>
              <b>1. Scan the QR code</b>
              <div className="muted" style={{ fontSize: 13 }}>
                Use 1Password, Authy, or Google Authenticator.
              </div>
            </div>
            <div>
              <b>2. Enter the 6-digit code</b>
            </div>
            <form onSubmit={verify} className="row">
              <input className={`input mono ${err ? 'is-error' : ''}`} id="tfa-code" inputMode="numeric" maxLength={6} placeholder="000000" style={{ width: 130, letterSpacing: '.2em', fontSize: 15 }} autoFocus value={code} onChange={e => setCode(e.target.value)} aria-label="6-digit code" />
              <Button variant="primary" type="submit">
                Verify
              </Button>
              <Button
                variant="ghost"
                type="button"
                onClick={() => {
                  setSetup(false);
                  setErr('');
                }}
              >
                Cancel
              </Button>
            </form>
            {err ? <ErrText>{err}</ErrText> : <span className="hint">Any 6 digits work in this prototype.</span>}
          </div>
        </div>
      ) : (
        <div className="panel" style={{ padding: 18 }}>
          <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
            <span className="ftype" style={{ '--c': 'var(--amber)', width: 36, height: 36 } as React.CSSProperties}>
              <ShieldAlert size={18} />
            </span>
            <div className="grow">
              <b>Two-factor authentication is off</b>
              <p className="muted" style={{ margin: '4px 0 12px', fontSize: 13 }}>
                Protect your account with a code from an authenticator app in addition to your password.
              </p>
              <Button variant="primary" onClick={() => setSetup(true)}>
                Set up two-factor authentication
              </Button>
            </div>
          </div>
        </div>
      )}
      {dlg}
    </>
  );
}

/* ---------- Billing ---------- */

const PRICE: Record<Plan, number> = { Free: 0, Team: 12, Business: 24 };
const PLANS: [Plan, string, string[]][] = [
  ['Free', '$0', ['Up to 3 members', 'Unlimited tasks', '5 GB storage']],
  ['Team', '$12', ['Up to 50 members', 'Timelines & custom views', '100 GB storage', 'Guest access']],
  ['Business', '$24', ['Unlimited members', 'Advanced permissions', 'SAML SSO', '1 TB storage']],
];

export function PlanSection({ title }: { title: string }) {
  const { data } = useWorkspace();
  const [s, set] = useSettings();
  const navigate = useNavigate();
  const [dlg, ask] = useConfirm();
  const usage: [string, number, number, string][] = [
    ['Members', data.members.length, 10, ''],
    ['Storage', 12.4, 100, ' GB'],
    ['Projects', data.projects.length, 50, ''],
  ];
  return (
    <>
      <SettingsHead title={title} lead="Your subscription and usage." />
      <div className="panel" style={{ padding: 18, marginBottom: 18 }}>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div>
            <div className="eyebrow">Current plan</div>
            <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-.015em', marginTop: 4 }}>
              {s.plan} <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>· $12 per member / month</span>
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              Renews {fmtDate(dOff(7), true)} · Billed monthly
            </div>
          </div>
          <span className="sp" />
          <Button variant="secondary" onClick={() => navigate(`${SECTIONS.settings.path}/invoices`)}>
            View invoices
          </Button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 18, marginTop: 18 }}>
          {usage.map(([n, v, m, u]) => (
            <div key={n}>
              <div className="row" style={{ fontSize: 12.5, marginBottom: 6 }}>
                <span className="muted">{n}</span>
                <span className="sp" />
                <span className="num">
                  {v}
                  {u} of {m}
                  {u}
                </span>
              </div>
              <div className="meter">
                <i style={{ width: `${(v / m) * 100}%`, ...(v / m > 0.75 ? { background: 'var(--amber)' } : {}) }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
        {PLANS.map(([n, pr, fs]) => {
          const cur = s.plan === n;
          return (
            <div key={n} className={`plan ${cur ? 'cur' : ''}`}>
              <div className="row">
                <b>{n}</b>
                {cur && <Badge tone="accent">Current</Badge>}
              </div>
              <div className="pr">
                {pr}
                <span className="muted" style={{ fontSize: 12.5, fontWeight: 400 }}>
                  {' '}
                  /member/mo
                </span>
              </div>
              <ul>
                {fs.map(f => (
                  <li key={f}>
                    <Check size={13} />
                    {f}
                  </li>
                ))}
              </ul>
              <div style={{ marginTop: 8 }}>
                {cur ? (
                  <Button block disabled>
                    Current plan
                  </Button>
                ) : (
                  <Button
                    block
                    variant={n === 'Business' ? 'primary' : 'secondary'}
                    onClick={() =>
                      ask({
                        title: `${n === 'Free' ? 'Downgrade' : 'Upgrade'} to ${n}?`,
                        body: (
                          <>
                            {data.members.length} members × ${PRICE[n]}/month = <b>${data.members.length * PRICE[n]}/month</b>, prorated from today and billed to Visa ending 4242.
                          </>
                        ),
                        ok: n === 'Free' ? 'Downgrade' : `Upgrade to ${n}`,
                        icon: Gem,
                        run: () => {
                          set({ plan: n });
                          toast(`You're now on the ${n} plan`);
                        },
                      })
                    }
                  >
                    {n === 'Free' ? 'Downgrade' : 'Upgrade'}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {dlg}
    </>
  );
}

export function PaymentSection({ title }: { title: string }) {
  return (
    <>
      <SettingsHead title={title} lead="Payment method and billing details." />
      <SRow
        t={
          <span className="row" style={{ gap: 10 }}>
            <span className="ftype" style={{ '--c': 'var(--blue)' } as React.CSSProperties}>
              <CreditCard size={15} />
            </span>
            Visa ending in 4242
          </span>
        }
        d="Expires 08/2028 · Default"
      >
        <Button variant="secondary" size="sm" onClick={() => toast.info('Card updates open in a secure payment window')}>
          Update
        </Button>
      </SRow>
      <SRow t="Billing email" d="Invoices and receipts are sent here.">
        <span className="muted" style={{ userSelect: 'all' }}>
          hello@gr8rstudio.com
        </span>
      </SRow>
      <SRow t="Billing address" d="2150 Mission St, San Francisco, CA 94110">
        <Button variant="secondary" size="sm" onClick={() => toast.info('Address editing opens in the billing portal')}>
          Edit
        </Button>
      </SRow>
      <SRow t="Tax ID" d="Shown on invoices">
        <span className="muted">US EIN ••-•••4410</span>
      </SRow>
    </>
  );
}

const INVOICES = [
  { id: 'INV-2026-009', date: -23, amt: '$96.00', st: 'Paid' },
  { id: 'INV-2026-008', date: -53, amt: '$96.00', st: 'Paid' },
  { id: 'INV-2026-007', date: -84, amt: '$80.00', st: 'Paid' },
  { id: 'INV-2026-006', date: -114, amt: '$80.00', st: 'Paid' },
];

export function InvoicesSection({ title }: { title: string }) {
  return (
    <>
      <SettingsHead title={title} lead="Past invoices for this workspace." />
      <div className="panel" style={{ overflowX: 'auto' }}>
        <table className="perm-t" style={{ minWidth: 480 }}>
          <thead>
            <tr>
              <th style={{ paddingLeft: 14 }}>Invoice</th>
              <th style={{ textAlign: 'left' }}>Date</th>
              <th style={{ textAlign: 'left' }}>Amount</th>
              <th style={{ textAlign: 'left' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {INVOICES.map(i => (
              <tr key={i.id}>
                <td style={{ paddingLeft: 14 }} className="mono">
                  {i.id}
                </td>
                <td style={{ textAlign: 'left' }} className="num">
                  {fmtDate(dOff(i.date), true)}
                </td>
                <td style={{ textAlign: 'left' }} className="num">
                  {i.amt}
                </td>
                <td style={{ textAlign: 'left' }}>
                  <Badge tone="green">
                    <Check size={11} />
                    {i.st}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
