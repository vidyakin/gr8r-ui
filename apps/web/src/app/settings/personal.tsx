/* Настройки: Notifications и Personal — порт ветвей notif-*, profile, preferences, shortcuts из settingsBody (pages/settings.js) */
import * as React from 'react';
import { CircleAlert } from 'lucide-react';
import { Button, Kbd, toast } from '@/components/ui';
import { useWorkspace } from '../data/store';
import { useSettings } from '../data/settings';
import { MemberAvatar } from '../components/workspace';
import { PrefSelect, SRow, SettingsHead, Toggle } from './parts';
import { Swatches } from './general';
import { SHORTCUTS } from './nav';
import { useT, type TKey } from '@/i18n';

/* ---------- Notifications ---------- */

/** Строка уведомления: ключ заголовка в settings.notifications.<id>, ключ настройки в settings.np */
type NotifRow = [labelKey: string, key: string];

const NOTIF: Record<string, { leadKey: string; rows: NotifRow[] }> = {
  'notif-email': {
    leadKey: 'settings.notifications.email.lead',
    rows: [
      ['settings.notifications.email.mentions', 'email_mention'],
      ['settings.notifications.email.assignments', 'email_assign'],
      ['settings.notifications.email.comments', 'email_comment'],
      ['settings.notifications.email.digest', 'email_digest'],
    ],
  },
  'notif-push': {
    leadKey: 'settings.notifications.push.lead',
    rows: [
      ['settings.notifications.push.mentions', 'push_mention'],
      ['settings.notifications.push.assignments', 'push_assign'],
      ['settings.notifications.push.comments', 'push_comment'],
      ['settings.notifications.push.due', 'push_due'],
    ],
  },
  'notif-mentions': {
    leadKey: 'settings.notifications.mentions.lead',
    rows: [
      ['settings.notifications.mentions.all', 'mention_all'],
      ['settings.notifications.mentions.team', 'mention_team'],
      ['settings.notifications.mentions.workspace', 'mention_ws'],
    ],
  },
  'notif-assign': {
    leadKey: 'settings.notifications.assign.lead',
    rows: [
      ['settings.notifications.assign.self', 'assign_self'],
      ['settings.notifications.assign.status', 'assign_status'],
      ['settings.notifications.assign.overdue', 'assign_over'],
    ],
  },
};

export function NotificationsSection({ id, title }: { id: string; title: string }) {
  const t = useT();
  const [s, set] = useSettings();
  const { leadKey, rows } = NOTIF[id];
  return (
    <>
      <SettingsHead title={title} lead={t(leadKey as TKey)} />
      {rows.map(([labelKey, k]) => (
        <SRow key={k} t={t(`${labelKey}.t` as TKey)} d={t(`${labelKey}.d` as TKey)}>
          <Toggle label={k} checked={!!s.np[k]} notify={t('settings.notifications.saved')} onChange={v => set({ np: { ...s.np, [k]: v } })} />
        </SRow>
      ))}
    </>
  );
}

/* ---------- Profile ---------- */

const AV_COLORS = ['#5A67D8', '#C54B78', '#3B82C4', '#23918A', '#C48A1E', '#8662C9'];

export function ProfileSection({ title }: { title: string }) {
  const t = useT();
  const { data, dispatch } = useWorkspace();
  const me = data.members.find(m => m.id === data.me)!;
  const [name, setName] = React.useState(me.name);
  const [job, setJob] = React.useState(me.title);
  const [err, setErr] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    if (!saving) return;
    const timeoutId = setTimeout(() => {
      dispatch({ type: 'member/update', id: me.id, patch: { name: name.trim(), title: job.trim() } });
      setSaving(false);
      toast(t('settings.profile.updated'));
    }, 600);
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving]);
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErr(t('settings.profile.nameRequired'));
    setErr('');
    setSaving(true);
  };
  return (
    <>
      <SettingsHead title={title} lead={t('settings.profile.lead')} />
      <form onSubmit={save} className="col" style={{ gap: 16, maxWidth: 440 }}>
        <div className="row" style={{ gap: 14 }}>
          <MemberAvatar id={me.id} size="xl" tooltip={false} />
          <div>
            <div className="label" style={{ marginBottom: 6 }}>
              {t('settings.profile.avatar')}
            </div>
            <Swatches colors={AV_COLORS} value={me.c} size={22} label={t('settings.workspace.color')} onPick={c => dispatch({ type: 'member/update', id: me.id, patch: { c } })} />
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="pf-name">
            {t('settings.profile.fullName')}
          </label>
          <input className={`input ${err ? 'is-error' : ''}`} id="pf-name" value={name} onChange={e => setName(e.target.value)} />
          {err && (
            <span className="err">
              <CircleAlert size={12} />
              {err}
            </span>
          )}
        </div>
        <div className="field">
          <label className="label" htmlFor="pf-title">
            {t('settings.profile.title')}
          </label>
          <input className="input" id="pf-title" value={job} onChange={e => setJob(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="pf-email">
            {t('settings.profile.email')}
          </label>
          <input className="input" id="pf-email" value={me.email} disabled readOnly />
          <span className="hint">{t('settings.profile.emailHint')}</span>
        </div>
        <div>
          <Button variant="primary" type="submit" loading={saving}>
            {t('settings.profile.save')}
          </Button>
        </div>
      </form>
    </>
  );
}

/* ---------- Preferences / Shortcuts ---------- */

export function PreferencesSection({ title }: { title: string }) {
  const t = useT();
  const [s, set] = useSettings();
  return (
    <>
      <SettingsHead title={title} lead={t('settings.preferences.lead')} />
      <SRow t={t('settings.preferences.home.t')} d={t('settings.preferences.home.d')}>
        <PrefSelect
          label="home"
          value={s.home}
          options={[
            ['home', t('settings.preferences.homeHome')],
            ['mytasks', t('settings.preferences.homeTasks')],
            ['inbox', t('settings.preferences.homeInbox')],
          ]}
          onChange={home => set({ home })}
        />
      </SRow>
      <SRow t={t('settings.preferences.openTasks.t')} d={t('settings.preferences.openTasks.d')}>
        <PrefSelect
          label="openTasks"
          value={s.openTasks}
          options={[
            ['drawer', t('settings.preferences.openDrawer')],
            ['full', t('settings.preferences.openFull')],
          ]}
          onChange={openTasks => set({ openTasks })}
        />
      </SRow>
      <SRow t={t('settings.preferences.confirmDelete')}>
        <Toggle label="confirmDel" checked={s.confirmDel} onChange={confirmDel => set({ confirmDel })} />
      </SRow>
    </>
  );
}

export function ShortcutsSection({ title }: { title: string }) {
  const t = useT();
  return (
    <>
      <SettingsHead title={title} lead={t('settings.shortcuts.lead')} />
      {SHORTCUTS.map(([g, list]) => (
        <div key={g} className="sblock" style={{ marginTop: 18 }}>
          <h2>{t(`settings.shortcuts.groups.${g}` as TKey)}</h2>
          {list.map(([n, k], i) => (
            <div key={n + i} className="srow" style={{ padding: '9px 0' }}>
              <span>{t(`settings.shortcuts.items.${n}` as TKey)}</span>
              <span className="row" style={{ gap: 4 }}>
                {k.map((x, j) => (
                  <React.Fragment key={j}>
                    {j > 0 && k[0] === 'G' && (
                      <span className="faint" style={{ fontSize: 11 }}>
                        {t('settings.shortcuts.items.then')}
                      </span>
                    )}
                    <Kbd>{x}</Kbd>
                  </React.Fragment>
                ))}
              </span>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}