/* Участники — порт pageMembers, permsTable и teamsGrid из pages/members.js */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { Check, Folder, Minus, Plus, Search, SearchX, UserPlus, Users } from 'lucide-react';
import { Button, EmptyState, Input, Segmented, Tab, Tabs, TabsContent, TabsList } from '@/components/ui';
import { useWorkspace } from '../data/store';
import { allTasks, visibleProjects } from '../data/selectors';
import { ago, minsAgo } from '../lib/dates';
import { MemberAvatar, MemberStack } from '../components/workspace';
import { NamedIcon } from '../components/icons';
import { MemberMenu, MemberStatus, RoleCell, useMemberActions } from '../components/member';
import { useInvite, useTeamForm } from '../overlays';
import { tEnum, useT } from '@/i18n';

type TabId = 'members' | 'teams' | 'roles';
const ROLES = ['Owner', 'Admin', 'Member', 'Guest'] as const;

/* Строки таблицы прав: право + доступ по ролям Owner / Admin / Member / Guest */
const PERMS: [string, 0 | 1, 0 | 1, 0 | 1, 0 | 1][] = [
  ['View projects & tasks', 1, 1, 1, 1],
  ['Comment on tasks', 1, 1, 1, 1],
  ['Create and edit tasks', 1, 1, 1, 0],
  ['Create projects', 1, 1, 1, 0],
  ['Invite members', 1, 1, 0, 0],
  ['Manage roles', 1, 1, 0, 0],
  ['Workspace settings', 1, 1, 0, 0],
  ['Billing', 1, 0, 0, 0],
  ['Delete workspace', 1, 0, 0, 0],
];

