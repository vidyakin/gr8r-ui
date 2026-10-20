/* Полноэкранные состояния 404, «нет доступа» и «не удалось загрузить» — порт page404 / stateDenied / stateFailed из pages/errors.js */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, CloudAlert, FileQuestion, Lock, RefreshCw } from 'lucide-react';
import { Button, toast } from '@/components/ui';
import { useWorkspace } from '../data/store';
import { member } from '../data/selectors';
import type { Project } from '../data/types';
import { SECTIONS } from '../routes';

export function Page404() {
  const navigate = useNavigate();
  return (
    <div className="fullstate">
      <div className="box">
        <div className="empty-state" style={{ padding: 0 }}>
          <div className="glyph">
            <FileQuestion size={20} />
          </div>
        </div>
        <span className="code">ERROR 404</span>
        <h1>Page not found</h1>
        <p>The page you're looking for was moved, deleted, or never existed. Check the link or head back home.</p>
        <div className="row">
          <Button onClick={() => navigate(-1)}>
            <ArrowLeft size={14} />
            Go back
          </Button>
          <Button variant="primary" onClick={() => navigate(SECTIONS.home.path)}>
            Go to Home
          </Button>
        </div>
      </div>
    </div>
  );
}

export function StateDenied({ project: p }: { project?: Project }) {
  const { data } = useWorkspace();
  const navigate = useNavigate();
  const lead = member(data, p?.lead);
  return (
    <div className="fullstate">
      <div className="box">
        <div className="empty-state" style={{ padding: 0 }}>
          <div className="glyph">
            <Lock size={20} />
          </div>
        </div>
        <span className="code">ERROR 403</span>
        <h1>You don't have access</h1>
        <p>
          {p && (
            <>
              <b>{p.name}</b> is a private project.{' '}
            </>
          )}
          Ask {lead ? lead.name : 'the project owner'} to add you, or request access and we'll let them know.
        </p>
        <div className="row">
          <Button onClick={() => navigate(SECTIONS.projects.path)}>Back to projects</Button>
          <Button variant="primary" onClick={() => toast(`Access requested. We'll notify you when ${lead?.name || 'the owner'} responds.`)}>
            Request access
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Показывается вместо страницы, если её отрисовка упала (в оригинале — catch в shell/layout.js) */
export function StateFailed() {
  const navigate = useNavigate();
  return (
    <div className="fullstate">
      <div className="box">
        <div className="empty-state err" style={{ padding: 0 }}>
          <div className="glyph">
            <CloudAlert size={20} />
          </div>
        </div>
        <h1>Something went wrong.</h1>
        <p>This page failed to load. Your data is safe — try again in a moment.</p>
        <div className="row">
          <Button onClick={() => navigate(SECTIONS.home.path)}>Go to Home</Button>
          <Button variant="primary" onClick={() => window.location.reload()}>
            <RefreshCw size={14} />
            Try again
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Граница ошибок страницы: вместо упавшей страницы показывает StateFailed; сбрасывается при смене маршрута */
export class PageBoundary extends React.Component<{ resetKey: string; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.error(e);
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? <StateFailed /> : this.props.children;
  }
}
