import { useNavigate } from 'react-router';
import { Archive, ArrowDown, ArrowUp, ArrowUpRight, Calendar, CircleCheck, Clock, Copy, Ellipsis, Link2, Lock, Pencil, Share2, Star, Trash2 } from 'lucide-react';
import { TASK_MODULE_LABELS } from '@gr8r/shared';
import { IconButton, Menu, MenuContent, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger, Progress, Tooltip, toast } from '@/components/ui';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import { useWorkspace } from '../data/store';
import { PROJECT_STATUS, canSee, progressOf, projectColor, tasksOf, visibleProjects } from '../data/selectors';
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
  const tt = useT();
  return (
    <Menu>
      <MenuTrigger asChild>{children}</MenuTrigger>
      <MenuContent>
        <MenuRadioGroup
          value={p.status}
          onValueChange={v => {
            dispatch({ type: 'project/update', id: p.id, patch: { status: v as PS } });
            toast(tt('views.project.statusChanged', { name: p.name, status: PROJECT_STATUS[v as PS].name }));
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

/** Меню проекта «⋯» (ctxMenu('project') из overlays/context-menu.js) */
export function ProjectMenu({ project: p, className, style }: { project: Project; className?: string; style?: React.CSSProperties }) {
  const { data, dispatch } = useWorkspace();
  const navigate = useNavigate();
  const tt = useT();
  const order = visibleProjects(data).map(x => x.id);
  const idx = order.indexOf(p.id);
  const move = (dir: -1 | 1) => {
    dispatch({ type: 'project/move', id: p.id, dir });
    toast(tt('views.project.moved', { name: p.name, dir: dir < 0 ? tt('views.project.up') : tt('views.project.down') }), { duration: 1600 });
  };
  const projectForms = useProjectForms();
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton size="sm" label={tt('views.project.options')} tooltip={false} className={className} style={style} onClick={stop} onKeyDown={stop}>
          <Ellipsis size={14} />
        </IconButton>
      </MenuTrigger>
      <MenuContent align="end" onClick={stop} onKeyDown={stop}>
        <MenuItem icon={<ArrowUpRight size={15} />} onSelect={() => navigate(`/projects/${p.id}`)}>
          {tt('common.open')}
        </MenuItem>
        <MenuItem
          icon={<Star size={15} />}
          onSelect={() => {
            dispatch({ type: 'project/toggleFav', id: p.id });
            toast.info(p.fav ? tt('views.list.removedFromFavorites') : tt('views.list.addedToFavorites'), { duration: 1800 });
          }}
        >
          {p.fav ? tt('views.list.removeFromFavorites') : tt('views.list.addToFavorites')}
        </MenuItem>
        <MenuItem icon={<Pencil size={15} />} onSelect={() => projectForms.edit(p.id)}>
          {tt('views.project.renameEdit')}
        </MenuItem>
        <MenuItem icon={<Share2 size={15} />} onSelect={() => projectForms.share(p.id)}>
          {tt('views.project.share')}
        </MenuItem>
        <MenuItem
          icon={<Link2 size={15} />}
          onSelect={() => projectForms.copyLink(p.id)}
        >
          {tt('views.list.copyLink')}
        </MenuItem>
        <MenuItem icon={<Copy size={15} />} onSelect={() => projectForms.duplicate(p.id)}>
          {tt('views.project.duplicate')}
        </MenuItem>
        <MenuSeparator />
        {idx > 0 && (
          <MenuItem icon={<ArrowUp size={15} />} onSelect={() => move(-1)}>
            {tt('views.project.moveUp')}
          </MenuItem>
        )}
        {idx >= 0 && idx < order.length - 1 && (
          <MenuItem icon={<ArrowDown size={15} />} onSelect={() => move(1)}>
            {tt('views.project.moveDown')}
          </MenuItem>
        )}
        {order.length > 1 && <MenuSeparator />}
        <MenuItem icon={<Archive size={15} />} onSelect={() => projectForms.archive(p.id)}>
          {p.status === 'complete' ? tt('views.project.archive') : tt('views.project.archiveProject')}
        </MenuItem>
        <MenuItem icon={<Trash2 size={15} />} danger onSelect={() => projectForms.remove(p.id)}>
          {tt('views.project.delete')}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

/** Карточка проекта для сеток (projectCard из pages/projects.js) */
export function ProjectCard({ project: p }: { project: Project }) {
  const { data } = useWorkspace();
  const navigate = useNavigate();
  const tt = useT();
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
            {p.module !== 'general' && <Badge tone="accent">{TASK_MODULE_LABELS[p.module]}</Badge>}
            {p.private && (
              <Tooltip content={tt('views.project.private')}>
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
          {tt('views.project.restricted')}
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
