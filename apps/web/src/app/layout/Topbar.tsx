/* Верхняя панель — порт renderTopbar() и crumbs() из shell/layout.js */
import { Link, useLocation, useMatch } from 'react-router';
import { Bell, Building2, ChevronDown, CircleCheck, FolderPlus, Handshake, Menu as MenuIcon, Plus, Search, UserPlus, Users, ContactRound } from 'lucide-react';
import { Button, IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tooltip } from '@/components/ui';
import { useWorkspace } from '../data/store';
import { project } from '../data/selectors';
import { SECTIONS } from '../routes';
import { useCachedItemName } from '../production/data';
import { useCachedDocTitle } from '../docs/data';
import { MemberAvatar } from '../components/workspace';
import { ProjectIcon } from '../components/project';
import { UserMenu } from './UserMenu';
import { MOD } from '../lib/platform';
import { useInvite, usePalette, useProjectForms, useTaskForm, useTeamForm } from '../overlays';
import { useCrm } from '../crm/store';
import { useCrmUi } from '../crm/ui-context';
import { company as crmCompany } from '../crm/selectors';
import { useEntities } from '../meta/data';


export interface Crumb {
  label: string;
  to?: string;
  icon?: React.ReactNode;
}

/** Хлебные крошки и заголовок вкладки выводятся из адреса */
export function useCrumbs(): Crumb[] {
  const { pathname } = useLocation();
  const { data } = useWorkspace();
  const crm = useCrm();
  const entities = useEntities();
  const [, a, b, c] = pathname.split('/');
  const itemName = useCachedItemName(a === 'production' ? b : undefined);
  const docTitle = useCachedDocTitle(a === 'documents' ? b : undefined);
  if (a === 'data' && b) return [{ label: 'Data' }, { label: entities.find(e => e.key === b)?.name ?? 'Not found' }];
  if (a === 'crm') {
    const sec = Object.values(SECTIONS).find(x => x.path === `/crm${b ? '/' + b : ''}`);
    const crumbs: Crumb[] = [{ label: 'CRM', to: SECTIONS.crm.path }];
    if (b === 'companies' && c) return [...crumbs, { label: 'Companies', to: SECTIONS.crmCompanies.path }, { label: crmCompany(crm.data, c)?.name ?? 'Company' }];
    return [...crumbs, { label: sec?.name ?? 'Not found' }];
  }
  if (a === 'projects' && b) {
    const p = project(data, b);
    return [
      { label: 'Projects', to: SECTIONS.projects.path },
      // Как в оригинале: вкладка проекта в крошки не попадает, проект — текущая страница
      ...(p ? [{ label: p.name, icon: <ProjectIcon project={p} size={11} className="!size-4 !rounded" /> }] : []),
    ];
  }
  if (a === 'members' && b) return [{ label: 'Members', to: SECTIONS.members.path }, { label: data.members.find(m => m.id === b)?.name ?? 'Member' }];
  if (a === 'automations') return b === 'flow' ? [{ label: 'Automations', to: SECTIONS.automations.path }, { label: 'Editor' }] : [{ label: 'Automations' }];
  if (a === 'catalog') return [{ label: 'Catalog' }];
  if (a === 'inventory') return [{ label: 'Inventory' }];
  if (a === 'stock-docs') return [{ label: 'Stock documents' }];
  if (a === 'documents' && b) return [{ label: 'Documents' }, { label: docTitle ?? 'Document', ...(c === 'print' ? { to: `/documents/${b}` } : {}) }, ...(c === 'print' ? [{ label: 'Print' }] : [])];
  if (a === 'production' && b === 'workbench') return [{ label: 'Production', to: SECTIONS.production.path }, { label: SECTIONS.productionWorkbench.name }];
  if (a === 'production' && b === 'orders') return [{ label: 'Production', to: SECTIONS.production.path }, { label: SECTIONS.productionOrders.name }];
  if (a === 'production' && b) return [{ label: 'Production', to: SECTIONS.production.path }, { label: itemName ?? 'Product' }];
  if (a === 'settings') return [{ label: 'Settings' }];
  if (a === 'teams' && !b) return [{ label: 'Teams' }];
  if (a === 'teams' && b) return [{ label: 'Teams', to: '/teams' },{ label: data.teams.find(t => t.id === b)?.name ?? 'Team' }];
  const s = Object.values(SECTIONS).find(x => x.path === pathname);
  return [{ label: s?.name ?? 'Not found' }];
}

export function Topbar({ onOpenNav }: { onOpenNav: () => void }) {
  const { data } = useWorkspace();
  const crumbs = useCrumbs();
  const unread = data.notifs.some(n => !n.read);
  const taskForm = useTaskForm();
  const projectForms = useProjectForms();
  const invite = useInvite();
  const teamForm = useTeamForm();
  const palette = usePalette();
  const crmUi = useCrmUi();
  const inCrm = !!useMatch('/crm/*');

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
      <button className="topsearch" aria-label="Search and commands" onClick={() => palette.open()}>
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
          {inCrm && (
            <>
              <MenuItem icon={<Handshake size={15} />} onSelect={() => crmUi.newDeal()}>
                New deal
              </MenuItem>
              <MenuItem icon={<Building2 size={15} />} onSelect={() => crmUi.newCompany()}>
                New company
              </MenuItem>
              <MenuItem icon={<ContactRound size={15} />} onSelect={() => crmUi.newContact()}>
                New contact
              </MenuItem>
              <MenuSeparator />
            </>
          )}
          <MenuItem icon={<CircleCheck size={15} />} shortcut="N" onSelect={() => taskForm.open()}>
            New task
          </MenuItem>
          <MenuItem icon={<FolderPlus size={15} />} shortcut="P" onSelect={() => projectForms.create()}>
            New project
          </MenuItem>
          <MenuItem icon={<Users size={15} />} onSelect={() => teamForm.create()}>
            New team
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
