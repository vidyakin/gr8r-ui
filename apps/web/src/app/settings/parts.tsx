/* Общие части настроек — порт srow, tog, sel и strengthMeter из pages/settings.js */
import * as React from 'react';
import { Switch, toast } from '@/components/ui';
import { useT } from '@/i18n';

/** Строка «заголовок + пояснение — элемент управления» */
export function SRow({ t, d, children }: { t: React.ReactNode; d?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="srow">
      <div>
        <div className="t">{t}</div>
        {d ? <div className="d">{d}</div> : null}
      </div>
      <div className="row">{children}</div>
    </div>
  );
}

/** Тумблер; notify — тост «сохранено», как у настроек уведомлений */
export function Toggle({ checked, onChange, label, notify }: { checked: boolean; onChange: (v: boolean) => void; label: string; notify?: string }) {
  const t = useT();
  return (
    <Switch
      checked={checked}
      aria-label={label}
      onChange={e => {
        onChange(e.target.checked);
        if (notify) toast(notify || t('settings.common.preferenceSaved'), { duration: 1500 });
      }}
    />
  );
}

/** Нативный select (как в оригинале): значение, которого нет в списке, показывается первым пунктом */
export function PrefSelect({ value, options, onChange, label }: { value: string; options: (string | [string, string])[]; onChange: (v: string) => void; label: string }) {
  const t = useT();
  const opts = options.map(o => (Array.isArray(o) ? o : ([o, o] as [string, string])));
  const v = opts.some(o => o[0] === value) ? value : opts[0][0];
  return (
    <select
      className="select"
      style={{ width: 'auto', minWidth: 180 }}
      aria-label={label}
      value={v}
      onChange={e => {
        onChange(e.target.value);
        toast(t('settings.common.preferenceSaved'), { duration: 1500 });
      }}
    >
      {opts.map(([val, n]) => (
        <option key={val} value={val}>
          {n}
        </option>
      ))}
    </select>
  );
}

/** Оценка пароля 0–4 */
export function passwordScore(pw: string) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[0-9]/.test(pw) && /[a-zA-Z]/.test(pw)) s++;
  if (/[^a-zA-Z0-9]/.test(pw)) s++;
  return s;
}

/** Индикатор силы пароля; пустой пароль — ничего */
export function PasswordStrength({ value }: { value: string }) {
  const t = useT();
  if (!value) return null;
  const s = passwordScore(value);
  const c = ['var(--red)', 'var(--red)', 'var(--amber)', 'var(--green)', 'var(--green)'][s];
  const n = [
    t('settings.passwordStrength.tooShort'),
    t('settings.passwordStrength.weak'),
    t('settings.passwordStrength.fair'),
    t('settings.passwordStrength.good'),
    t('settings.passwordStrength.strong'),
  ][s];
  return (
    <div className="row" style={{ gap: 8 }} data-strength={s}>
      <div className="strength grow" aria-hidden="true">
        {[0, 1, 2, 3].map(i => (
          <i key={i} className={i < s ? 'on' : ''} style={{ '--c': c } as React.CSSProperties} />
        ))}
      </div>
      <span style={{ fontSize: 11.5, color: c, width: 60, textAlign: 'right' }}>{n}</span>
    </div>
  );
}

export function SettingsHead({ title, lead }: { title: string; lead: React.ReactNode }) {
  return (
    <>
      <h1>{title}</h1>
      <p className="lead">{lead}</p>
    </>
  );
}
