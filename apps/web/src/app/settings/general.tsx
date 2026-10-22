/* Настройки: General и Workspace — порт ветвей workspace, appearance, language, datetime, members, teams, projects, permissions из settingsBody (pages/settings.js) */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { Archive, Check, CircleCheck, Crown, Monitor, Moon, Sun, UserPlus } from 'lucide-react';
import { Badge, Button, Segmented, Select, Tooltip, toast, usePrefs, type Accent, type Density, type Motion, type ThemeMode } from '@/components/ui';
import { useWorkspace } from '../data/store';
import { resetSettings, useSettings } from '../data/settings';
import { apiFor, errorMessage, ok } from '../data/api';
import { useSession } from '../data/session';
import { dOff, fmtDate } from '../lib/dates';
import { WorkspaceLogo } from '../components/brand';
import { ProjectIcon } from '../components/project';
import { MemberAvatar } from '../components/workspace';
import { MemberMenu, RoleCell, useMemberActions } from '../components/member';
import { useInvite, useProjectForms } from '../overlays';
import { ConfirmModal } from '../overlays/project-dialogs';
import { SECTIONS } from '../routes';
import { PermsTable, TeamsGrid } from '../pages/MembersPage';
import { useBillingApi, useWorkspaceTimezone } from '../docs/billing-data';
import { useIsAdmin } from '../catalog/data';
import { PrefSelect, SRow, SettingsHead, Toggle } from './parts';

const WS_COLORS = ['#2F2E2A', '#5A67D8', '#3B82C4', '#23918A', '#C54B78', '#C48A1E'];

/** Круглые образцы цвета; size — диаметр (в разделах workspace и profile — 22) */
export function Swatches({ colors, value, onPick, size, label }: { colors: string[]; value: string; onPick: (c: string) => void; size?: number; label: string }) {
  return (
    <div className="swatches">
      {colors.map(c => (
        <button key={c} type="button" className={`sw ${value === c ? 'on' : ''}`} style={{ '--c': c, ...(size ? { width: size, height: size } : {}) } as React.CSSProperties} onClick={() => onPick(c)} aria-label={`${label} ${c}`} />
      ))}
    </div>
  );
}

/** Часовой пояс арендатора (IANA): в нём считаются период биллинга и расписания автоматизаций. Меняет admin и выше */
function WorkspaceTimeZone() {
  const zone = useWorkspaceTimezone();
  const api = useBillingApi();
  const isAdmin = useIsAdmin();
  const [value, setValue] = React.useState('');
  React.useEffect(() => {
    if (zone.data) setValue(zone.data.timezone);
  }, [zone.data?.timezone]);
  return (
    <SRow t="Workspace time zone" d="Billing periods and automation schedules are counted in this time zone.">
      <Select
        value={value}
        disabled={!isAdmin}
        onValueChange={async v => {
          setValue(v);
          const r = await api('PATCH', '/billing/timezone', { timezone: v });
          if (r) toast('Time zone saved');
        }}
        options={(zone.data?.options ?? ['UTC', 'Europe/Moscow']).map(tz => ({ value: tz, label: tz }))}
        aria-label="Workspace time zone"
      />
    </SRow>
  );
}

