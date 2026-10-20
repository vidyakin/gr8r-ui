/* Боковая навигация — порт renderSidebar() из shell/layout.js */
import * as React from 'react';
import { NavLink, useMatch, useNavigate } from 'react-router';
import {
  BookOpen,
  ChartGantt,
  ChevronRight,
  ChevronsUpDown,
  CircleHelp,
  Ellipsis,
  Keyboard,
  Link as LinkIcon,
  List,
  Lock,
  MessageCircle,
  PanelLeft,
  Paperclip,
  Plus,
  SquareKanban,
  Star,
} from 'lucide-react';
import { IconButton, Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger, Tooltip, toast } from '@/components/ui';
import { cn } from '@/lib/utils';
import { SECTIONS, type SectionId } from '../routes';
import { useWorkspace } from '../data/store';
import { useSession } from '../data/session';
import { NewWorkspaceDialog } from '../overlays/new-workspace';
import { PROJECT_STATUS, allTasks, projectColor, visibleProjects } from '../data/selectors';
import { diffDays, parse, today } from '../lib/dates';
import { WorkspaceLogo } from '../components/brand';
import { NamedIcon } from '../components/icons';
import { UserMenu } from './UserMenu';
import { MemberAvatar } from '../components/workspace';
import { useProjectForms, useShortcuts, useTeamForm } from '../overlays';

const soon = (what: string) => toast.info(`${what} пока не перенесено`);

interface ItemProps {
  to: string;
  label: string;
  icon: React.ReactNode;
  count?: number | string;
  dot?: boolean;
  collapsed: boolean;
  end?: boolean;
}

/** NavLink с классом .sitem/.on. className-функция остаётся внутри: Radix Slot (Tooltip asChild)
    склеивает className как строки и превратил бы функцию в текст. */
function SideLink({ className, ...props }: Omit<React.ComponentProps<typeof NavLink>, 'className'> & { className?: string }) {
  return <NavLink className={({ isActive }) => cn('sitem', isActive && 'on', className)} {...props} />;
}

