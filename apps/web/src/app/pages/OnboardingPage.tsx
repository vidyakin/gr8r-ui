/* Онбординг — порт renderOnboarding из pages/auth.js и действий onbSet/onbNext/onbFinish из actions/actions.js */
import * as React from 'react';
import { Navigate, useNavigate } from 'react-router';
import { ArrowLeft, ArrowRight, Building2, Check, CircleCheck, Link, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui';
import { AuthCard, AuthShell, FieldErr } from '../components/auth-shell';
import { NamedIcon } from '../components/icons';
import { makeKey } from '../data/store';
import { apiFor, errorMessage, ok } from '../data/api';
import { useSession, type WorkspaceRef } from '../data/session';
import { TEMPLATES } from '../overlays/project-dialogs';
import { inviteLink } from '../overlays/invite';
import { EMAIL_RE } from '../lib/auth';
import { dOff } from '../lib/dates';
import { uuidv7 } from '../lib/uuid';

const N = 6;
const USES: [string, string, string, string][] = [
  ['product', 'target', 'Product', 'Roadmaps & launches'],
  ['design', 'palette', 'Design', 'Reviews & handoff'],
  ['marketing', 'megaphone', 'Marketing', 'Campaigns & content'],
  ['engineering', 'code', 'Engineering', 'Sprints & releases'],
  ['personal', 'user', 'Personal', 'Goals & side projects'],
  ['other', 'sparkles', 'Other', 'Something else'],
];
const TEAMS: [string, string, string, string][] = [
  ['kanban', 'square-kanban', 'Boards', 'Move cards through stages'],
  ['list', 'list-checks', 'Lists', 'Checklists and priorities'],
  ['timeline', 'chart-gantt', 'Timelines', 'Plan with dates & dependencies'],
  ['table', 'table-2', 'Tables', 'Spreadsheet-style tracking'],
];
const VIEW_NAME: Record<string, string> = { kanban: 'Board', list: 'List', timeline: 'Timeline', table: 'Table' };
const VIEW_TAB: Record<string, string> = { kanban: 'board', list: 'list', timeline: 'timeline', table: 'table' };

interface Onb {
  use: string;
  team: string;
  size: string;
  ws: string;
  url: string;
  proj: string;
  tmpl: string;
  invites: string[];
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const session = useSession();
  const [busy, setBusy] = React.useState(false);
  const [st, setSt] = React.useState(0);
  const [o, setO] = React.useState<Onb>({ use: 'product', team: 'kanban', size: '2-10', ws: '', url: '', proj: 'Website Launch', tmpl: 'web', invites: ['', '', ''] });
  const [wsErr, setWsErr] = React.useState('');
  const urlTouched = React.useRef(false);
  const projTouched = React.useRef(false);
  const box = React.useRef<HTMLDivElement>(null);

  const set = (patch: Partial<Onb>) => setO(x => ({ ...x, ...patch }));
  const opt = (k: 'use' | 'team' | 'tmpl', v: string, icon: string, n: string, s?: string) => (
    <button
      key={v}
      type="button"
      className={cn('opt', o[k] === v && 'on')}
      role="radio"
      aria-checked={o[k] === v}
      onClick={() => {
        const patch: Partial<Onb> = { [k]: v };
        if (k === 'tmpl' && !projTouched.current) {
          const t = TEMPLATES.find(x => x.id === v);
          if (t) patch.proj = t.name === 'Website' ? 'Website Launch' : t.name;
        }
        set(patch);
      }}
    >
      <NamedIcon name={icon} size={18} />
      <b>{n}</b>
      {s && <span>{s}</span>}
    </button>
  );

  // Автофокус первого поля шага (autofocus в оригинале)
  React.useEffect(() => {
    const t = window.setTimeout(() => box.current?.querySelector<HTMLInputElement>('input')?.focus(), 20);
    return () => window.clearTimeout(t);
  }, [st]);

  const next = (skip = false) => {
    if (st === 1 && !o.ws.trim()) {
      setWsErr('Name your workspace to continue');
      box.current?.querySelector<HTMLInputElement>('#o-ws')?.focus();
      return;
    }
    if (st === 1 && o.url && !/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(o.url)) {
      setWsErr('Workspace URL: 3-40 lowercase letters, digits and dashes');
      box.current?.querySelector<HTMLInputElement>('#o-url')?.focus();
      return;
    }
    if (st === 3 && !o.proj.trim()) {
      toast.error('Give your project a name');
      return;
    }
    if (st === 4 && skip) set({ invites: ['', '', ''] });
    if (st === 4 && !skip) {
      const bad = o.invites.filter(x => x && !EMAIL_RE.test(x));
      if (bad.length) {
        toast.error(`${bad[0]} isn't a valid email address`);
        return;
      }
    }
    setSt(s => s + 1);
  };

  /** Создаёт воркспейс, стартовый проект с задачами шаблона и приглашения — настоящими запросами к API */
  const finish = async () => {
    if (busy) return;
    const tm = TEMPLATES.find(t => t.id === o.tmpl) ?? TEMPLATES[2];
    setBusy(true);
    let ws: WorkspaceRef;
    try {
      ws = await ok<WorkspaceRef>(apiFor().workspaces.$post({ json: { name: o.ws.trim() || 'My workspace', ...(o.url ? { slug: o.url } : {}) } }));
    } catch (e) {
      // Занятый адрес и т. п. — возвращаем на шаг с названием
      setBusy(false);
      setWsErr(errorMessage(e));
      setSt(1);
      return;
    }
    try {
      const api = apiFor(ws.id);
      const members = await ok<{ items: { id: string; userId: string | null }[] }>(api.members.$get({ query: { limit: '200' } }));
      const meId = members.items.find(m => m.userId === session.user?.id)!.id;
      const id = uuidv7();
      await ok(
        api.projects.$post({
          json: {
            id,
            key: makeKey({ projects: [] }, o.proj.trim() || tm.name),
            name: o.proj.trim() || tm.name,
            description: `Created during setup from the ${tm.name} template.`,
            icon: tm.icon === 'file' ? 'folder' : tm.icon,
            color: 'indigo',
            leadId: meId,
            startDate: dOff(0),
            dueDate: dOff(30),
            members: [{ memberId: meId, permission: 'admin' }],
          },
        }),
      );
      for (const [i, title] of tm.tasks.entries()) {
        await ok(api.tasks.$post({ json: { projectId: id, title, status: i === 0 ? 'todo' : 'backlog', assigneeId: i === 0 ? meId : null, priority: i === 0 ? 8 : 5, dueDate: dOff(5 + i * 5), startDate: dOff(i * 5) } }));
      }
      for (const email of o.invites.filter(x => EMAIL_RE.test(x))) {
        try {
          await ok(api.workspaces[':id'].invites.$post({ param: { id: ws.id }, json: { email, role: 'member' } }));
        } catch (e) {
          toast.error(`${email}: ${errorMessage(e)}`);
        }
      }
      await session.refreshWorkspaces();
      session.switchWorkspace(ws.id);
      navigate(`/projects/${id}/${VIEW_TAB[o.team] ?? 'board'}`, { replace: true });
      toast(`Welcome to ${ws.name}`);
    } catch (e) {
      // Воркспейс уже создан — открываем его, остальное можно сделать из интерфейса
      toast.error(errorMessage(e));
      await session.refreshWorkspaces();
      session.switchWorkspace(ws.id);
      navigate('/', { replace: true });
    }
  };

  const nav = (label = 'Continue', skip = false) => (
    <div className="row" style={{ marginTop: 6 }}>
      {st > 0 && st < 5 && (
        <button type="button" className="btn btn-ghost" onClick={() => setSt(s => Math.max(0, s - 1))}>
          <ArrowLeft size={14} />
          Back
        </button>
      )}
      <span className="sp"></span>
      {skip && (
        <button type="button" className="btn btn-ghost" onClick={() => next(true)}>
          Skip for now
        </button>
      )}
      <button type="submit" className="btn btn-primary btn-lg" id="onb-next">
        {label}
        <ArrowRight size={15} />
      </button>
    </div>
  );

  if (session.status === 'anon') return <Navigate to="/signin" replace />;

  let body: React.ReactNode = null;
  if (st === 0)
    body = (
      <>
        <h1>What are you working on?</h1>
        <p className="sub">We'll tailor templates and views to fit. You can change this later.</p>
        <div className="opts" role="radiogroup">
          {USES.map(x => opt('use', ...x))}
        </div>
        {nav()}
      </>
    );
  if (st === 1)
    body = (
      <>
        <h1>Create your workspace</h1>
        <p className="sub">A workspace is where your team's projects live.</p>
        <div className="field">
          <label className="label" htmlFor="o-ws">
            Workspace name
          </label>
          <input
            className={cn('input input-lg', wsErr && 'is-error')}
            id="o-ws"
            data-af
            value={o.ws}
            placeholder="e.g. Gr8r Studio"
            onChange={e => {
              const ws = e.target.value;
              set({ ws, ...(urlTouched.current ? {} : { url: ws.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }) });
              if (ws.trim()) setWsErr('');
            }}
          />
          <FieldErr>{wsErr}</FieldErr>
        </div>
        <div className="field">
          <label className="label" htmlFor="o-url">
            Workspace URL
          </label>
          <div className="row" style={{ gap: 0 }}>
            <span className="input input-lg" style={{ width: 'auto', background: 'var(--surface-2)', borderRight: 0, borderRadius: '6px 0 0 6px', display: 'flex', alignItems: 'center', color: 'var(--text-2)' }}>
              gr8rstudio.com/
            </span>
            <input
              className="input input-lg"
              id="o-url"
              value={o.url}
              style={{ borderRadius: '0 6px 6px 0' }}
              placeholder="gr8rstudio"
              onChange={e => {
                urlTouched.current = true;
                set({ url: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-') });
              }}
            />
          </div>
          {o.url && (
            <span className="hint" style={{ color: 'var(--green)', display: 'flex', gap: 4, alignItems: 'center' }}>
              <Check size={12} />
              gr8rstudio.com/{o.url} is available
            </span>
          )}
        </div>
        {nav()}
      </>
    );
  if (st === 2)
    body = (
      <>
        <h1>How does your team work?</h1>
        <p className="sub">We'll set your default project view.</p>
        <div className="opts" role="radiogroup" style={{ gridTemplateColumns: 'repeat(2,minmax(0,1fr))' }}>
          {TEAMS.map(x => opt('team', ...x))}
        </div>
        <div className="field">
          <span className="label">Team size</span>
          <div className="seg" style={{ width: 'fit-content' }}>
            {['Just me', '2-10', '11-50', '51-200', '200+'].map(s => (
              <button key={s} type="button" className={o.size === s ? 'on' : ''} onClick={() => set({ size: s })}>
                {s}
              </button>
            ))}
          </div>
        </div>
        {nav()}
      </>
    );
  if (st === 3)
    body = (
      <>
        <h1>Create your first project</h1>
        <p className="sub">Start from a template or a blank project.</p>
        <div className="field">
          <label className="label" htmlFor="o-proj">
            Project name
          </label>
          <input
            className="input input-lg"
            id="o-proj"
            data-af
            value={o.proj}
            onChange={e => {
              projTouched.current = true;
              set({ proj: e.target.value });
            }}
          />
        </div>
        <div className="tmpls" role="radiogroup">
          {TEMPLATES.filter(t => t.id !== 'blank').map(t => opt('tmpl', t.id, t.icon, t.name, t.tasks.length + ' starter tasks'))}
        </div>
        {nav()}
      </>
    );
  if (st === 4)
    body = (
      <>
        <h1>Invite your team</h1>
        <p className="sub">Gr8r works best with your teammates. They'll get an email invite.</p>
        <div className="col" style={{ gap: 8 }}>
          {[0, 1, 2].map(i => (
            <input key={i} className="input input-lg" id={`o-inv-${i}`} placeholder="teammate@company.com" type="email" value={o.invites[i]} aria-label={`Teammate email ${i + 1}`} onChange={e => set({ invites: o.invites.map((v, j) => (j === i ? e.target.value.trim() : v)) })} />
          ))}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => {
            navigator.clipboard?.writeText(inviteLink(o.url || 'workspace')).catch(() => {});
            toast('Invite link copied');
          }}
        >
          <Link size={13} />
          Copy invite link instead
        </button>
        {nav('Send invites', true)}
      </>
    );
  if (st === 5) {
    const n = o.invites.filter(x => x.includes('@')).length;
    const tm = TEMPLATES.find(t => t.id === o.tmpl);
    const rows: [React.ReactNode, string, string][] = [
      [<Building2 size={14} />, `Workspace “${o.ws || 'My Workspace'}”`, 'gr8rstudio.com/' + (o.url || 'workspace')],
      [<NamedIcon name={tm?.icon || 'folder'} size={14} />, `Project “${o.proj}”`, `${tm?.tasks.length || 0} starter tasks · ${VIEW_NAME[o.team]} view`],
      [<UserPlus size={14} />, n ? `${n} invite${n > 1 ? 's' : ''} sent` : 'No invites yet', n ? "They'll appear in Members once they join" : 'Invite people any time from the sidebar'],
    ];
    body = (
      <>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <span className="ftype ready-badge" style={{ '--c': 'var(--green)', width: 48, height: 48, borderRadius: 12 } as React.CSSProperties}>
            <CircleCheck size={22} />
          </span>
        </div>
        <h1>Your workspace is ready</h1>
        <p className="sub">Here's what we set up for you.</p>
        <div className="panel">
          {rows.map(([icon, t, s], i) => (
            <div key={i} className="row ready-row" style={{ padding: '12px 14px', borderTop: '1px solid var(--divider)', gap: 12 }}>
              <span className="ftype" style={{ '--c': 'var(--accent)' } as React.CSSProperties}>
                {icon}
              </span>
              <div className="grow" style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{t}</div>
                <div className="faint" style={{ fontSize: 12 }}>
                  {s}
                </div>
              </div>
              <span className="ok" style={{ color: 'var(--green)', display: 'inline-flex' }}>
                <Check size={15} />
              </span>
            </div>
          ))}
        </div>
        <button type="button" className={cn('btn btn-primary btn-lg btn-block', busy && 'is-loading')} disabled={busy} onClick={() => void finish()}>
          Open workspace
          <ArrowRight size={15} />
        </button>
      </>
    );
  }

  return (
    <AuthShell
      topRight={
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/', { replace: true })}>
          Exit setup
        </button>
      }
    >
      <div ref={box} className="contents">
        <AuthCard
          key={st}
          as={st === 5 ? 'div' : 'form'}
          fx="fx-step"
          className="onb"
          style={{ maxWidth: st === 5 ? 440 : 560 }}
          {...(st === 5
            ? {}
            : {
                noValidate: true,
                onSubmit: (e: React.FormEvent) => {
                  e.preventDefault();
                  next();
                },
              })}
        >
          <div className="steps" aria-label={`Step ${st + 1} of ${N}`}>
            {Array.from({ length: N }, (_, i) => (
              <i key={i} className={cn(i <= st && 'on', i === st && 'cur')} />
            ))}
          </div>
          <div className="faint" style={{ textAlign: 'center', fontSize: 12 }}>
            Step {st + 1} of {N}
          </div>
          {body}
        </AuthCard>
      </div>
    </AuthShell>
  );
}
