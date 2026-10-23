import { Link } from 'react-router';
import { Construction } from 'lucide-react';
import { Button, EmptyState } from '@/components/ui';
import { useCrumbs } from '../layout/Topbar';
import { useT } from '@/i18n';

/** Заглушка для разделов, которые ещё не перенесены из gr8r-studio */
export function PlaceholderPage() {
  const t = useT();
  const crumbs = useCrumbs();
  const title = crumbs[crumbs.length - 1].label;
  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>{title}</h1>
        </div>
      </div>
      <div className="panel">
        <EmptyState
          icon={<Construction />}
          title={t('pages.placeholder.title')}
          action={
            <Button asChild size="sm">
              <Link to="/">{t('pages.placeholder.goHome')}</Link>
            </Button>
          }
        >
          {t('pages.placeholder.hint', { title })}
        </EmptyState>
      </div>
    </div>
  );
}

export function NotFoundPage() {
  const t = useT();
  return (
    <div className="fullstate">
      <div className="box">
        <span className="code">404</span>
        <h1>{t('pages.placeholder.notFoundTitle')}</h1>
        <p>{t('pages.placeholder.notFoundHint')}</p>
        <Button asChild variant="primary">
          <Link to="/">{t('pages.placeholder.goHome')}</Link>
        </Button>
      </div>
    </div>
  );
}
