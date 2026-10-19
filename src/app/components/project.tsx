import { useNavigate } from 'react-router';
import { Calendar, CircleCheck, Clock, Lock, Star } from 'lucide-react';
import { Progress, Tooltip } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useWorkspace } from '../data/store';
import { PROJECT_STATUS, canSee, progressOf, projectColor, tasksOf } from '../data/selectors';
import { ago, fmtDate, minsAgo } from '../lib/dates';
import { MemberStack } from './workspace';
import type { Project, ProjectStatus as PS } from '../data/types';
import { NamedIcon } from './icons';

/** Квадратная иконка проекта в его цвете (pIcon) */
export function ProjectIcon({ project, size = 15, className }: { project: Project; size?: number; className?: string }) {
  return (
    <span className={cn('picon', className)} style={{ '--c': projectColor(project) } as React.CSSProperties}>
      <NamedIcon name={project.icon} size={size} />
    </span>
  );
}

/** Цветная точка проекта (pdot) */
export function ProjectDot({ project, size }: { project?: Project | null; size?: number }) {
  return <span className="pdot" style={{ '--c': projectColor(project), width: size, height: size } as React.CSSProperties} />;
}

/** Статус проекта: «● In Progress» (pStatus) */
export function ProjectStatus({ status }: { status: PS }) {
  const s = PROJECT_STATUS[status];
  return (
    <span className="pstatus" style={{ '--c': s.c } as React.CSSProperties}>
      <i />
      {s.name}
    </span>
  );
}

/** Карточка проекта для сеток (projectCard из pages/projects.js) */
export function ProjectCard({ project: p }: { project: Project }) {
  const { data } = useWorkspace();
  const navigate = useNavigate();
  const ts = tasksOf(data, p.id);
  const pr = progressOf(data, p.id);
  const done = ts.filter(t => t.status === 'done').length;
  const locked = !canSee(data, p);
  const go = () => navigate(`/projects/${p.id}`);
  return (
    <div className="pcard" role="link" tabIndex={0} aria-label={p.name} onClick={go} onKeyDown={e => e.key === 'Enter' && e.target === e.currentTarget && go()}>
      <div className="row">
        <ProjectIcon project={p} />
        <div className="min-w-0 flex-1">
          <div className="row" style={{ gap: 6 }}>
            <b className="trunc" style={{ fontWeight: 600, fontSize: 14 }}>
              {p.name}
            </b>
            {p.fav && (
              <span style={{ color: 'var(--amber)' }}>
                <Star size={12} />
              </span>
            )}
            {p.private && (
              <Tooltip content="Private project">
                <span className="faint">
                  <Lock size={12} />
                </span>
              </Tooltip>
            )}
          </div>
        </div>
        <ProjectStatus status={p.status} />
      </div>
      <div className="desc">{p.desc}</div>
      {locked ? (
        <div className="row faint" style={{ fontSize: 12 }}>
          <Lock size={12} />
          Restricted — request access to see tasks
        </div>
      ) : (
        <div className="row" style={{ gap: 10 }}>
          <Progress value={pr} tone={p.status === 'complete' ? 'green' : p.status === 'risk' ? 'red' : undefined} aria-label={`${p.name} progress`} />
          <span className="num" style={{ fontSize: 12, fontWeight: 500 }}>
            {pr}%
          </span>
        </div>
      )}
      <div className="foot">
        <span className="row" style={{ gap: 4 }}>
          <CircleCheck size={12} />
          {locked ? '—' : `${done}/${ts.length}`}
        </span>
        <span className="row" style={{ gap: 4 }}>
          <Calendar size={12} />
          {fmtDate(p.due)}
        </span>
        <span className="row hide-m" style={{ gap: 4 }}>
          <Clock size={12} />
          {ago(minsAgo(p.last))}
        </span>
        <span className="sp" />
        <MemberStack ids={p.members} max={3} />
      </div>
    </div>
  );
}
