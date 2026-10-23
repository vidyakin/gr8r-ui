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
import { useT } from '@/i18n';

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
  const t = useT();
  const [cur, setCur] = React.useState('');
  const [pw, setPw] = React.useState('');
  const [conf, setConf] = React.useState('');
  const [e, setE] = React.useState<{ cur?: string; pw?: string; conf?: string }>({});
  const [done, setDone] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    if (!saving) return;
    const timeoutId = setTimeout(() => {
      setSaving(false);
      setDone(true);
      setCur('');
      setPw('');
      setConf('');
      toast(t('settings.password.saved'));
    }, 800);
    return () => clearTimeout(timeoutId);
  }, [saving]);
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const n: typeof e = {};
    setDone(false);
    if (!cur) n.cur = t('settings.password.enterCurrent');
    if (pw.length < 10 || !/[0-9\W]/.test(pw)) n.pw = t('settings.password.rule');
    if (pw !== conf) n.conf = t('settings.password.mismatch');
    setE(n);
    if (!Object.keys(n).length) setSaving(true);
  };
  return (
    <>
      <SettingsHead title={title} lead={t('settings.password.lead')} />
      {done && (
        <div className="alert ok" style={{ marginBottom: 14 }}>
          <CircleCheck size={15} />
          <span>{t('settings.password.updated')}</span>
        </div>
      )}
      <form onSubmit={submit} className="col" style={{ gap: 14, maxWidth: 400 }}>
        <div className="field">
          <label className="label" htmlFor="pw-cur">
            {t('settings.password.current')}
          </label>
          <input type="password" className={`input ${e.cur ? 'is-error' : ''}`} id="pw-cur" autoComplete="current-password" value={cur} onChange={x => setCur(x.target.value)} />
          {e.cur && <ErrText>{e.cur}</ErrText>}
        </div>
        <div className="field">
          <label className="label" htmlFor="pw-new">
            {t('settings.password.new')}
          </label>
          <input type="password" className={`input ${e.pw ? 'is-error' : ''}`} id="pw-new" autoComplete="new-password" value={pw} onChange={x => setPw(x.target.value)} />
          <PasswordStrength value={pw} />
          {e.pw ? <ErrText>{e.pw}</ErrText> : <span className="hint">{t('settings.password.hint')}</span>}
        </div>
        <div className="field">
          <label className="label" htmlFor="pw-conf">
            {t('settings.password.confirm')}
          </label>
          <input type="password" className={`input ${e.conf ? 'is-error' : ''}`} id="pw-conf" autoComplete="new-password" value={conf} onChange={x => setConf(x.target.value)} />
          {e.conf && <ErrText>{e.conf}</ErrText>}
        </div>
        <div>
          <Button variant="primary" type="submit" loading={saving}>
            {t('settings.password.update')}
          </Button>
        </div>
      </form>
    </>
  );
}

export function SessionsSection({ title }: { title: string }) {
  const t = useT();
  const [s, set] = useSettings();
  const [dlg, ask] = useConfirm();
  return (
    <>
      <SettingsHead title={title} lead={t('settings.sessions.lead')} />
      {s.sessions.map(x => (
        <SRow
          key={x.id}
          t={
            <span className="row" style={{ gap: 8 }}>
              {x.dev.includes('iPhone') ? <Smartphone size={15} /> : <Monitor size={15} />}
              {x.dev}
              {x.cur && <Badge tone="green">{t('settings.sessions.thisDevice')}</Badge>}
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
                toast(t('settings.sessions.signedOut'));
              }}
            >
              {t('settings.sessions.signOut')}
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
              title: t('settings.sessions.signOutAllTitle'),
              body: t('settings.sessions.signOutAllBody'),
              ok: t('settings.sessions.signOutAllOk'),
              danger: true,
              icon: LogOut,
              run: () => {
                set({ sessions: s.sessions.filter(y => y.cur) });
                toast(t('settings.sessions.signOutAll'));
              },
            })
          }
        >
          {t('settings.sessions.signOutAllBtn')}
        </Button>
      </div>
      {dlg}
    </>
  );
}

const RECOVERY = ['7KQ2-M8PX', 'D4TN-9WRE', 'HV3C-QZ6L', 'P2YB-J7SK', 'R9FG-4NUD', 'X6MA-T3HE'];