export function WorkspaceSection({ title }: { title: string }) {
  const { data, dispatch } = useWorkspace();
  const session = useSession();
  const navigate = useNavigate();
  const ws = data.ws;
  const [name, setName] = React.useState(ws.name);
  const [url, setUrl] = React.useState(ws.url);
  const [saving, setSaving] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  React.useEffect(() => {
    if (!saving) return;
    const n = name.trim();
    const u = url.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    const t = setTimeout(() => {
      dispatch({ type: 'ws/update', patch: { name: n, url: u || ws.url } });
      setUrl(u || ws.url);
      setSaving(false);
      toast('Workspace settings saved');
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving]);
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error("Workspace name can't be empty");
    setSaving(true);
  };
  return (
    <>
      <SettingsHead title={title} lead="Your workspace name, address, and identity." />
      <form onSubmit={save}>
        <div className="sblock" style={{ marginTop: 0 }}>
          <div className="row" style={{ gap: 14, marginBottom: 18 }}>
            <WorkspaceLogo ws={ws} size={52} />
            <div>
              <div className="label" style={{ marginBottom: 6 }}>
                Workspace icon
              </div>
              <Swatches colors={WS_COLORS} value={ws.c} size={22} label="Color" onPick={c => dispatch({ type: 'ws/update', patch: { c } })} />
            </div>
          </div>
          <div className="col" style={{ gap: 14, maxWidth: 440 }}>
            <div className="field">
              <label className="label" htmlFor="ws-name">
                Workspace name
              </label>
              <input className="input" id="ws-name" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="field">
              <label className="label" htmlFor="ws-url">
                Workspace URL
              </label>
              <div className="row" style={{ gap: 0 }}>
                <span className="input" style={{ width: 'auto', background: 'var(--surface-2)', borderRight: 0, borderRadius: '6px 0 0 6px', display: 'flex', alignItems: 'center', color: 'var(--text-2)' }}>
                  gr8rstudio.com/
                </span>
                <input className="input" id="ws-url" value={url} onChange={e => setUrl(e.target.value)} style={{ borderRadius: '0 6px 6px 0' }} />
              </div>
              <span className="hint">Changing the URL will break existing links.</span>
            </div>
            <div>
              <Button variant="primary" type="submit" loading={saving}>
                Save changes
              </Button>
            </div>
          </div>
        </div>
      </form>
      <div className="sblock">
        <h2 style={{ color: 'var(--red)' }}>Danger zone</h2>
        <SRow t="Delete workspace" d="Permanently delete this workspace, its projects, tasks, and files. This cannot be undone.">
          <Button variant="danger-ghost" style={{ border: '1px solid color-mix(in srgb,var(--red) 35%,transparent)' }} onClick={() => setConfirm(true)}>
            Delete workspace
          </Button>
        </SRow>
      </div>
      {confirm && (
        <ConfirmModal
          onClose={() => setConfirm(false)}
          spec={{
            title: `Delete ${ws.name}?`,
            body: 'Every project, task, file, and comment in this workspace will be permanently deleted for all members.',
            ok: 'Delete workspace',
            danger: true,
            typeName: ws.name,
            run: () => {
              // DELETE /workspaces/:id (только owner): данные арендатора уходят каскадом; дальше — другой мой воркспейс или онбординг
              const id = session.active!.id;
              apiFor()
                .workspaces[':id'].$delete({ param: { id } })
                .then(r => ok(r))
                .then(async () => {
                  const rest = (await session.refreshWorkspaces()).filter(w => w.id !== id);
                  resetSettings();
                  if (rest[0]) session.switchWorkspace(rest[0].id);
                  navigate('/');
                  toast.info(`Workspace “${ws.name}” was deleted`);
                })
                .catch(e => toast.error(errorMessage(e)));
            },
          }}
        />
      )}
    </>
  );
}

/* ---------- Appearance ---------- */

const LIGHT = { bg: '#FBFAF8', s: '#F2F1EE', t: '#1D1C1A', b: '#E3E1DC', a: '#4B5BD6' };
const DARK = { bg: '#1D1D1C', s: '#151514', t: '#ECEAE5', b: '#333230', a: '#8E9AF3' };

function ThemePreview({ c }: { c: typeof LIGHT }) {
  const bar = (bg: string, width?: string, extra?: React.CSSProperties) => <i style={{ background: bg, width, ...extra }} />;
  return (
    <>
      <div className="s" style={{ background: c.s }}>
        {bar(c.b, '70%')}
        {bar(c.a, '55%')}
        {bar(c.b, '80%')}
        {bar(c.b, '60%')}
      </div>
      <div className="m" style={{ background: c.bg }}>
        {bar(c.t, '45%', { height: 7 })}
        {bar(c.b)}
        {bar(c.b, '80%')}
        {bar(c.a, '30%', { height: 10, marginTop: 4 })}
      </div>
    </>
  );
}

const THEMES: [ThemeMode, string, React.ReactNode][] = [
  ['light', 'Light', <Sun key="l" size={14} />],
  ['dark', 'Dark', <Moon key="d" size={14} />],
  ['system', 'System', <Monitor key="s" size={14} />],
];
const ACCENTS: [Accent, string][] = [
  ['indigo', '#4B5BD6'],
  ['blue', '#2F6CD4'],
  ['violet', '#7348CC'],
  ['teal', '#1A7F7A'],
  ['rose', '#B93D68'],
  ['graphite', '#34332F'],
];
const DENSITY_ITEMS = ['comfortable', 'compact'].map(k => ({ value: k as Density, label: k[0].toUpperCase() + k.slice(1) }));

export function AppearanceSection({ title }: { title: string }) {
  const { prefs, setPrefs } = usePrefs();
  return (
    <>
      <SettingsHead title={title} lead="Customize how Gr8r looks on this device." />
      <div className="sblock" style={{ marginTop: 0 }}>
        <h2>Theme</h2>
        <div className="themecards" style={{ marginTop: 12 }} role="radiogroup" aria-label="Theme">
          {THEMES.map(([k, n, icon]) => (
            <button key={k} className={`tcard ${prefs.theme === k ? 'on' : ''}`} role="radio" aria-checked={prefs.theme === k} onClick={() => setPrefs({ theme: k })}>
              <div className="tprev" style={k === 'system' ? { gridTemplateColumns: '1fr 1fr', display: 'grid' } : undefined}>
                {k === 'system' ? (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '30% 1fr' }}>
                      <ThemePreview c={LIGHT} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '30% 1fr' }}>
                      <ThemePreview c={DARK} />
                    </div>
                  </>
                ) : (
                  <ThemePreview c={k === 'light' ? LIGHT : DARK} />
                )}
              </div>
              <span className="row" style={{ fontWeight: 500, fontSize: 13, gap: 6 }}>
                {icon}
                {n}
                {prefs.theme === k && (
                  <>
                    <span className="sp" />
                    <span style={{ color: 'var(--accent)', display: 'inline-flex' }}>
                      <CircleCheck size={15} />
                    </span>
                  </>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="sblock">
        <h2>Accent color</h2>
        <SRow t="Accent" d="Used for primary buttons, focus rings, and selection.">
          <div className="swatches" role="radiogroup" aria-label="Accent color">
            {ACCENTS.map(([k, c]) => (
              <Tooltip key={k} content={k[0].toUpperCase() + k.slice(1)}>
                <button className={`sw ${prefs.accent === k ? 'on' : ''}`} style={{ '--c': c } as React.CSSProperties} role="radio" aria-checked={prefs.accent === k} onClick={() => setPrefs({ accent: k })} aria-label={k}>
                  {prefs.accent === k && <Check size={13} />}
                </button>
              </Tooltip>
            ))}
          </div>
        </SRow>
      </div>
      <div className="sblock">
        <h2>Density</h2>
        <SRow t="Sidebar density" d="Compact fits more projects on screen.">
          <Segmented value={prefs.side} onValueChange={v => setPrefs({ side: v })} items={DENSITY_ITEMS} aria-label="Sidebar density" />
        </SRow>
        <SRow t="Task display" d="Row height in lists and card padding on boards.">
          <Segmented value={prefs.density} onValueChange={v => setPrefs({ density: v })} items={DENSITY_ITEMS} aria-label="Task display" />
        </SRow>
        <SRow t="Motion" d="Reduce animations for drawers, modals, and transitions.">
          <PrefSelect
            label="motion"
            value={prefs.motion}
            options={[
              ['system', 'Follow system'],
              ['reduce', 'Reduce motion'],
            ]}
            onChange={v => setPrefs({ motion: v as Motion })}
          />
        </SRow>
      </div>
    </>
  );
}

/* ---------- Language / Date & time ---------- */

export function LanguageSection({ title }: { title: string }) {
  const [s, set] = useSettings();
  return (
    <>
      <SettingsHead title={title} lead="Language and regional formats." />
      <SRow t="Language" d="The language used throughout the interface.">
        <PrefSelect label="lang" value={s.lang} options={['English (US)', 'English (UK)', 'Deutsch', 'Español', 'Français', '日本語']} onChange={lang => set({ lang })} />
      </SRow>
      <SRow t="Spellcheck" d="Check spelling in descriptions and comments.">
        <Toggle label="spell" checked={s.spell} onChange={spell => set({ spell })} />
      </SRow>
    </>
  );
}

export function DateTimeSection({ title }: { title: string }) {
  const [s, set] = useSettings();
  return (
    <>
      <SettingsHead title={title} lead="How dates and times appear across the workspace." />
      <WorkspaceTimeZone />
      <SRow t="Time zone" d="Used for due dates and reminders.">
        <PrefSelect label="tz" value={s.tz} options={['(GMT-08:00) Pacific Time', '(GMT-05:00) Eastern Time', '(GMT+00:00) London', '(GMT+01:00) Berlin', '(GMT+08:00) Singapore']} onChange={tz => set({ tz })} />
      </SRow>
      <SRow
        t="Date format"
        d={
          <>
            Preview: <b>{fmtDate(dOff(8))}</b>
          </>
        }
      >
        <PrefSelect
          label="dateFmt"
          value={s.dateFmt}
          options={[
            ['MMM d', 'Oct 1'],
            ['d/M', '1/10'],
            ['M/d', '10/1'],
            ['yyyy-MM-dd', '2026-10-01'],
          ]}
          onChange={dateFmt => set({ dateFmt })}
        />
      </SRow>
      <SRow t="Start week on" d="Affects calendars and the timeline.">
        <PrefSelect
          label="weekStart"
          value={s.weekStart}
          options={[
            ['1', 'Monday'],
            ['0', 'Sunday'],
            ['6', 'Saturday'],
          ]}
          onChange={weekStart => set({ weekStart })}
        />
      </SRow>
      <SRow t="Time format">
        <PrefSelect
          label="timeFmt"
          value={s.timeFmt}
          options={[
            ['12', '12-hour (2:30 PM)'],
            ['24', '24-hour (14:30)'],
          ]}
          onChange={timeFmt => set({ timeFmt })}
        />
      </SRow>
    </>
  );
}

/* ---------- Workspace group ---------- */

export function MembersSection({ title }: { title: string }) {
  const { data } = useWorkspace();
  const navigate = useNavigate();
  const invite = useInvite();
  const actions = useMemberActions();
  return (
    <>
      <SettingsHead title={title} lead={`${data.members.length} people have access to ${data.ws.name}.`} />
      <div className="row" style={{ marginBottom: 12 }}>
        <Button variant="primary" onClick={() => invite.open()}>
          <UserPlus size={14} />
          Invite member
        </Button>
        <Button variant="secondary" onClick={() => navigate(SECTIONS.members.path)}>
          Open member directory
        </Button>
      </div>
      <div className="panel" style={{ overflow: 'hidden' }}>
        {data.members.map(m => (
          <div key={m.id} className="mini" style={{ minHeight: 52, cursor: 'default' }}>
            <MemberAvatar id={m.id} size="md" tooltip={false} />
            <div className="grow">
              <div style={{ fontWeight: 500 }}>{m.name}</div>
              <div className="faint" style={{ fontSize: 12 }}>
                {m.email}
              </div>
            </div>
            {m.status === 'invited' && <Badge tone="amber">Invited</Badge>}
            {m.role === 'Owner' ? (
              <span className="pillbtn">
                <Crown size={13} />
                Owner
              </span>
            ) : (
              <RoleCell m={m} actions={actions} />
            )}
            <MemberMenu m={m} actions={actions} />
          </div>
        ))}
      </div>
      {actions.confirm}
    </>
  );
}

export function TeamsSection({ title }: { title: string }) {
  return (
    <>
      <SettingsHead title={title} lead="Teams group people and projects." />
      <TeamsGrid />
    </>
  );
}

export function ProjectsSection({ title }: { title: string }) {
  const { data, dispatch } = useWorkspace();
  const [s, set] = useSettings();
  const navigate = useNavigate();
  const forms = useProjectForms();
  const arch = data.projects.filter(p => p.archived);
  return (
    <>
      <SettingsHead title={title} lead="Defaults for new projects and archived work." />
      <SRow t="Default project view" d="The tab that opens when you open a project.">
        <PrefSelect
          label="defaultTab"
          value={s.defaultTab}
          options={[
            ['board', 'Board'],
            ['list', 'List'],
            ['table', 'Table'],
            ['overview', 'Overview'],
            ['timeline', 'Timeline'],
          ]}
          onChange={defaultTab => set({ defaultTab })}
        />
      </SRow>
      <SRow t="Show completed tasks on boards">
        <Toggle label="showDoneBoard" checked={s.showDoneBoard} onChange={showDoneBoard => set({ showDoneBoard })} />
      </SRow>
      <div className="sblock">
        <h2>Archived projects</h2>
        {arch.length ? (
          arch.map(p => (
            <div key={p.id} className="srow">
              <div className="row">
                <ProjectIcon project={p} size={14} />
                <b style={{ fontWeight: 500 }}>{p.name}</b>
              </div>
              <div className="row">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    dispatch({ type: 'project/update', id: p.id, patch: { archived: false, archivedAt: null } });
                    toast(`Restored ${p.name}`);
                  }}
                >
                  Restore
                </Button>
                <Button variant="danger-ghost" size="sm" onClick={() => forms.remove(p.id)}>
                  Delete
                </Button>
              </div>
            </div>
          ))
        ) : (
          <p className="faint" style={{ padding: '12px 0', margin: '1em 0' }}>
            No archived projects. Archived projects are hidden from the sidebar but keep all their tasks.
          </p>
        )}
        <div style={{ marginTop: 12 }}>
          <Button variant="secondary" size="sm" onClick={() => navigate(SECTIONS.archive.path)}>
            <Archive size={13} />
            Open archive
          </Button>
        </div>
      </div>
    </>
  );
}

export function PermissionsSection({ title }: { title: string }) {
  const [s, set] = useSettings();
  return (
    <>
      <SettingsHead title={title} lead="Control what each role can do." />
      <SRow t="Members can create projects">
        <Toggle label="permCreate" checked={s.permCreate} onChange={permCreate => set({ permCreate })} />
      </SRow>
      <SRow t="Members can invite guests" d="Guests only see projects they are added to.">
        <Toggle label="permGuests" checked={s.permGuests} onChange={permGuests => set({ permGuests })} />
      </SRow>
      <SRow t="Allow public share links" d="Anyone with the link can view a project.">
        <Toggle label="permPublic" checked={s.permPublic} onChange={permPublic => set({ permPublic })} />
      </SRow>
      <div className="sblock">
        <h2>Role permissions</h2>
        <div style={{ marginTop: 12 }}>
          <PermsTable />
        </div>
      </div>
    </>
  );
}
