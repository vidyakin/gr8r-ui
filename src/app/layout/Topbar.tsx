/* Верхняя панель — порт renderTopbar() и crumbs() из shell/layout.js */
import { Link, useLocation } from 'react-router';
import { Bell, ChevronDown, CircleCheck, FolderPlus, Menu as MenuIcon, Plus, Search, UserPlus } from 'lucide-react';
import { Button, IconButton, Menu, MenuContent, MenuItem, MenuTrigger, Tooltip, toast } from '@/components/ui';
import { useWorkspace } from '../data/store';
import { project } from '../data/selectors';
import { SECTIONS } from '../routes';
import { MemberAvatar } from '../components/workspace';
import { ProjectIcon } from '../components/project';
import { UserMenu } from './UserMenu';
import { MOD } from '../lib/platform';
import { useInvite, useProjectForms, useTaskForm } from '../overlays';


export interface Crumb {
  label: string;
  to?: string;
  icon?: React.ReactNode;
}

/** Хлебные крошки и заголовок вкладки выводятся из адреса */
export function useCrumbs(): Crumb[] {
  const { pathname } = useLocation();
  const { data } = useWorkspace();
  const [, a, b] = pathname.split('/');
  if (a === 'projects' && b) {
    const p = project(data, b);
    return [
      { label: 'Projects', to: SECTIONS.projects.path },
      // Как в оригинале: вкладка проекта в крошки не попадает, проект — текущая страница
      ...(p ? [{ label: p.name, icon: <ProjectIcon project={p} size={11} className="!size-4 !rounded" /> }] : []),
    ];
  }
  if (a === 'members' && b) return [{ label: 'Members', to: SECTIONS.members.path }, { label: data.members.find(m => m.id === b)?.name ?? 'Member' }];
  if (a === 'teams' && b) return [{ label: 'Teams' }, { label: data.teams.find(t => t.id === b)?.name ?? 'Team' }];
  const s = Object.values(SECTIONS).find(x => x.path === pathname);
  return [{ label: s?.name ?? 'Not found' }];
}

export function Topbar({ onOpenNav }: { onOpenNav: () => void }) {
  const { data } = useWorkspace();
  const crumbs = useCrumbs();
  const unread = data.notifs.some(n => !n.read);
  const soon = (what: string) => toast.info(`${what} пока не перенесено`);
  const taskForm = useTaskForm();
  const projectForms = useProjectForms();
  const invite = useInvite();

  return (
    <header className="topbar">
      <IconButton className="min-[901px]:!hidden" label="Open navigation" tooltip={false} onClick={onOpenNav}>
        <MenuIcon size={17} />
      </IconButton>
      <nav className="crumbs trunc" aria-label="Breadcrumb">
        {crumbs.map((c, i) => {
          // Крошка со ссылкой не бывает «текущей» (неизвестный проект: остаётся одна ссылка «Projects», как в оригинале)
          const last = i === crumbs.length - 1 && !c.to;
          return (
            <span key={i} className="contents">
              {i > 0 && <span className="sep">/</span>}
              {c.to && !last ? (
                <Link to={c.to} className="inline-flex items-center gap-1.5 whitespace-nowrap py-[3px] transition-colors hover:text-text max-sm:hidden">
                  {c.icon}
                  {c.label}
                </Link>
              ) : (
                <span className={last ? 'cur inline-flex items-center gap-1.5 whitespace-nowrap py-[3px]' : undefined} aria-current={last ? 'page' : undefined}>
                  {c.icon}
                  {c.label}
                </span>
              )}
            </span>
          );
        })}
      </nav>
      <span className="sp" />
      <button className="topsearch" aria-label="Search and commands" onClick={() => soon('Поиск и палитра команд')}>
        <Search size={14} />
        <span className="lbltxt">Search or jump to…</span>
        <span className="kbd">{MOD}K</span>
      </button>
      <Tooltip content="Notifications">
        <Link to={SECTIONS.notifications.path} className="ibtn" aria-label="Notifications">
          <Bell size={16} />
          {unread && <span className="absolute top-1.5 right-[7px] size-[7px] rounded-full bg-brand shadow-[0_0_0_2px_var(--surface)]" />}
        </Link>
      </Tooltip>
      <Menu>
        <MenuTrigger asChild>
          <Button size="sm" aria-label="Create new">
            <Plus size={14} />
            <span className="hide-m">New</span>
            <ChevronDown size={12} className="hide-m" />
          </Button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem icon={<CircleCheck size={15} />} shortcut="C" onSelect={() => taskForm.open()}>
            New task
          </MenuItem>
          <MenuItem icon={<FolderPlus size={15} />} shortcut="P" onSelect={() => projectForms.create()}>
            New project
          </MenuItem>
          <MenuItem icon={<UserPlus size={15} />} onSelect={() => invite.open()}>
            Invite member
          </MenuItem>
        </MenuContent>
      </Menu>
      <UserMenu>
        <button className="ibtn hide-m" aria-label="Account menu" style={{ width: 'auto', padding: '0 2px' }}>
          <MemberAvatar id={data.me} size="md" tooltip={false} />
        </button>
      </UserMenu>
    </header>
  );
}