export function PermsTable() {
  const t = useT();
  return (
    <div className="panel" style={{ overflowX: 'auto' }}>
      <table className="perm-t" style={{ minWidth: 560 }}>
        <thead>
          <tr>
            <th style={{ paddingLeft: 14 }}>{t('pages.members.permsPermission')}</th>
            {ROLES.map(r => (
              <th key={r}>{tEnum('role', r, r)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERMS.map(([name, ...vals]) => (
            <tr key={name}>
              <td style={{ paddingLeft: 14 }}>{name}</td>
              {vals.map((v, i) => (
                <td key={i}>
                  {v ? (
                    <span style={{ color: 'var(--green)', display: 'inline-flex' }} aria-label={t('pages.members.permsAllowed')}>
                      <Check size={15} />
                    </span>
                  ) : (
                    <span className="faint" style={{ display: 'inline-flex' }} aria-label={t('pages.members.permsNotAllowed')}>
                      <Minus size={15} />
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TeamsGrid() {
  const t = useT();
  const { data } = useWorkspace();
  const navigate = useNavigate();
  const projects = visibleProjects(data);
  return (
    <div className="pgrid">
      {data.teams.map(team => {
        const ms = data.members.filter(m => m.team === team.id);
        const ps = projects.filter(p => p.team === team.id);
        const go = () => navigate(`/teams/${team.id}`);
        return (
          <div key={team.id} className="pcard" role="link" tabIndex={0} aria-label={team.name} onClick={go} onKeyDown={e => e.key === 'Enter' && e.target === e.currentTarget && go()}>
            <div className="row">
              <span className="picon" style={{ '--c': team.c } as React.CSSProperties}>
                <NamedIcon name={team.icon} size={15} />
              </span>
              <b style={{ fontWeight: 600, fontSize: 14 }}>{team.name}</b>
            </div>
            <div className="desc">{team.desc}</div>
            <div className="foot">
              <span className="row" style={{ gap: 4 }}>
                <Users size={12} />
                {t('pages.members.membersCount', { count: ms.length })}
              </span>
              <span className="row" style={{ gap: 4 }}>
                <Folder size={12} />
                {t('pages.members.projectsCount', { count: ps.length })}
              </span>
              <span className="sp" />
              <MemberStack ids={ms.map(m => m.id)} max={4} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MembersPage() {
  const t = useT();
  const { data } = useWorkspace();
  const navigate = useNavigate();
  const invite = useInvite();
  const teamForm = useTeamForm();
  const actions = useMemberActions();
  const [tab, setTab] = React.useState<TabId>('members');
  const [q, setQ] = React.useState('');
  const [role, setRole] = React.useState<string>('all');

  const needle = q.toLowerCase();
  const ms = data.members.filter(m => (role === 'all' || m.role === role) && (!needle || m.name.toLowerCase().includes(needle) || m.email.includes(needle)));
  const projects = visibleProjects(data);
  const tasks = allTasks(data);
  const invitedCount = data.members.filter(m => m.status === 'invited').length;

  return (
    <div className="page wide" style={{ maxWidth: 1200 }}>
      <div className="ph">
        <div>
          <h1>{t('pages.members.title')}</h1>
          <p>
            {t('pages.members.subline', { count: data.members.length, ws: data.ws.name, invited: invitedCount })}
          </p>
        </div>
        <div className="acts">
          <Button variant="primary" onClick={() => invite.open()}>
            <UserPlus size={14} />
            {t('pages.members.inviteMember')}
          </Button>
        </div>
      </div>
      <Tabs value={tab} onValueChange={v => setTab(v as TabId)}>
        <TabsList style={{ marginBottom: 14 }}>
          <Tab value="members">{t('pages.members.tabMembers')}</Tab>
          <Tab value="teams">{t('pages.members.tabTeams')}</Tab>
          <Tab value="roles">{t('pages.members.tabRoles')}</Tab>
        </TabsList>
        <TabsContent value="teams">
          <div className="row" style={{ marginBottom: 12 }}>
            <span className="muted" style={{ fontSize: 13 }}>
              {t('pages.members.teamsCount', { count: data.teams.length })}
            </span>
            <span className="sp" />
            <Button variant="secondary" size="sm" onClick={() => teamForm.create()}>
              <Plus size={13} />
              {t('pages.members.newTeam')}
            </Button>
          </div>
          <TeamsGrid />
        </TabsContent>
        <TabsContent value="roles">
          <PermsTable />
        </TabsContent>
        <TabsContent value="members">
          <div className="row" style={{ marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
            <div style={{ width: 200 }}>
              <Input size="sm" icon={<Search size={13} />} placeholder={t('pages.members.searchPlaceholder')} aria-label={t('pages.members.searchLabel')} value={q} onChange={e => setQ(e.target.value)} />
            </div>
            <Segmented value={role} onValueChange={setRole} items={['all', ...ROLES].map(r => ({ value: r, label: r === 'all' ? t('pages.members.all') : tEnum('role', r, r) }))} />
          </div>
          <div className="panel" style={{ overflowX: 'auto' }}>
            {ms.length ? (
              <table className="perm-t" style={{ minWidth: 880 }}>
                <thead>
                  <tr>
                    <th style={{ paddingLeft: 14 }}>{t('pages.members.colMember')}</th>
                    <th style={{ textAlign: 'left' }}>{t('pages.members.colRole')}</th>
                    <th style={{ textAlign: 'left' }}>{t('pages.members.colTeam')}</th>
                    <th>{t('pages.members.colActiveProjects')}</th>
                    <th>{t('pages.members.colTasks')}</th>
                    <th style={{ textAlign: 'left' }}>{t('pages.members.colLastActive')}</th>
                    <th style={{ textAlign: 'left' }}>{t('pages.members.colStatus')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {ms.map(m => {
                    const ap = projects.filter(p => p.members.includes(m.id) && p.status !== 'complete').length;
                    const ot = tasks.filter(x => x.assignee === m.id && x.status !== 'done').length;
                    const team = data.teams.find(x => x.id === m.team);
                    return (
                      <tr key={m.id}>
                        <td style={{ paddingLeft: 14 }}>
                          <button className="row" onClick={() => navigate(`/members/${m.id}`)} style={{ gap: 10, textAlign: 'left' }}>
                            <MemberAvatar id={m.id} size="md" tooltip={false} />
                            <span className="col">
                              <b style={{ fontWeight: 500 }}>
                                {m.name}
                                {m.id === data.me && (
                                  <>
                                    {' '}
                                    <span className="faint" style={{ fontWeight: 400 }}>
                                      {t('pages.members.youSuffix')}
                                    </span>
                                  </>
                                )}
                              </b>
                              <span className="faint" style={{ fontSize: 12 }}>
                                {m.email}
                              </span>
                            </span>
                          </button>
                        </td>
                        <td style={{ textAlign: 'left' }}>
                          <RoleCell m={m} actions={actions} />
                        </td>
                        <td style={{ textAlign: 'left' }}>
                          {team && (
                            <span className="row">
                              <NamedIcon name={team.icon} size={13} />
                              {team.name}
                            </span>
                          )}
                        </td>
                        <td className="num">{ap}</td>
                        <td className="num">{ot}</td>
                        <td style={{ textAlign: 'left' }} className="muted">
                          {m.last == null ? '—' : m.last < 5 ? <span style={{ color: 'var(--green)' }}>{t('pages.members.online')}</span> : ago(minsAgo(m.last))}
                        </td>
                        <td style={{ textAlign: 'left' }}>
                          <MemberStatus status={m.status} />
                        </td>
                        <td>
                          <MemberMenu m={m} actions={actions} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <EmptyState size="sm" icon={<SearchX />} title={t('pages.members.noResultsTitle')}>
                {t('pages.members.noResultsHint')}
              </EmptyState>
            )}
          </div>
        </TabsContent>
      </Tabs>
      {actions.confirm}
    </div>
  );
}
