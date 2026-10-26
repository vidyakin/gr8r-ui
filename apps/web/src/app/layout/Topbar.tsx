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
import { useT } from '@/i18n';


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
  const t = useT();
  const S = SECTIONS;
  const nf = t('common.notFound');
  if (a === 'data' && b) return [{ label: t('nav.crumbs.data') }, { label: entities.find(e => e.key === b)?.name ?? nf }];
  if (a === 'crm') {
    const sec = Object.values(SECTIONS).find(x => x.path === `/crm${b ? '/' + b : ''}`);
    const crumbs: Crumb[] = [{ label: t('nav.groups.crm'), to: SECTIONS.crm.path }];
    if (b === 'companies' && c) return [...crumbs, { label: S.crmCompanies.name, to: SECTIONS.crmCompanies.path }, { label: crmCompany(crm.data, c)?.name ?? t('nav.crumbs.company') }];
    return [...crumbs, { label: sec?.name ?? nf }];
  }
  if (a === 'projects' && b) {
    const p = project(data, b);
    return [
      { label: S.projects.name, to: SECTIONS.projects.path },
      // Как в оригинале: вкладка проекта в крошки не попадает, проект — текущая страница
      ...(p ? [{ label: p.name, icon: <ProjectIcon project={p} size={11} className="!size-4 !rounded" /> }] : []),
    ];
  }
  if (a === 'members' && b) return [{ label: S.members.name, to: SECTIONS.members.path }, { label: data.members.find(m => m.id === b)?.name ?? t('nav.crumbs.member') }];
  if (a === 'automations') return b === 'flow' ? [{ label: S.automations.name, to: SECTIONS.automations.path }, { label: t('nav.crumbs.editor') }] : [{ label: S.automations.name }];
  if (a === 'catalog') return [{ label: S.catalog.name }];
  if (a === 'inventory') return [{ label: S.inventory.name }];
  if (a === 'stock-docs') return [{ label: S.stockDocs.name }];
  if (a === 'material-allocations') return b ? [{ label: S.materialAllocation.name, to: SECTIONS.materialAllocation.path }, { label: t('nav.crumbs.document') }] : [{ label: S.materialAllocation.name }];
  if (a === 'other-costs') return b ? [{ label: S.otherCosts.name, to: SECTIONS.otherCosts.path }, { label: t('nav.crumbs.document') }] : [{ label: S.otherCosts.name }];
  if (a === 'investments') return b === 'plan-fact' ? [{ label: S.investments.name, to: SECTIONS.investments.path }, { label: S.investmentsPlanFact.name }] : b ? [{ label: S.investments.name, to: SECTIONS.investments.path }, { label: t('nav.crumbs.investment') }] : [{ label: S.investments.name }];
  if (a === 'documents' && b) return [{ label: t('nav.crumbs.documents') }, { label: docTitle ?? t('nav.crumbs.document'), ...(c === 'print' ? { to: `/documents/${b}` } : {}) }, ...(c === 'print' ? [{ label: t('nav.crumbs.print') }] : [])];
  if (a === 'production' && b === 'workbench') return [{ label: S.production.name, to: SECTIONS.production.path }, { label: SECTIONS.productionWorkbench.name }];
  if (a === 'production' && b === 'orders') return [{ label: S.production.name, to: SECTIONS.production.path }, { label: SECTIONS.productionOrders.name }];
  if (a === 'production' && b === 'needs') return [{ label: S.production.name, to: SECTIONS.production.path }, { label: SECTIONS.productionNeeds.name }];
  if (a === 'production' && b === 'planner') return [{ label: S.production.name, to: SECTIONS.production.path }, { label: SECTIONS.productionPlanner.name }];
  if (a === 'production' && b === 'resources') return [{ label: S.production.name, to: SECTIONS.production.path }, { label: SECTIONS.productionResources.name }];
  if (a === 'production' && b) return [{ label: S.production.name, to: SECTIONS.production.path }, { label: itemName ?? t('nav.crumbs.product') }];
  if (a === 'settings') return [{ label: S.settings.name }];
  if (a === 'teams' && !b) return [{ label: t('nav.groups.teams') }];
  if (a === 'teams' && b) return [{ label: t('nav.groups.teams'), to: '/teams' },{ label: data.teams.find(x => x.id === b)?.name ?? t('nav.crumbs.team') }];
  const s = Object.values(SECTIONS).find(x => x.path === pathname);
  return [{ label: s?.name ?? nf }];
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
  const t = useT();

  return (
    <header className="topbar">
      <IconButton className="min-[901px]:!hidden" label={t('nav.openNav')} tooltip={false} onClick={onOpenNav}>
        <MenuIcon size={17} />
      </IconButton>
      <nav className="crumbs trunc" aria-label={t('nav.breadcrumb')}>
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
      <button className="topsearch" aria-label={t('nav.search')} onClick={() => palette.open()}>
        <Search size={14} />
        <span className="lbltxt">{t('nav.searchHint')}</span>
        <span className="kbd">{MOD}K</span>
      </button>
      <Tooltip content={SECTIONS.notifications.name}>
        <Link to={SECTIONS.notifications.path} className="ibtn" aria-label={SECTIONS.notifications.name}>
          <Bell size={16} />
          {unread && <span className="absolute top-1.5 right-[7px] size-[7px] rounded-full bg-brand shadow-[0_0_0_2px_var(--surface)]" />}
        </Link>
      </Tooltip>
      <Menu>
        <MenuTrigger asChild>
          <Button size="sm" aria-label={t('nav.createNew')}>
            <Plus size={14} />
            <span className="hide-m">{t('nav.new')}</span>
            <ChevronDown size={12} className="hide-m" />
          </Button>
        </MenuTrigger>
        <MenuContent align="end">
          {inCrm && (
            <>
              <MenuItem icon={<Handshake size={15} />} onSelect={() => crmUi.newDeal()}>
                {t('nav.newDeal')}
              </MenuItem>
              <MenuItem icon={<Building2 size={15} />} onSelect={() => crmUi.newCompany()}>
                {t('nav.newCompany')}
              </MenuItem>
              <MenuItem icon={<ContactRound size={15} />} onSelect={() => crmUi.newContact()}>
                {t('nav.newContact')}
              </MenuItem>
              <MenuSeparator />
            </>
          )}
          <MenuItem icon={<CircleCheck size={15} />} shortcut="N" onSelect={() => taskForm.open()}>
            {t('nav.newTask')}
          </MenuItem>
          <MenuItem icon={<FolderPlus size={15} />} shortcut="P" onSelect={() => projectForms.create()}>
            {t('nav.newProject')}
          </MenuItem>
          <MenuItem icon={<Users size={15} />} onSelect={() => teamForm.create()}>
            {t('nav.newTeam')}
          </MenuItem>
          <MenuItem icon={<UserPlus size={15} />} onSelect={() => invite.open()}>
            {t('nav.inviteMember')}
          </MenuItem>
        </MenuContent>
      </Menu>
      <UserMenu>
        <button className="ibtn hide-m" aria-label={t('nav.accountMenu')} style={{ width: 'auto', padding: '0 2px' }}>
          <MemberAvatar id={data.me} size="md" tooltip={false} />
        </button>
      </UserMenu>
    </header>
  );
}
