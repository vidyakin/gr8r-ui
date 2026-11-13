/* Заявка с лендинга — лидом в CRM оператора через публичный вебхук форм (docs/architecture/leads.md).
   Адрес задаётся при сборке: VITE_LEAD_FORM_URL — полный адрес вебхука из «Настройки → Формы лидов» (лендинг на другом домене,
   у вебхука открытый CORS), или VITE_LEAD_FORM_TOKEN — токен, тогда POST /api/hooks/leads/<токен> на тот же домен.
   Без них форма не отправляется и говорит об этом */
import * as React from 'react';
import { t } from './i18n';

const TOKEN = (import.meta.env.VITE_LEAD_FORM_TOKEN as string | undefined)?.trim();
const ENDPOINT = (import.meta.env.VITE_LEAD_FORM_URL as string | undefined)?.trim() || (TOKEN ? `/api/hooks/leads/${encodeURIComponent(TOKEN)}` : undefined);

type Status = 'idle' | 'sending' | 'done' | 'error';

export function LeadForm() {
  const [status, setStatus] = React.useState<Status>('idle');
  const [invalid, setInvalid] = React.useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? '').trim();
    const contact = get('contact');
    if (!contact) return setInvalid(true);
    setInvalid(false);
    if (!ENDPOINT) return;
    // Ловушка для ботов: скрытое поле заполняют только они — делаем вид, что заявка ушла
    if (get('website')) return setStatus('done');
    setStatus('sending');
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: get('name'),
          company: get('company'),
          ...(contact.includes('@') ? { email: contact } : { phone: contact }),
          comment: get('comment'),
          utm_source: 'landing',
        }),
      });
      setStatus(res.ok ? 'done' : 'error');
    } catch {
      setStatus('error');
    }
  };

  if (status === 'done')
    return (
      <p className="l-form-done" role="status">
        {t('form.done')}
      </p>
    );

  return (
    <form className="l-form" onSubmit={submit} noValidate>
      <input className="l-trap" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      <label className="field">
        <span className="label">{t('form.name')}</span>
        <input className="input input-lg" name="name" autoComplete="name" maxLength={200} />
      </label>
      <label className="field">
        <span className="label">{t('form.company')}</span>
        <input className="input input-lg" name="company" autoComplete="organization" maxLength={200} />
      </label>
      <label className="field l-span">
        <span className="label">{t('form.contact')}</span>
        <input className={'input input-lg' + (invalid ? ' is-error' : '')} name="contact" autoComplete="tel" maxLength={254} aria-invalid={invalid} aria-describedby={invalid ? 'contact-err' : undefined} />
        {invalid && (
          <span className="err" id="contact-err">
            {t('form.required')}
          </span>
        )}
      </label>
      <label className="field l-span">
        <span className="label">{t('form.comment')}</span>
        <textarea className="textarea" name="comment" rows={4} maxLength={5000} placeholder={t('form.commentPh')} />
      </label>
      <div className="l-span l-form-foot">
        <button className="btn btn-primary btn-lg" type="submit" disabled={!ENDPOINT || status === 'sending'}>
          {status === 'sending' ? t('form.sending') : t('form.submit')}
        </button>
        {!ENDPOINT && <span className="hint">{t('form.off')}</span>}
        {status === 'error' && (
          <span className="err" role="alert">
            {t('form.error')}
          </span>
        )}
      </div>
    </form>
  );
}
