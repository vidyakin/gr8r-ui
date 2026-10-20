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

/* ---------- Notifications ---------- */

/** Строка уведомления: заголовок, пояснение, ключ в settings.np */
type NotifRow = [t: string, d: string, key: string];

const NOTIF: Record<string, { lead: string; rows: NotifRow[] }> = {
  'notif-email': {
    lead: 'Choose which emails you receive.',
    rows: [
      ['Mentions', 'When someone @mentions you.', 'email_mention'],
      ['Assignments', 'When a task is assigned to you.', 'email_assign'],
      ['Comments', 'On tasks you created or are assigned.', 'email_comment'],
      ['Daily digest', 'A summary of what changed, every weekday at 8:00.', 'email_digest'],
    ],
  },
  'notif-push': {
    lead: 'Notifications on desktop and mobile.',
    rows: [
      ['Mentions', '', 'push_mention'],
      ['Assignments', '', 'push_assign'],
      ['Comments', '', 'push_comment'],
      ['Due date reminders', 'One day before a task is due.', 'push_due'],
    ],
  },
  'notif-mentions': {
    lead: 'Decide which mentions reach you.',
    rows: [
      ['@mentions in comments and descriptions', '', 'mention_all'],
      ['@team mentions', 'When your team is mentioned, e.g. @Product.', 'mention_team'],
      ['@workspace mentions', 'Announcements to everyone.', 'mention_ws'],
    ],
  },
  'notif-assign': {
    lead: 'Updates about tasks assigned to you.',
    rows: [
      ["When I'm assigned a task", '', 'assign_self'],
      ['When my task changes status', '', 'assign_status'],
      ['When my task is overdue', '', 'assign_over'],
    ],
  },
};

export function NotificationsSection({ id, title }: { id: string; title: string }) {
  const [s, set] = useSettings();
  const { lead, rows } = NOTIF[id];
  return (
    <>
      <SettingsHead title={title} lead={lead} />
      {rows.map(([t, d, k]) => (
        <SRow key={k} t={t} d={d}>
          <Toggle label={k} checked={!!s.np[k]} notify="Notification preferences saved" onChange={v => set({ np: { ...s.np, [k]: v } })} />
        </SRow>
      ))}
    </>
  );
}

/* ---------- Profile ---------- */

const AV_COLORS = ['#5A67D8', '#C54B78', '#3B82C4', '#23918A', '#C48A1E', '#8662C9'];

export function ProfileSection({ title }: { title: string }) {
  const { data, dispatch } = useWorkspace();
  const me = data.members.find(m => m.id === data.me)!;
  const [name, setName] = React.useState(me.name);
  const [job, setJob] = React.useState(me.title);
  const [err, setErr] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    if (!saving) return;
    const t = setTimeout(() => {
      dispatch({ type: 'member/update', id: me.id, patch: { name: name.trim(), title: job.trim() } });
      setSaving(false);
      toast('Profile updated');
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving]);
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErr('Enter your name');
    setErr('');
    setSaving(true);
  };
  return (
    <>
      <SettingsHead title={title} lead="How you appear to others in the workspace." />
      <form onSubmit={save} className="col" style={{ gap: 16, maxWidth: 440 }}>
        <div className="row" style={{ gap: 14 }}>
          <MemberAvatar id={me.id} size="xl" tooltip={false} />
          <div>
            <div className="label" style={{ marginBottom: 6 }}>
              Avatar color
            </div>
            <Swatches colors={AV_COLORS} value={me.c} size={22} label="Color" onPick={c => dispatch({ type: 'member/update', id: me.id, patch: { c } })} />
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="pf-name">
            Full name
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
            Title
          </label>
          <input className="input" id="pf-title" value={job} onChange={e => setJob(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="pf-email">
            Email
          </label>
          <input className="input" id="pf-email" value={me.email} disabled readOnly />
          <span className="hint">Contact a workspace owner to change your sign-in email.</span>
        </div>
        <div>
          <Button variant="primary" type="submit" loading={saving}>
            Save profile
          </Button>
        </div>
      </form>
    </>
  );
}

/* ---------- Preferences / Shortcuts ---------- */

export function PreferencesSection({ title }: { title: string }) {
  const [s, set] = useSettings();
  return (
    <>
      <SettingsHead title={title} lead="Personal defaults for how you work." />
      <SRow t="Open on launch" d="The page you see when Gr8r opens.">
        <PrefSelect
          label="home"
          value={s.home}
          options={[
            ['home', 'Home'],
            ['mytasks', 'My Tasks'],
            ['inbox', 'Inbox'],
          ]}
          onChange={home => set({ home })}
        />
      </SRow>
      <SRow t="Open tasks in" d="Side panel keeps your place in the list.">
        <PrefSelect
          label="openTasks"
          value={s.openTasks}
          options={[
            ['drawer', 'Side panel'],
            ['full', 'Full page'],
          ]}
          onChange={openTasks => set({ openTasks })}
        />
      </SRow>
      <SRow t="Confirm before deleting tasks">
        <Toggle label="confirmDel" checked={s.confirmDel} onChange={confirmDel => set({ confirmDel })} />
      </SRow>
    </>
  );
}

export function ShortcutsSection({ title }: { title: string }) {
  return (
    <>
      <SettingsHead title={title} lead="Move faster with the keyboard." />
      {SHORTCUTS.map(([g, list]) => (
        <div key={g} className="sblock" style={{ marginTop: 18 }}>
          <h2>{g}</h2>
          {list.map(([n, k], i) => (
            <div key={n + i} className="srow" style={{ padding: '9px 0' }}>
              <span>{n}</span>
              <span className="row" style={{ gap: 4 }}>
                {k.map((x, j) => (
                  <React.Fragment key={j}>
                    {j > 0 && k[0] === 'G' && (
                      <span className="faint" style={{ fontSize: 11 }}>
                        then
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
