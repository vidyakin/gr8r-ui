import { useNavigate } from 'react-router';
import { Archive, ArrowUpRight, Calendar, CircleCheck, Clock, Copy, Ellipsis, Link2, Lock, Pencil, Share2, Star, Trash2 } from 'lucide-react';
import { IconButton, Menu, MenuContent, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger, Progress, Tooltip, toast } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useWorkspace } from '../data/store';
import { PROJECT_STATUS, canSee, progressOf, projectColor, tasksOf } from '../data/selectors';
import { ago, fmtDate, minsAgo } from '../lib/dates';
import { MemberStack } from './workspace';
import type { Project, ProjectStatus as PS } from '../data/types';
import { NamedIcon } from './icons';
import { useProjectForms } from '../overlays';

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

/** Выбор статуса проекта (поповер pstatus): children — кнопка-триггер */
export function ProjectStatusMenu({ project: p, children }: { project: Project; children: React.ReactElement }) {
  const { dispatch } = useWorkspace();
  return (
    <Menu>
      <MenuTrigger asChild>{children}</MenuTrigger>
      <MenuContent>
        <MenuRadioGroup
          value={p.status}
          onValueChange={v => {
            dispatch({ type: 'project/update', id: p.id, patch: { status: v as PS } });
            toast(`${p.name} marked ${PROJECT_STATUS[v as PS].name}`);
          }}
        >
          {(Object.entries(PROJECT_STATUS) as [PS, { name: string; c: string }][]).map(([k, v]) => (
            <MenuRadioItem key={k} value={k} icon={<span className="pdot" style={{ '--c': v.c, borderRadius: '50%' } as React.CSSProperties} />}>
              {v.name}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

/** Меню проекта «⋯» (ctxMenu('project') из overlays/context-menu.js); часть пунктов пока заглушки */
export function ProjectMenu({ project: p, className, style }: { project: Project; className?: string; style?: React.CSSProperties }) {
  const { dispatch } = useWorkspace();
  const navigate = useNavigate();
  const stub = (what: string) => toast.info(`${what} пока не перенесено`);
  const projectForms = useProjectForms();
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton size="sm" label="Project options" tooltip={false} className={className} style={style} onClick={stop} onKeyDown={stop}>
          <Ellipsis size={14} />
        </IconButton>
      </MenuTrigger>
      {/* Портал всплывает событиями в карточку — гасим, чтобы клик по пункту не открывал проект */}
      <MenuContent align="end" onClick={stop} onKeyDown={stop}>
        <MenuItem icon={<ArrowUpRight size={15} />} onSelect={() => navigate(`/projects/${p.id}`)}>
          Open
        </MenuItem>
        <MenuItem
          icon={<Star size={15} />}
          onSelect={() => {
            dispatch({ type: 'project/toggleFav', id: p.id });
            toast.info(p.fav ? 'Removed from favorites' : 'Added to favorites', { duration: 1800 });
          }}
        >
          {p.fav ? 'Remove from favorites' : 'Add to favorites'}
        </MenuItem>
        <MenuItem icon={<Pencil size={15} />} onSelect={() => projectForms.edit(p.id)}>
          Rename &amp; edit
        </MenuItem>
        <MenuItem icon={<Share2 size={15} />} onSelect={() => projectForms.share(p.id)}>
          Share
        </MenuItem>
        <MenuItem
          icon={<Link2 size={15} />}
          onSelect={() => {
            navigator.clipboard?.writeText(`${location.origin}${location.pathname}#/projects/${p.id}`).catch(() => {});
            toast.info('Link copied', { duration: 1800 });
          }}
        >
          Copy link
        </MenuItem>
        <MenuItem icon={<Copy size={15} />} onSelect={() => stub('Дублирование проекта')}>
          Duplicate
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Archive size={15} />} onSelect={() => stub('Архивирование проекта')}>
          {p.status === 'complete' ? 'Archive' : 'Archive project'}
        </MenuItem>
        <MenuItem icon={<Trash2 size={15} />} danger onSelect={() => stub('Удаление проекта')}>
          Delete project
        </MenuItem>
      </MenuContent>
    </Menu>
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
      <ProjectMenu project={p} className="more" style={{ background: 'var(--surface)', boxShadow: '0 0 0 1px var(--border)' }} />
    </div>
  );
}
