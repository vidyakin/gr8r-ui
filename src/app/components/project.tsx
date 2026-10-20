import { cn } from '@/lib/utils';
import { PROJECT_STATUS, projectColor } from '../data/selectors';
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
export function ProjectDot({ project }: { project?: Project | null }) {
  return <span className="pdot" style={{ '--c': projectColor(project) } as React.CSSProperties} />;
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