/** Заглушка QR-кода: 11×11 клеток с тремя «позиционными» метками, как в оригинале */
function QrStub() {
  const t = useT();
  return (
    <div style={{ width: 132, height: 132, display: 'grid', gridTemplateColumns: 'repeat(11,1fr)', gap: 1, padding: 8, background: '#fff', borderRadius: 8, border: '1px solid var(--border)' }} aria-label={t('settings.twofa.qrAria')}>
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
  const t = useT();
  const [s, set] = useSettings();
  const [setup, setSetup] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [err, setErr] = React.useState('');
  const [dlg, ask] = useConfirm();
  const verify = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) return setErr(t('settings.twofa.codeInvalid'));
    setErr('');
    setSetup(false);
    setCode('');
    set({ tfa: true });
    toast(t('settings.twofa.enabled'));
  };
  return (
    <>
      <SettingsHead title={title} lead={t('settings.twofa.lead')} />
      {s.tfa ? (
        <>
          <div className="alert ok">
            <ShieldCheck size={16} />
            <div>
              <b>{t('settings.twofa.on.title')}</b>
              <div className="muted">{t('settings.twofa.on.hint')}</div>
            </div>
          </div>
          <div className="sblock">
            <h2>{t('settings.twofa.recovery')}</h2>
            <p className="muted" style={{ fontSize: 13, margin: '1em 0' }}>
              {t('settings.twofa.recoveryHint')}
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
                    title: t('settings.twofa.turnOffTitle'),
                    body: t('settings.twofa.turnOffBody'),
                    ok: t('settings.twofa.turnOffOk'),
                    danger: true,
                    icon: ShieldOff,
                    run: () => {
                      set({ tfa: false });
                      toast(t('settings.twofa.turnOff'));
                    },
                  })
                }
              >
                {t('settings.twofa.turnOffBtn')}
              </Button>
            </div>
          </div>
        </>
      ) : setup ? (
        <div className="panel" style={{ padding: 18, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <QrStub />
          <div className="grow col" style={{ gap: 10, minWidth: 220 }}>
            <div>
              <b>{t('settings.twofa.setupTitle')}</b>
              <div className="muted" style={{ fontSize: 13 }}>
                {t('settings.twofa.setupHint')}
              </div>
            </div>
            <div>
              <b>{t('settings.twofa.setupCode')}</b>
            </div>
            <form onSubmit={verify} className="row">
              <input className={`input mono ${err ? 'is-error' : ''}`} id="tfa-code" inputMode="numeric" maxLength={6} placeholder={t('settings.twofa.codePlaceholder')} style={{ width: 130, letterSpacing: '.2em', fontSize: 15 }} autoFocus value={code} onChange={e => setCode(e.target.value)} aria-label={t('settings.twofa.codeAria')} />
              <Button variant="primary" type="submit">
                {t('settings.twofa.verify')}
              </Button>
              <Button
                variant="ghost"
                type="button"
                onClick={() => {
                  setSetup(false);
                  setErr('');
                }}
              >
                {t('settings.common.cancel')}
              </Button>
            </form>
            {err ? <ErrText>{err}</ErrText> : <span className="hint">{t('settings.twofa.codeHint')}</span>}
          </div>
        </div>
      ) : (
        <div className="panel" style={{ padding: 18 }}>
          <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
            <span className="ftype" style={{ '--c': 'var(--amber)', width: 36, height: 36 } as React.CSSProperties}>
              <ShieldAlert size={18} />
            </span>
            <div className="grow">
              <b>{t('settings.twofa.off.title')}</b>
              <p className="muted" style={{ margin: '4px 0 12px', fontSize: 13 }}>
                {t('settings.twofa.off.hint')}
              </p>
              <Button variant="primary" onClick={() => setSetup(true)}>
                {t('settings.twofa.off.btn')}
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

type PlanKey = 'free' | 'team' | 'business';
const PLAN_KEY: Record<Plan, PlanKey> = { Free: 'free', Team: 'team', Business: 'business' };

export function PlanSection({ title }: { title: string }) {
  const t = useT();
  const { data } = useWorkspace();
  const [s, set] = useSettings();
  const navigate = useNavigate();
  const [dlg, ask] = useConfirm();
  const usage: [string, number, number, string][] = [
    [t('settings.plan.usage.members'), data.members.length, 10, ''],
    [t('settings.plan.usage.storage'), 12.4, 100, ' GB'],
    [t('settings.plan.usage.projects'), data.projects.length, 50, ''],
  ];
  return (
    <>
      <SettingsHead title={title} lead={t('settings.plan.lead')} />
      <div className="panel" style={{ padding: 18, marginBottom: 18 }}>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div>
            <div className="eyebrow">{t('settings.plan.currentPlan')}</div>
            <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-.015em', marginTop: 4 }}>
              {s.plan} <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>· {t('settings.plan.perMember')}</span>
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              {t('settings.plan.renews', { date: fmtDate(dOff(7), true) })}
            </div>
          </div>
          <span className="sp" />
          <Button variant="secondary" onClick={() => navigate(`${SECTIONS.settings.path}/invoices`)}>
            {t('settings.plan.viewInvoices')}
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
        {(['Free', 'Team', 'Business'] as Plan[]).map(n => {
          const k = PLAN_KEY[n];
          const cur = s.plan === n;
          const pr = t(`settings.plan.pricing.${k}.price`);
          const fs = t(`settings.plan.pricing.${k}.features`).split('|');
          return (
            <div key={n} className={`plan ${cur ? 'cur' : ''}`}>
              <div className="row">
                <b>{t(`settings.plan.pricing.${k}.name`)}</b>
                {cur && <Badge tone="accent">{t('settings.plan.current')}</Badge>}
              </div>
              <div className="pr">
                {pr}
                <span className="muted" style={{ fontSize: 12.5, fontWeight: 400 }}>
                  {' '}
                  {t('settings.plan.priceMember')}
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
                    {t('settings.plan.currentPlanBtn')}
                  </Button>
                ) : (
                  <Button
                    block
                    variant={n === 'Business' ? 'primary' : 'secondary'}
                    onClick={() =>
                      ask({
                        title: t('settings.plan.confirmTitle', { action: n === 'Free' ? t('settings.plan.downgrade') : t('settings.plan.upgrade'), plan: t(`settings.plan.pricing.${k}.name`) }),
                        body: t('settings.plan.confirmBody', { count: data.members.length, price: PRICE[n], total: data.members.length * PRICE[n] }),
                        ok: n === 'Free' ? t('settings.plan.confirmOkDowngrade') : t('settings.plan.confirmOkUpgrade', { plan: t(`settings.plan.pricing.${k}.name`) }),
                        icon: Gem,
                        run: () => {
                          set({ plan: n });
                          toast(t('settings.plan.switched', { plan: t(`settings.plan.pricing.${k}.name`) }));
                        },
                      })
                    }
                  >
                    {n === 'Free' ? t('settings.plan.downgrade') : t('settings.plan.upgrade')}
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
  const t = useT();
  return (
    <>
      <SettingsHead title={title} lead={t('settings.payment.lead')} />
      <SRow
        t={
          <span className="row" style={{ gap: 10 }}>
            <span className="ftype" style={{ '--c': 'var(--blue)' } as React.CSSProperties}>
              <CreditCard size={15} />
            </span>
            {t('settings.payment.card')}
          </span>
        }
        d={t('settings.payment.cardSub')}
      >
        <Button variant="secondary" size="sm" onClick={() => toast.info(t('settings.payment.cardUpdates'))}>
          {t('settings.payment.update')}
        </Button>
      </SRow>
      <SRow t={t('settings.payment.billingEmail')} d={t('settings.payment.billingEmailHint')}>
        <span className="muted" style={{ userSelect: 'all' }}>
          hello@gr8rstudio.com
        </span>
      </SRow>
      <SRow t={t('settings.payment.billingAddress')} d={t('settings.payment.billingAddressValue')}>
        <Button variant="secondary" size="sm" onClick={() => toast.info(t('settings.payment.addressEdit'))}>
          {t('settings.payment.edit')}
        </Button>
      </SRow>
      <SRow t={t('settings.payment.taxId')} d={t('settings.payment.taxIdHint')}>
        <span className="muted">{t('settings.payment.taxIdValue')}</span>
      </SRow>
    </>
  );
}

const INVOICES = [
  { id: 'INV-2026-009', date: -23, amt: '$96.00' },
  { id: 'INV-2026-008', date: -53, amt: '$96.00' },
  { id: 'INV-2026-007', date: -84, amt: '$80.00' },
  { id: 'INV-2026-006', date: -114, amt: '$80.00' },
];

export function InvoicesSection({ title }: { title: string }) {
  const t = useT();
  return (
    <>
      <SettingsHead title={title} lead={t('settings.invoices.lead')} />
      <div className="panel" style={{ overflowX: 'auto' }}>
        <table className="perm-t" style={{ minWidth: 480 }}>
          <thead>
            <tr>
              <th style={{ paddingLeft: 14 }}>{t('settings.invoices.cols.invoice')}</th>
              <th style={{ textAlign: 'left' }}>{t('settings.invoices.cols.date')}</th>
              <th style={{ textAlign: 'left' }}>{t('settings.invoices.cols.amount')}</th>
              <th style={{ textAlign: 'left' }}>{t('settings.invoices.cols.status')}</th>
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
                    {t('settings.invoices.paid')}
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
