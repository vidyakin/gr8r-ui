import { Link } from 'react-router';
import { Construction } from 'lucide-react';
import { Button, EmptyState } from '@/components/ui';
import { useCrumbs } from '../layout/Topbar';

/** Заглушка для разделов, которые ещё не перенесены из gr8r-studio */
export function PlaceholderPage() {
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
          title="Раздел ещё не перенесён"
          action={
            <Button asChild size="sm">
              <Link to="/">На главную</Link>
            </Button>
          }
        >
          Страница «{title}» есть в исходном gr8r-studio и будет перенесена на компоненты Gr8r UI следующей.
        </EmptyState>
      </div>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="fullstate">
      <div className="box">
        <span className="code">404</span>
        <h1>Page not found</h1>
        <p>The page you're looking for doesn't exist or was moved.</p>
        <Button asChild variant="primary">
          <Link to="/">Go home</Link>
        </Button>
      </div>
    </div>
  );
}
