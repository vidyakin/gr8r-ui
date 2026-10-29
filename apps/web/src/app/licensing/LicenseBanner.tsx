/* Баннер владельцу и админу арендатора (задача 1206): срок тарифа или модуля заканчивается через неделю или уже кончился
   и модули работают «только для чтения». Участникам и гостям не показывается: продлевает тот, кто управляет воркспейсом. */
import * as React from 'react';
import { licenseNotices, type ModuleId } from '@gr8r/shared';
import { Link } from 'react-router';
import { Alert } from '@/components/ui';
import { useT } from '@/i18n';
import { fmtDateTimeIntl } from '@/i18n/format';
import { useSession } from '../data/session';
import { useLicense } from './data';

export function LicenseBanner() {
  const t = useT();
  const role = useSession().active?.role;
  const view = useLicense().data;
  const notices = React.useMemo(() => (view ? licenseNotices(view) : []), [view]);
  if (!view || (role !== 'owner' && role !== 'admin') || !notices.length) return null;
  const names = (ms: ModuleId[]) => ms.map(m => t(`licensing.modules.${m}.name` as const)).join(', ');
  const date = (iso: string) => fmtDateTimeIntl(iso, { dateStyle: 'medium' });
  return (
    <div className="stack" style={{ gap: 6, padding: '8px 16px 0' }}>
      {notices.map(n => (
        <Alert key={n.kind} tone={n.kind === 'readonly' ? 'danger' : 'warn'} action={<Link to="/upgrade">{t('licensing.banner.more')}</Link>}>
          {t(`licensing.banner.${n.kind}${n.trial ? 'Trial' : ''}` as 'licensing.banner.expiring', { date: date(n.until), modules: names(n.modules) })}
        </Alert>
      ))}
    </div>
  );
}
