/* Настройки: безопасность и оплата. Смена пароля, сессии и тариф работают на настоящих данных (/auth/password, /auth/sessions, /license);
   способ оплаты и счета — пока демонстрационные. */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, CircleCheck, CreditCard, LogOut, Monitor, Smartphone, Sparkles } from 'lucide-react';
import { LIMIT_KEYS, MODULE_IDS, usageOf, type LimitKey } from '@gr8r/shared';
import { Badge, Button, toast } from '@/components/ui';
import { ApiError, apiFor, errorMessage, ok } from '../data/api';
import { useLicense, useLicenseUsage } from '../licensing/data';
import { dOff, fmtDate } from '../lib/dates';
import { ConfirmModal, type ConfirmSpec } from '../overlays/project-dialogs';
import { SECTIONS } from '../routes';
import { PasswordStrength, SRow, SettingsHead } from './parts';
import { fmtDateTime, fmtDateTimeIntl, fmtNumber, useT } from '@/i18n';

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
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const n: typeof e = {};
    setDone(false);
    if (!cur) n.cur = t('settings.password.enterCurrent');
    if (pw.length < 10 || !/[0-9\W]/.test(pw)) n.pw = t('settings.password.rule');
    if (pw !== conf) n.conf = t('settings.password.mismatch');
    setE(n);
    if (Object.keys(n).length) return;
    setSaving(true);
    try {
      await ok(apiFor().auth.password.$post({ json: { current: cur, next: pw } }));
      setDone(true);
      setCur('');
      setPw('');
      setConf('');
      toast(t('settings.password.saved'));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'wrong_password') setE({ cur: errorMessage(err) });
      else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
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

interface SessionRow {
  id: string;
  createdAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

/** «Chrome · macOS» из User-Agent (грубо: браузер и система) */
function deviceOf(ua: string | null, unknown: string): { name: string; mobile: boolean } {
  if (!ua) return { name: unknown, mobile: false };
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return { name: [browser, os].filter(Boolean).join(' · ') || unknown, mobile: /iPhone|Android|Mobile/.test(ua) };
}

export function SessionsSection({ title }: { title: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [dlg, ask] = useConfirm();
  const q = useQuery({ queryKey: ['sessions'], queryFn: async () => (await ok<{ items: SessionRow[] }>(apiFor().auth.sessions.$get())).items });
  const items = q.data ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ['sessions'] });
  const signOut = async (id: string) => {
    try {
      await ok(apiFor().auth.sessions[':id'].$delete({ param: { id } }));
      toast(t('settings.sessions.signedOut'));
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <>
      <SettingsHead title={title} lead={t('settings.sessions.lead')} />
      {items.map(x => {
        const dev = deviceOf(x.userAgent, t('settings.sessions.unknownDevice'));
        return (
          <SRow
            key={x.id}
            t={
              <span className="row" style={{ gap: 8 }}>
                {dev.mobile ? <Smartphone size={15} /> : <Monitor size={15} />}
                {dev.name}
                {x.current && <Badge tone="green">{t('settings.sessions.thisDevice')}</Badge>}
              </span>
            }
            d={`${x.ip ? `${x.ip} · ` : ''}${t('settings.sessions.signedInAt', { date: fmtDateTime(x.createdAt) })}`}
          >
            {!x.current && (
              <Button variant="secondary" size="sm" onClick={() => signOut(x.id)}>
                {t('settings.sessions.signOut')}
              </Button>
            )}
          </SRow>
        );
      })}
      <div style={{ marginTop: 16 }}>
        <Button
          variant="danger-ghost"
          disabled={items.filter(x => !x.current).length === 0}
          onClick={() =>
            ask({
              title: t('settings.sessions.signOutAllTitle'),
              body: t('settings.sessions.signOutAllBody'),
              ok: t('settings.sessions.signOutAllOk'),
              danger: true,
              icon: LogOut,
              run: async () => {
                try {
                  await ok(apiFor().auth.sessions.$delete());
                  toast(t('settings.sessions.signOutAll'));
                  refresh();
                } catch (e) {
                  toast.error(errorMessage(e));
                }
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

/* ---------- Billing ---------- */

/** Тариф, модули, сроки, лимиты и использование — по настоящей лицензии воркспейса (GET /license, /license/usage) */
export function PlanSection({ title }: { title: string }) {
  const t = useT();
  const navigate = useNavigate();
  const view = useLicense().data;
  const lu = useLicenseUsage().data;
  const date = (iso: string) => fmtDateTimeIntl(iso, { dateStyle: 'medium' });
  const name = (id: (typeof MODULE_IDS)[number]) => t(`licensing.modules.${id}.name` as const);
  const planName = view?.plan.name ?? t('settings.plan.noPlan');
  const state = (id: (typeof MODULE_IDS)[number]) => {
    const s = view?.states[id];
    if (!s || s.state === 'off') return null;
    if (s.state === 'readonly') return { tone: 'amber' as const, label: t('licensing.upgrade.status.readonly', { date: date(s.readonlyUntil!) }) };
    if (s.expiresAt) return { tone: 'accent' as const, label: t('settings.plan.until', { date: date(s.expiresAt) }) };
    return { tone: 'green' as const, label: t('settings.plan.unlimitedTerm') };
  };
  return (
    <>
      <SettingsHead title={title} lead={t('settings.plan.lead')} />
      <div className="panel" style={{ padding: 18, marginBottom: 18 }}>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div>
            <div className="eyebrow">{t('settings.plan.currentPlan')}</div>
            <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-.015em', marginTop: 4 }}>
              {planName} {view?.isTrial && <Badge tone="accent">{t('settings.plan.trial')}</Badge>}
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              {view?.plan.expiresAt ? t('settings.plan.until', { date: date(view.plan.expiresAt) }) : t('settings.plan.unlimitedTerm')}
            </div>
          </div>
          <span className="sp" />
          <Button variant="secondary" onClick={() => navigate(SECTIONS.upgrade.path)}>
            <Sparkles size={14} />
            {t('settings.plan.needMore')}
          </Button>
        </div>
      </div>
      <div className="sblock">
        <h2>{t('settings.plan.limits')}</h2>
        {lu && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 18, marginTop: 12 }}>
            {LIMIT_KEYS.map((k: LimitKey) => {
              const used = Math.round(usageOf(lu.usage, k) * 10) / 10;
              const max = lu.limits[k];
              const has = typeof max === 'number';
              return (
                <div key={k}>
                  <div className="row" style={{ fontSize: 12.5, marginBottom: 6 }}>
                    <span className="muted">{t(`licensing.limits.${k}` as const)}</span>
                    <span className="sp" />
                    <span className="num">{has ? t('settings.plan.usedOf', { used: fmtNumber(used), max: fmtNumber(max) }) : `${fmtNumber(used)} · ${t('licensing.limits.unlimited')}`}</span>
                  </div>
                  {has && (
                    <div className="meter">
                      <i style={{ width: `${max > 0 ? Math.min(100, (used / max) * 100) : 100}%`, ...(max === 0 || used / max > 0.75 ? { background: 'var(--amber)' } : {}) }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="sblock" style={{ marginTop: 18 }}>
        <h2>{t('settings.plan.modules')}</h2>
        {MODULE_IDS.filter(id => id !== 'core').map(id => {
          const s = state(id);
          return (
            <div key={id} className="srow">
              <span>{name(id)}</span>
              {s ? <Badge tone={s.tone}>{s.label}</Badge> : <Badge tone="gray">{t('licensing.upgrade.status.off')}</Badge>}
            </div>
          );
        })}
      </div>
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
