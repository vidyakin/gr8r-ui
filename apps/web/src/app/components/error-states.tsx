/* Полноэкранные состояния 404, «нет доступа» и «не удалось загрузить» — порт page404 / stateDenied / stateFailed из pages/errors.js */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, CloudAlert, FileQuestion, Lock, RefreshCw } from 'lucide-react';
import { Button, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { useWorkspace } from '../data/store';
import { member } from '../data/selectors';
import type { Project } from '../data/types';
import { SECTIONS } from '../routes';

export function Page404() {
  const navigate = useNavigate();
  const tt = useT();
  return (
    <div className="fullstate">
      <div className="box">
        <div className="empty-state" style={{ padding: 0 }}>
          <div className="glyph">
            <FileQuestion size={20} />
          </div>
        </div>
        <span className="code">{tt('views.error.notFound.code')}</span>
        <h1>{tt('views.error.notFound.title')}</h1>
        <p>{tt('views.error.notFound.text')}</p>
        <div className="row">
          <Button onClick={() => navigate(-1)}>
            <ArrowLeft size={14} />
            {tt('views.error.back')}
          </Button>
          <Button variant="primary" onClick={() => navigate(SECTIONS.home.path)}>
            {tt('views.error.home')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function StateDenied({ project: p }: { project?: Project }) {
  const { data } = useWorkspace();
  const navigate = useNavigate();
  const tt = useT();
  const lead = member(data, p?.lead);
  return (
    <div className="fullstate">
      <div className="box">
        <div className="empty-state" style={{ padding: 0 }}>
          <div className="glyph">
            <Lock size={20} />
          </div>
        </div>
        <span className="code">{tt('views.error.forbidden.code')}</span>
        <h1>{tt('views.error.forbidden.title')}</h1>
        <p>
          {p && lead && tt('views.error.forbidden.text', { name: p.name, lead: lead.name })}
          {p && !lead && tt('views.error.forbidden.text', { name: p.name, lead: 'project owner' })}
        </p>
        <div className="row">
          <Button onClick={() => navigate(SECTIONS.projects.path)}>{tt('views.error.back')}</Button>
          <Button variant="primary" onClick={() => toast(tt('views.error.private', { lead: lead?.name ?? 'project owner' }))}>
            {tt('views.error.forbidden.requestAccess')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Показывается вместо страницы, если её отрисовка упала (в оригинале — catch в shell/layout.js) */
export function StateFailed() {
  const navigate = useNavigate();
  const tt = useT();
  return (
    <div className="fullstate">
      <div className="box">
        <div className="empty-state err" style={{ padding: 0 }}>
          <div className="glyph">
            <CloudAlert size={20} />
          </div>
        </div>
        <h1>{tt('views.error.loadFailed.title')}</h1>
        <p>{tt('views.error.loadFailed.text')}</p>
        <div className="row">
          <Button onClick={() => navigate(SECTIONS.home.path)}>{tt('views.error.home')}</Button>
          <Button variant="primary" onClick={() => window.location.reload()}>
            <RefreshCw size={14} />
            {tt('views.error.retry')}
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
