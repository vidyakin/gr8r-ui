/* Участники — порт pageMembers, permsTable и teamsGrid из pages/members.js */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { Check, Folder, Minus, Plus, Search, SearchX, UserPlus, Users } from 'lucide-react';
import { Button, EmptyState, Input, Segmented, Tab, Tabs, TabsContent, TabsList, toast } from '@/components/ui';
import { useWorkspace } from '../data/store';
import { allTasks, visibleProjects } from '../data/selectors';
import { ago, minsAgo } from '../lib/dates';
import { MemberAvatar, MemberStack } from '../components/workspace';
import { NamedIcon } from '../components/icons';
import { MemberMenu, MemberStatus, RoleCell, useMemberActions } from '../components/member';
import { useInvite } from '../overlays';

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

function PermsTable() {
  return (
    <div className="panel" style={{ overflowX: 'auto' }}>
      <table className="perm-t" style={{ minWidth: 560 }}>
        <thead>
          <tr>
            <th style={{ paddingLeft: 14 }}>Permission</th>
            {ROLES.map(r => (
              <th key={r}>{r}</th>
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
                    <span style={{ color: 'var(--green)', display: 'inline-flex' }} aria-label="Allowed">
                      <Check size={15} />
                    </span>
                  ) : (
                    <span className="faint" style={{ display: 'inline-flex' }} aria-label="Not allowed">
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

function TeamsGrid() {
  const { data } = useWorkspace();
  const navigate = useNavigate();
  const projects = visibleProjects(data);
  return (
    <div className="pgrid">
      {data.teams.map(t => {
        const ms = data.members.filter(m => m.team === t.id);
        const ps = projects.filter(p => p.team === t.id);
        const go = () => navigate(`/teams/${t.id}`);
        return (
          <div key={t.id} className="pcard" role="link" tabIndex={0} aria-label={t.name} onClick={go} onKeyDown={e => e.key === 'Enter' && e.target === e.currentTarget && go()}>
            <div className="row">
              <span className="picon" style={{ '--c': t.c } as React.CSSProperties}>
                <NamedIcon name={t.icon} size={15} />
              </span>
              <b style={{ fontWeight: 600, fontSize: 14 }}>{t.name}</b>
            </div>
            <div className="desc">{t.desc}</div>
            <div className="foot">
              <span className="row" style={{ gap: 4 }}>
                <Users size={12} />
                {ms.length} members
              </span>
              <span className="row" style={{ gap: 4 }}>
                <Folder size={12} />
                {ps.length} projects
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
  const { data } = useWorkspace();
  const navigate = useNavigate();
  const invite = useInvite();
  const actions = useMemberActions();
  const [tab, setTab] = React.useState<TabId>('members');
  const [q, setQ] = React.useState('');
  const [role, setRole] = React.useState<string>('all');

  const needle = q.toLowerCase();
  const ms = data.members.filter(m => (role === 'all' || m.role === role) && (!needle || m.name.toLowerCase().includes(needle) || m.email.includes(needle)));
  const projects = visibleProjects(data);
  const tasks = allTasks(data);

  return (
    <div className="page wide" style={{ maxWidth: 1200 }}>
      <div className="ph">
        <div>
          <h1>Members</h1>
          <p>
            {data.members.length} people in {data.ws.name} · {data.members.filter(m => m.status === 'invited').length} pending
          </p>
        </div>
        <div className="acts">
          <Button variant="primary" onClick={() => invite.open()}>
            <UserPlus size={14} />
            Invite member
          </Button>
        </div>
      </div>
      <Tabs value={tab} onValueChange={v => setTab(v as TabId)}>
        <TabsList style={{ marginBottom: 14 }}>
          <Tab value="members">Members</Tab>
          <Tab value="teams">Teams</Tab>
          <Tab value="roles">Roles &amp; permissions</Tab>
        </TabsList>
        <TabsContent value="teams">
          <div className="row" style={{ marginBottom: 12 }}>
            <span className="muted" style={{ fontSize: 13 }}>
              {data.teams.length} teams
            </span>
            <span className="sp" />
            <Button variant="secondary" size="sm" onClick={() => toast.info('Создание команды пока не перенесено')}>
              <Plus size={13} />
              New team
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
              <Input size="sm" icon={<Search size={13} />} placeholder="Search by name or email" aria-label="Search members" value={q} onChange={e => setQ(e.target.value)} />
            </div>
            <Segmented value={role} onValueChange={setRole} items={['all', ...ROLES].map(r => ({ value: r, label: r === 'all' ? 'All' : r }))} />
          </div>
          <div className="panel" style={{ overflowX: 'auto' }}>
            {ms.length ? (
              <table className="perm-t" style={{ minWidth: 880 }}>
                <thead>
                  <tr>
                    <th style={{ paddingLeft: 14 }}>Member</th>
                    <th style={{ textAlign: 'left' }}>Role</th>
                    <th style={{ textAlign: 'left' }}>Team</th>
                    <th>Active projects</th>
                    <th>Tasks</th>
                    <th style={{ textAlign: 'left' }}>Last active</th>
                    <th style={{ textAlign: 'left' }}>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {ms.map(m => {
                    const ap = projects.filter(p => p.members.includes(m.id) && p.status !== 'complete').length;
                    const ot = tasks.filter(t => t.assignee === m.id && t.status !== 'done').length;
                    const team = data.teams.find(t => t.id === m.team);
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
                                      (you)
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
                          {m.last == null ? '—' : m.last < 5 ? <span style={{ color: 'var(--green)' }}>Online</span> : ago(minsAgo(m.last))}
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
              <EmptyState size="sm" icon={<SearchX />} title="No results found">
                No members match that search.
              </EmptyState>
            )}
          </div>
        </TabsContent>
      </Tabs>
      {actions.confirm}
    </div>
  );
}
