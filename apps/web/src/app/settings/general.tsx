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
import { LOCALES, getLocale, isLocale, setLocale, useT, type Locale } from '@/i18n';
import { MemberPositions } from '../positions/MemberPositions';

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
  const t = useT();
  const zone = useWorkspaceTimezone();
  const api = useBillingApi();
  const isAdmin = useIsAdmin();
  const [value, setValue] = React.useState('');
  React.useEffect(() => {
    if (zone.data) setValue(zone.data.timezone);
  }, [zone.data?.timezone]);
  return (
    <SRow t={t('settings.workspace.timezone')} d={t('settings.workspace.timezoneHint')}>
      <Select
        value={value}
        disabled={!isAdmin}
        onValueChange={async v => {
          setValue(v);
          const r = await api('PATCH', '/billing/timezone', { timezone: v });
          if (r) toast(t('settings.workspace.timezoneSaved'));
        }}
        options={(zone.data?.options ?? ['UTC', 'Europe/Moscow']).map(tz => ({ value: tz, label: tz }))}
        aria-label={t('settings.workspace.timezone')}
      />
    </SRow>
  );
}

export function WorkspaceSection({ title }: { title: string }) {
  const t = useT();
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
    const timeoutId = setTimeout(() => {
      dispatch({ type: 'ws/update', patch: { name: n, url: u || ws.url } });
      setUrl(u || ws.url);
      setSaving(false);
      toast(t('settings.workspace.saved'));
    }, 600);
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving]);
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error(t('settings.workspace.nameEmpty'));
    setSaving(true);
  };
  return (
    <>
      <SettingsHead title={title} lead={t('settings.workspace.lead')} />
      <form onSubmit={save}>
        <div className="sblock" style={{ marginTop: 0 }}>
          <div className="row" style={{ gap: 14, marginBottom: 18 }}>
            <WorkspaceLogo ws={ws} size={52} />
            <div>
              <div className="label" style={{ marginBottom: 6 }}>
                {t('settings.workspace.icon')}
              </div>
              <Swatches colors={WS_COLORS} value={ws.c} size={22} label={t('settings.workspace.color')} onPick={c => dispatch({ type: 'ws/update', patch: { c } })} />
            </div>
          </div>
          <div className="col" style={{ gap: 14, maxWidth: 440 }}>
            <div className="field">
              <label className="label" htmlFor="ws-name">
                {t('settings.workspace.name')}
              </label>
              <input className="input" id="ws-name" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="field">
              <label className="label" htmlFor="ws-url">
                {t('settings.workspace.url')}
              </label>
              <div className="row" style={{ gap: 0 }}>
                <span className="input" style={{ width: 'auto', background: 'var(--surface-2)', borderRight: 0, borderRadius: '6px 0 0 6px', display: 'flex', alignItems: 'center', color: 'var(--text-2)' }}>
                  gr8rstudio.com/
                </span>
                <input className="input" id="ws-url" value={url} onChange={e => setUrl(e.target.value)} style={{ borderRadius: '0 6px 6px 0' }} />
              </div>
              <span className="hint">{t('settings.workspace.urlHint')}</span>
            </div>
            <div>
              <Button variant="primary" type="submit" loading={saving}>
                {t('settings.workspace.save')}
              </Button>
            </div>
          </div>
        </div>
      </form>
      {session.active?.role === 'owner' && (
        <div className="sblock">
        <h2 style={{ color: 'var(--red)' }}>{t('settings.workspace.dangerZone')}</h2>
        <SRow t={t('settings.workspace.deleteTitle', { name: ws.name })} d={t('settings.workspace.deleteBody')}>
          <Button variant="danger-ghost" style={{ border: '1px solid color-mix(in srgb,var(--red) 35%,transparent)' }} onClick={() => setConfirm(true)}>
            {t('settings.workspace.deleteOk')}
          </Button>
        </SRow>
        </div>
      )}
      {confirm && (
        <ConfirmModal
          onClose={() => setConfirm(false)}
          spec={{
            title: t('settings.workspace.deleteTitle', { name: ws.name }),
            body: t('settings.workspace.deleteBody'),
            ok: t('settings.workspace.deleteOk'),
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
                  toast.info(t('settings.workspace.deleted', { name: ws.name }));
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

function ThemeItem({ mode, icon }: { mode: ThemeMode; icon: React.ReactNode }) {
  const t = useT();
  return <>{icon} {t(`settings.appearance.themes.${mode}`)}</>;
}

const ACCENTS: [Accent, string][] = [
  ['indigo', '#4B5BD6'],
  ['blue', '#2F6CD4'],
  ['violet', '#7348CC'],
  ['teal', '#1A7F7A'],
  ['rose', '#B93D68'],
  ['graphite', '#34332F'],
];
const DENSITY_KEYS: Density[] = ['comfortable', 'compact'];

export function AppearanceSection({ title }: { title: string }) {
  const t = useT();
  const { prefs, setPrefs } = usePrefs();
  const themeIcons: Record<ThemeMode, React.ReactNode> = {
    light: <Sun key="l" size={14} />,
    dark: <Moon key="d" size={14} />,
    system: <Monitor key="s" size={14} />,
  };
  const densityItems = DENSITY_KEYS.map(k => {
    const label = k === 'comfortable' ? t('settings.appearance.densityComfortable') : t('settings.appearance.densityCompact');
    return { value: k, label };
  });
  return (
    <>
      <SettingsHead title={title} lead={t('settings.appearance.lead')} />
      <div className="sblock" style={{ marginTop: 0 }}>
        <h2>{t('settings.appearance.theme')}</h2>
        <div className="themecards" style={{ marginTop: 12 }} role="radiogroup" aria-label={t('settings.appearance.themeAria')}>
          {(['light', 'dark', 'system'] as ThemeMode[]).map(k => (
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
                <ThemeItem mode={k} icon={themeIcons[k]} />
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
        <h2>{t('settings.appearance.accent')}</h2>
        <SRow t={t('settings.appearance.accentRow.t')} d={t('settings.appearance.accentRow.d')}>
          <div className="swatches" role="radiogroup" aria-label={t('settings.appearance.accentAria')}>
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
        <h2>{t('settings.appearance.density')}</h2>
        <SRow t={t('settings.appearance.sidebarDensity.t')} d={t('settings.appearance.sidebarDensity.d')}>
          <Segmented value={prefs.side} onValueChange={v => setPrefs({ side: v })} items={densityItems} aria-label={t('settings.appearance.sideDensityAria')} />
        </SRow>
        <SRow t={t('settings.appearance.taskDisplay.t')} d={t('settings.appearance.taskDisplay.d')}>
          <Segmented value={prefs.density} onValueChange={v => setPrefs({ density: v })} items={densityItems} aria-label={t('settings.appearance.taskDisplayAria')} />
        </SRow>
        <SRow t={t('settings.appearance.motion.t')} d={t('settings.appearance.motion.d')}>
          <PrefSelect
            label="motion"
            value={prefs.motion}
            options={[
              ['system', t('settings.appearance.motionSystem')],
              ['reduce', t('settings.appearance.motionReduce')],
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
  const session = useSession();
  const isAdmin = useIsAdmin();
  const t = useT();
  const ws = session.active;
  const wsLocale = isLocale(ws?.locale) ? ws.locale : null;
  const langName = (l: Locale) => t(`languages.${l}`);
  // Личный выбор: язык или «как в воркспейсе» (null в users.locale)
  const mine = isLocale(session.user?.locale) ? session.user.locale : 'default';
  return (
    <>
      <SettingsHead title={title} lead={t('settings.language.lead')} />
      <SRow t={t('settings.language.title')} d={t('settings.language.hint')}>
        <Select
          value={mine}
          onValueChange={async v => {
            const next = isLocale(v) ? v : null;
            if (next) setLocale(next);
            try {
              await session.setMyLocale(next);
              toast(t('settings.language.saved'), { duration: 1500 });
            } catch (e) {
              toast.error(errorMessage(e));
            }
          }}
          options={[
            { value: 'default', label: t('settings.language.workspaceDefault', { lang: wsLocale ? langName(wsLocale) : langName(getLocale()) }) },
            ...LOCALES.map(l => ({ value: l, label: langName(l) })),
          ]}
          aria-label={t('settings.language.title')}
        />
      </SRow>
      <SRow t={t('settings.language.workspaceTitle')} d={t('settings.language.workspaceHint')}>
        <Select
          value={wsLocale ?? 'none'}
          disabled={!isAdmin || !ws}
          onValueChange={v => {
            // PATCH /workspaces/:id { locale } — язык воркспейса по умолчанию (settings.locale)
            apiFor()
              .workspaces[':id'].$patch({ param: { id: ws!.id }, json: { locale: isLocale(v) ? v : null } })
              .then(r => ok(r))
              .then(() => session.refreshWorkspaces())
              .then(() => toast(t('settings.language.saved'), { duration: 1500 }))
              .catch(e => toast.error(errorMessage(e)));
          }}
          options={[{ value: 'none', label: t('settings.language.notSet') }, ...LOCALES.map(l => ({ value: l, label: langName(l) }))]}
          aria-label={t('settings.language.workspaceTitle')}
        />
      </SRow>
      <SRow t={t('settings.language.spellcheck')} d={t('settings.language.spellcheckHint')}>
        <Toggle label="spell" checked={s.spell} onChange={spell => set({ spell })} />
      </SRow>
    </>
  );
}

export function DateTimeSection({ title }: { title: string }) {
  const t = useT();
  const [s, set] = useSettings();
  return (
    <>
      <SettingsHead title={title} lead={t('settings.dateTime.lead')} />
      <WorkspaceTimeZone />
      <SRow t={t('settings.dateTime.timezone')} d={t('settings.dateTime.timezoneHint')}>
        <PrefSelect label="tz" value={s.tz} options={['(GMT-08:00) Pacific Time', '(GMT-05:00) Eastern Time', '(GMT+00:00) London', '(GMT+01:00) Berlin', '(GMT+08:00) Singapore']} onChange={tz => set({ tz })} />
      </SRow>
      <SRow
        t={t('settings.dateTime.dateFormat')}
        d={
          <>
            {t('settings.common.preview')}: <b>{fmtDate(dOff(8))}</b>
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
      <SRow t={t('settings.dateTime.weekStart')}>
        <PrefSelect
          label="weekStart"
          value={s.weekStart}
          options={[
            ['1', t('settings.dateTime.weekStartMonday')],
            ['0', t('settings.dateTime.weekStartSunday')],
            ['6', t('settings.dateTime.weekStartSaturday')],
          ]}
          onChange={weekStart => set({ weekStart })}
        />
      </SRow>
      <SRow t={t('settings.dateTime.timeFormat')}>
        <PrefSelect
          label="timeFmt"
          value={s.timeFmt}
          options={[
            ['12', t('settings.dateTime.format12')],
            ['24', t('settings.dateTime.format24')],
          ]}
          onChange={timeFmt => set({ timeFmt })}
        />
      </SRow>
    </>
  );
}

/* ---------- Workspace group ---------- */

export function MembersSection({ title }: { title: string }) {
  const t = useT();
  const { data } = useWorkspace();
  const navigate = useNavigate();
  const invite = useInvite();
  const actions = useMemberActions();
  const count = data.members.length;
  const lead = t('settings.members.leadCount', { count, name: data.ws.name });
  return (
    <>
      <SettingsHead title={title} lead={lead} />
      <div className="row" style={{ marginBottom: 12 }}>
        <Button variant="primary" onClick={() => invite.open()}>
          <UserPlus size={14} />
          {t('settings.members.invite')}
        </Button>
        <Button variant="secondary" onClick={() => navigate(SECTIONS.members.path)}>
          {t('settings.members.openDirectory')}
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
            {m.status === 'invited' && <Badge tone="amber">{t('settings.members.invited')}</Badge>}
            <MemberPositions memberId={m.id} compact />
            {m.role === 'Owner' ? (
              <span className="pillbtn">
                <Crown size={13} />
                {t('settings.members.owner')}
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
  const t = useT();
  return (
    <>
      <SettingsHead title={title} lead={t('settings.teams.lead')} />
      <TeamsGrid />
    </>
  );
}

export function ProjectsSection({ title }: { title: string }) {
  const t = useT();
  const { data, dispatch } = useWorkspace();
  const [s, set] = useSettings();
  const navigate = useNavigate();
  const forms = useProjectForms();
  const arch = data.projects.filter(p => p.archived);
  return (
    <>
      <SettingsHead title={title} lead={t('settings.projects.lead')} />
      <SRow t={t('settings.projects.defaultView')}>
        <PrefSelect
          label="defaultTab"
          value={s.defaultTab}
          options={[
            ['board', t('projectTabs.board')],
            ['list', t('projectTabs.list')],
            ['table', t('projectTabs.table')],
            ['overview', t('projectTabs.overview')],
            ['timeline', t('projectTabs.timeline')],
          ]}
          onChange={defaultTab => set({ defaultTab })}
        />
      </SRow>
      <SRow t={t('settings.projects.showDone')}>
        <Toggle label="showDoneBoard" checked={s.showDoneBoard} onChange={showDoneBoard => set({ showDoneBoard })} />
      </SRow>
      <div className="sblock">
        <h2>{t('settings.projects.archived')}</h2>
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
                    toast(t('settings.projects.restored', { name: p.name }));
                  }}
                >
                  {t('settings.common.restore')}
                </Button>
                <Button variant="danger-ghost" size="sm" onClick={() => forms.remove(p.id)}>
                  {t('settings.common.remove')}
                </Button>
              </div>
            </div>
          ))
        ) : (
          <p className="faint" style={{ padding: '12px 0', margin: '1em 0' }}>
            {t('settings.projects.archivedEmpty')}
          </p>
        )}
        <div style={{ marginTop: 12 }}>
          <Button variant="secondary" size="sm" onClick={() => navigate(SECTIONS.archive.path)}>
            <Archive size={13} />
            {t('settings.projects.openArchive')}
          </Button>
        </div>
      </div>
    </>
  );
}

export function PermissionsSection({ title }: { title: string }) {
  const t = useT();
  const [s, set] = useSettings();
  return (
    <>
      <SettingsHead title={title} lead={t('settings.permissions.lead')} />
      <SRow t={t('settings.permissions.canCreate')}>
        <Toggle label="permCreate" checked={s.permCreate} onChange={permCreate => set({ permCreate })} />
      </SRow>
      <SRow t={t('settings.permissions.canInvite')} d={t('settings.permissions.canInviteHint')}>
        <Toggle label="permGuests" checked={s.permGuests} onChange={permGuests => set({ permGuests })} />
      </SRow>
      <SRow t={t('settings.permissions.publicShare')} d={t('settings.permissions.publicShareHint')}>
        <Toggle label="permPublic" checked={s.permPublic} onChange={permPublic => set({ permPublic })} />
      </SRow>
      <div className="sblock">
        <h2>{t('settings.permissions.roleTable')}</h2>
        <div style={{ marginTop: 12 }}>
          <PermsTable />
        </div>
      </div>
    </>
  );
}