/** Пункт навигации (sItem). В свёрнутом режиме подпись уходит в тултип справа. */
function Item({ to, label, icon, count, dot, collapsed, end }: ItemProps) {
  const link = (
    <SideLink to={to} end={end} aria-label={collapsed ? label : undefined}>
      {icon}
      <span className="trunc">{label}</span>
      {!!count && <span className={cn('ct', dot && 'dotc')}>{count}</span>}
    </SideLink>
  );
  return collapsed ? (
    <Tooltip content={label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

function SectionItem({ id, collapsed, count, dot }: { id: SectionId; collapsed: boolean; count?: number; dot?: boolean }) {
  const s = SECTIONS[id];
  return <Item to={s.path} label={s.name} icon={<s.icon size={16} />} count={count} dot={dot} collapsed={collapsed} end={s.path === '/' || s.path === '/projects' || s.path === '/members' || s.path === '/crm'} />;
}

const SUB_PAGES = [
  ['board', 'Board', SquareKanban],
  ['list', 'List', List],
  ['timeline', 'Timeline', ChartGantt],
  ['files', 'Files', Paperclip],
] as const;

function ProjectItem({ id, collapsed }: { id: string; collapsed: boolean }) {
  const { data } = useWorkspace();
  const navigate = useNavigate();
  const p = data.projects.find(x => x.id === id)!;
  const match = useMatch('/projects/:id/:tab?');
  const on = match?.params.id === p.id;
  const [open, setOpen] = React.useState(false);
  const st = PROJECT_STATUS[p.status];

  const row = (
    <div
      className={cn('sitem', on && 'on')}
      role="link"
      tabIndex={0}
      onClick={() => navigate(`/projects/${p.id}`)}
      onKeyDown={e => e.key === 'Enter' && navigate(`/projects/${p.id}`)}
      aria-label={collapsed ? p.name : undefined}
    >
      <span
        className="pico"
        style={{ '--c': projectColor(p) } as React.CSSProperties}
        onClick={e => {
          e.stopPropagation();
          setOpen(o => !o);
        }}
      >
        <NamedIcon name={p.icon} size={12} />
      </span>
      <span className="trunc">{p.name}</span>
      {p.fav && (
        <span className="fav">
          <Star size={11} />
        </span>
      )}
      {p.private && (
        <span className="faint" style={{ marginLeft: 4 }}>
          <Lock size={11} />
        </span>
      )}
      <span className="sdot" style={{ background: st.c }} title={st.name} />
      <span className="hov" onClick={e => e.stopPropagation()}>
        <Menu>
          <MenuTrigger asChild>
            <button className="ibtn ibtn-xs" aria-label="Project options">
              <Ellipsis size={14} />
            </button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem icon={<Star size={15} />} onSelect={() => soon('Избранное')}>
              {p.fav ? 'Remove from favorites' : 'Add to favorites'}
            </MenuItem>
            <MenuItem icon={<LinkIcon size={15} />} onSelect={() => toast('Link copied')}>
              Copy link
            </MenuItem>
          </MenuContent>
        </Menu>
        <button className="ibtn ibtn-xs" aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open} onClick={() => setOpen(o => !o)}>
          <ChevronRight size={13} className={cn('chev', open && 'open')} />
        </button>
      </span>
    </div>
  );

  return (
    <div className="sproj">
      {collapsed ? (
        <Tooltip content={p.name} side="right">
          {row}
        </Tooltip>
      ) : (
        row
      )}
      <div className={cn('sub', open && !collapsed && 'open')}>
        {SUB_PAGES.map(([tab, name, Icon]) => (
          <SideLink key={tab} to={`/projects/${p.id}/${tab}`}>
            <Icon size={14} />
            <span>{name}</span>
          </SideLink>
        ))}
      </div>
    </div>
  );
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { data } = useWorkspace();
  const shortcuts = useShortcuts();
  const unreadInbox = data.notifs.filter(n => !n.read && n.type !== 'update').length;
  const unreadAll = data.notifs.filter(n => !n.read).length;
  const myDue = allTasks(data).filter(t => t.assignee === data.me && t.status !== 'done' && t.due && diffDays(parse(t.due), today()) <= 0).length;
  const projects = visibleProjects(data).filter(p => p.status !== 'complete');
  const archived = data.tasks.filter(t => t.archived).length + data.projects.filter(p => p.archived).length;
  const me = data.members.find(m => m.id === data.me)!;
  const projectForms = useProjectForms();
  const teamForm = useTeamForm();
  const session = useSession();
  const navigate = useNavigate();
  const [newWs, setNewWs] = React.useState(false);

  return (
    <nav className="side" aria-label="Main">
      <NewWorkspaceDialog open={newWs} onOpenChange={setNewWs} />
      <div className="side-top">
        <div className="row" style={{ gap: 2 }}>
          <Menu>
            <MenuTrigger asChild>
              <button className="ws flex-1" aria-label="Switch workspace">
                <WorkspaceLogo ws={data.ws} />
                <span className="ws-name trunc">{data.ws.name}</span>
                <span className="chev-d faint">
                  <ChevronsUpDown size={13} />
                </span>
              </button>
            </MenuTrigger>
            <MenuContent className="min-w-[220px]">
              <MenuLabel>Workspaces</MenuLabel>
              <MenuRadioGroup
                value={session.active?.id}
                onValueChange={id => {
                  session.switchWorkspace(id);
                  navigate('/');
                }}
              >
                {session.workspaces.map(w => (
                  <MenuRadioItem key={w.id} value={w.id} icon={<WorkspaceLogo ws={{ name: w.name, url: w.slug, c: w.color, brand: w.brand }} size={18} />}>
                    {w.name}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
              <MenuSeparator />
              <MenuItem icon={<Plus size={15} />} onSelect={() => setNewWs(true)}>
                Create workspace
              </MenuItem>
            </MenuContent>
          </Menu>
          {!collapsed && (
            <IconButton size="sm" className="hide-m" label="Collapse sidebar" shortcut="[" onClick={onToggle}>
              <PanelLeft size={15} />
            </IconButton>
          )}
        </div>
      </div>

      <div className="side-scroll">
        {collapsed && (
          <Tooltip content="Expand sidebar" side="right">
            <button className="sitem" aria-label="Expand sidebar" onClick={onToggle}>
              <PanelLeft size={16} />
            </button>
          </Tooltip>
        )}
        <SectionItem id="home" collapsed={collapsed} />
        <SectionItem id="inbox" collapsed={collapsed} count={unreadInbox} dot />
        <SectionItem id="mytasks" collapsed={collapsed} count={myDue} />
        <SectionItem id="favorites" collapsed={collapsed} />
        <SectionItem id="notifications" collapsed={collapsed} count={unreadAll} />

        <div className="sgroup">
          <div className="sgroup-h">Workspace</div>
          {(['overview', 'projects', 'tasks', 'calendar', 'timeline', 'members', 'activity'] as const).map(id => (
            <SectionItem key={id} id={id} collapsed={collapsed} />
          ))}
        </div>

        <div className="sgroup">
          <div className="sgroup-h">CRM</div>
          {(['crm', 'crmDeals', 'crmCompanies', 'crmContacts', 'crmActivities'] as const).map(id => (
            <SectionItem key={id} id={id} collapsed={collapsed} />
          ))}
        </div>

        <div className="sgroup">
          <div className="sgroup-h">
            <span>Projects</span>
            <span className="sp" />
            <IconButton size="xs" label="New project" shortcut="P" onClick={() => projectForms.create()}>
              <Plus size={14} />
            </IconButton>
          </div>
          {projects.map(p => (
            <ProjectItem key={p.id} id={p.id} collapsed={collapsed} />
          ))}
          <SectionItem id="archive" collapsed={collapsed} count={archived} />
        </div>

        <div className="sgroup">
          <div className="sgroup-h">
            <span>Teams</span>
            <span className="sp" />
            <IconButton size="xs" label="New team" onClick={() => teamForm.create()}>
              <Plus size={14} />
            </IconButton>
          </div>
          {data.teams.map(t => (
            <Item key={t.id} to={`/teams/${t.id}`} label={t.name} icon={<NamedIcon name={t.icon} size={16} />} collapsed={collapsed} />
          ))}
        </div>
      </div>

      <div className="side-bot">
        <Menu>
          <MenuTrigger asChild>
            <button className="sitem" aria-label={collapsed ? 'Help' : undefined}>
              <CircleHelp size={16} />
              <span>Help &amp; resources</span>
            </button>
          </MenuTrigger>
          <MenuContent side="top">
            <MenuItem icon={<BookOpen size={15} />}>Documentation</MenuItem>
            <MenuItem icon={<Keyboard size={15} />} shortcut="?" onSelect={() => shortcuts.open()}>
              Keyboard shortcuts
            </MenuItem>
            <MenuItem icon={<MessageCircle size={15} />}>Contact support</MenuItem>
          </MenuContent>
        </Menu>
        <SectionItem id="settings" collapsed={collapsed} />
        <UserMenu side="top" align="start">
          <button className="sitem" style={{ height: 36 }} aria-label={collapsed ? 'Profile' : undefined}>
            <MemberAvatar id={data.me} online tooltip={false} />
            <span className="trunc" style={{ color: 'var(--text)', fontWeight: 500 }}>
              {me.name}
            </span>
            <span className="ct">
              <ChevronsUpDown size={13} />
            </span>
          </button>
        </UserMenu>
      </div>
    </nav>
  );
}
