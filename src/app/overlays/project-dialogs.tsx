/* Окна форм проекта — порт projectModal, shareModal, saveView и confirmModal из overlays/modals.js */
import * as React from 'react';
import { Archive, Building2, Check, CircleAlert, Info, Link, Lock, Trash2 } from 'lucide-react';
import { Button, Input, Textarea, toast } from '@/components/ui';
import { useWorkspace, uid } from '../data/store';
import { PROJECT_COLORS, project as findProject } from '../data/selectors';
import type { Project, ProjectColor, SavedView } from '../data/types';
import { NamedIcon } from '../components/icons';
import { MemberAvatar } from '../components/workspace';
import { Modal, ModalTitle } from './modal-shell';

/* ---------- проект: создание и настройки ---------- */

const PICONS = ['globe', 'smartphone', 'megaphone', 'rocket', 'component', 'building-2', 'layout-grid', 'palette', 'code', 'briefcase', 'target', 'layers', 'zap', 'heart', 'folder', 'sparkles'];

export const TEMPLATES = [
  { id: 'blank', name: 'Blank project', icon: 'file', desc: 'Start from scratch', tasks: [] as string[] },
  { id: 'product', name: 'Product Development', icon: 'target', desc: 'Discovery to launch', tasks: ['Define problem statement', 'User research plan', 'Write PRD', 'Design exploration', 'Build MVP', 'Beta launch'] },
  { id: 'web', name: 'Website', icon: 'globe', desc: 'IA, design, build, launch', tasks: ['Sitemap & information architecture', 'Wireframes', 'Visual design', 'Build page templates', 'Content migration', 'QA & launch'] },
  { id: 'mkt', name: 'Marketing Campaign', icon: 'megaphone', desc: 'Brief, assets, channels', tasks: ['Campaign brief', 'Audience research', 'Creative assets', 'Channel plan', 'Launch campaign', 'Performance report'] },
  { id: 'design', name: 'Design Project', icon: 'palette', desc: 'Discovery to handoff', tasks: ['Discovery workshop', 'Moodboard', 'Concept directions', 'Refinement', 'Developer handoff'] },
  { id: 'software', name: 'Software Development', icon: 'code', desc: 'Spec, build, ship', tasks: ['Technical spec', 'Set up repo & CI', 'Implement core API', 'Write tests', 'Code review', 'Deploy to staging'] },
  { id: 'personal', name: 'Personal Project', icon: 'heart', desc: 'Plan your own goals', tasks: ['Brain dump ideas', 'Pick top 3 priorities', 'Schedule focus time', 'Weekly review'] },
];

export interface ProjectFormValues {
  name: string;
  desc: string;
  icon: string;
  color: ProjectColor;
  team: string;
  lead: string;
  due: string;
  tmpl: string;
}

export function ProjectDialog({ edit, initial, onSubmit, onClose }: { edit?: Project; initial: ProjectFormValues; onSubmit: (f: ProjectFormValues) => void; onClose: () => void }) {
  const { data } = useWorkspace();
  const [f, setF] = React.useState(initial);
  const [err, setErr] = React.useState('');
  const nameRef = React.useRef<HTMLInputElement>(null);
  const set = <K extends keyof ProjectFormValues>(k: K, v: ProjectFormValues[K]) => setF(s => ({ ...s, [k]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = f.name.trim();
    if (!name) {
      setErr('Give the project a name');
      nameRef.current?.focus();
      return;
    }
    onSubmit({ ...f, name });
  };

  return (
    <Modal title={edit ? 'Project settings' : 'New project'} sub={edit ? '' : 'Projects hold tasks, files, and conversations for one body of work.'} onClose={onClose} formId="project-form">
      <form id="project-form" className="modal-b" onSubmit={submit} noValidate>
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <button type="button" className="picon lg" style={{ '--c': PROJECT_COLORS[f.color], cursor: 'default', flexShrink: 0, marginTop: 22 } as React.CSSProperties} aria-hidden="true" tabIndex={-1}>
            <NamedIcon name={f.icon} size={18} />
          </button>
          <div className="field grow">
            <label className="label" htmlFor="p-name">
              Project name
            </label>
            <Input
              id="p-name"
              ref={nameRef}
              data-af
              invalid={!!err}
              value={f.name}
              placeholder="e.g. Website Redesign"
              onChange={e => {
                set('name', e.target.value);
                if (err && e.target.value.trim()) setErr('');
              }}
            />
            {err && (
              <span className="err">
                <CircleAlert size={12} />
                {err}
              </span>
            )}
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="p-desc">
            Description
          </label>
          <Textarea id="p-desc" rows={2} placeholder="What is this project about?" value={f.desc} onChange={e => set('desc', e.target.value)} />
        </div>
        <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <span className="label">Icon</span>
            <div className="iconpick" role="radiogroup" aria-label="Icon">
              {PICONS.map(i => (
                <button key={i} type="button" role="radio" aria-checked={f.icon === i} className={f.icon === i ? 'on' : ''} onClick={() => set('icon', i)} aria-label={i}>
                  <NamedIcon name={i} size={15} />
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="label">Color</span>
            <div className="swatches" role="radiogroup" aria-label="Color" style={{ maxWidth: 140 }}>
              {(Object.entries(PROJECT_COLORS) as [ProjectColor, string][]).map(([k, v]) => (
                <button key={k} type="button" role="radio" aria-checked={f.color === k} className={'sw' + (f.color === k ? ' on' : '')} style={{ '--c': v, width: 22, height: 22 } as React.CSSProperties} onClick={() => set('color', k)} aria-label={k}>
                  {f.color === k && <Check size={12} />}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 1, minWidth: 150 }}>
            <label className="label" htmlFor="p-team">
              Team
            </label>
            <select className="select" id="p-team" value={f.team} onChange={e => set('team', e.target.value)}>
              {data.teams.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 150 }}>
            <label className="label" htmlFor="p-lead">
              Lead
            </label>
            <select className="select" id="p-lead" value={f.lead} onChange={e => set('lead', e.target.value)}>
              {data.members
                .filter(x => x.status === 'active')
                .map(x => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 150 }}>
            <label className="label" htmlFor="p-due">
              Target date
            </label>
            <input type="date" className="input" id="p-due" value={f.due || ''} onChange={e => set('due', e.target.value)} />
          </div>
        </div>
        {!edit && (
          <div className="field">
            <span className="label">Template</span>
            <div className="tmpls" role="radiogroup">
              {TEMPLATES.map(t => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={f.tmpl === t.id}
                  className={'opt' + (f.tmpl === t.id ? ' on' : '')}
                  style={{ padding: 10 }}
                  onClick={() =>
                    setF(s => ({ ...s, tmpl: t.id, icon: s.icon === 'folder' ? (t.icon === 'file' ? 'folder' : t.icon) : s.icon }))
                  }
                >
                  <NamedIcon name={t.icon} size={16} />
                  <b style={{ fontSize: 12.5 }}>{t.name}</b>
                  <span>{t.tasks.length ? t.tasks.length + ' starter tasks' : t.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </form>
      <div className="modal-f">
        <span className="sp" />
        <Button variant="secondary" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" form="project-form">
          {edit ? 'Save changes' : 'Create project'}
        </Button>
      </div>
    </Modal>
  );
}

/* ---------- доступ к проекту ---------- */

export const PERMS = ['Can view', 'Can comment', 'Can edit', 'Full access'];

export function ShareDialog({ projectId, onClose, onCopyLink }: { projectId: string; onClose: () => void; onCopyLink: () => void }) {
  const { data, dispatch } = useWorkspace();
  const p = findProject(data, projectId);
  const [q, setQ] = React.useState('');
  const [perm, setPerm] = React.useState('Can edit');
  if (!p) return null;
  const perms = p.perms ?? {};
  const access = p.access ?? 'workspace';
  const ql = q.toLowerCase();
  const matches = q ? data.members.filter(x => !p.members.includes(x.id) && (x.name.toLowerCase().includes(ql) || x.email.includes(ql))) : [];

  const add = (id: string) => {
    const m = data.members.find(x => x.id === id)!;
    dispatch({ type: 'project/update', id: p.id, patch: { members: [...p.members, id] } });
    setQ('');
    toast(`${m.name} can now edit ${p.name}`);
  };

  const invite = (e: React.FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    if (!v) return;
    const ex = data.members.find(x => x.email.toLowerCase() === v.toLowerCase() || x.name.toLowerCase() === v.toLowerCase());
    if (ex) {
      if (!p.members.includes(ex.id)) dispatch({ type: 'project/update', id: p.id, patch: { members: [...p.members, ex.id], perms: { ...perms, [ex.id]: perm } } });
      setQ('');
      toast(`Shared with ${ex.name}`);
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(v)) {
      toast.error('Enter a valid email address, like name@company.com');
      return;
    }
    const name = v
      .split('@')[0]
      .replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
    dispatch({ type: 'project/inviteMember', id: p.id, perm, member: { id: uid('m'), name, email: v, role: 'Guest', team: p.team, title: 'Guest', c: '#6B7280', status: 'invited', last: null, tz: '—' } });
    setQ('');
    toast(`Invitation sent to ${v}`);
  };

  const setMemberPerm = (id: string, value: string) => {
    const m = data.members.find(x => x.id === id)!;
    if (value === '__remove') {
      const prev = { members: p.members, perms: p.perms };
      dispatch({ type: 'project/update', id: p.id, patch: { members: p.members.filter(x => x !== id) } });
      toast(`Removed ${m.name}`, { action: { label: 'Undo', onClick: () => dispatch({ type: 'project/update', id: p.id, patch: prev }) } });
    } else {
      dispatch({ type: 'project/update', id: p.id, patch: { perms: { ...perms, [id]: value } } });
      toast(`${m.name}: ${value}`, { duration: 1800 });
    }
  };

  return (
    <Modal title={`Share “${p.name}”`} onClose={onClose}>
      <div className="modal-b">
        <form className="row" style={{ gap: 6 }} onSubmit={invite} noValidate>
          <div className="grow">
            <label className="sr" htmlFor="share-in">
              Invite by email
            </label>
            <input className="input" id="share-in" data-af placeholder="Add people by name or email" value={q} onChange={e => setQ(e.target.value)} autoComplete="off" />
          </div>
          <select className="select" id="share-perm" style={{ width: 132 }} aria-label="Permission" value={perm} onChange={e => setPerm(e.target.value)}>
            {PERMS.map(x => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <Button variant="primary" type="submit">
            Invite
          </Button>
        </form>
        {q && (
          <div className="panel" style={{ padding: 4 }}>
            {matches.length ? (
              matches.map(x => (
                <button key={x.id} type="button" className="mi" onClick={() => add(x.id)}>
                  <MemberAvatar id={x.id} size="sm" tooltip={false} />
                  {x.name}
                  <span className="r">{x.email}</span>
                </button>
              ))
            ) : (
              <div className="mi faint" style={{ cursor: 'default' }}>
                {q.includes('@') ? `Press Invite to send an invitation to ${q}` : 'No matching members — enter an email to invite someone new'}
              </div>
            )}
          </div>
        )}
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>
            People with access
          </div>
          {p.members.map(id => {
            const x = data.members.find(m => m.id === id);
            if (!x) return null;
            const cur = id === p.lead ? 'Full access' : perms[id] || (x.role === 'Guest' ? 'Can comment' : 'Can edit');
            return (
              <div key={id} className="row" style={{ height: 44 }}>
                <MemberAvatar id={id} size="md" tooltip={false} />
                <div className="grow">
                  <div style={{ fontWeight: 500, fontSize: 13 }}>
                    {x.name}
                    {id === data.me && <> <span className="faint" style={{ fontWeight: 400 }}>(you)</span></>}
                  </div>
                  <div className="faint" style={{ fontSize: 11.5 }}>
                    {x.email}
                    {id === p.lead ? ' · Project lead' : ''}
                  </div>
                </div>
                {id === p.lead ? (
                  <span className="muted" style={{ fontSize: 12.5, paddingRight: 8 }}>
                    Full access
                  </span>
                ) : (
                  <select className="select" style={{ width: 'auto', height: 26, fontSize: 12, borderColor: 'transparent', backgroundColor: 'transparent', fieldSizing: 'content' } as React.CSSProperties} aria-label={`Permission for ${x.name}`} value={cur} onChange={e => setMemberPerm(id, e.target.value)}>
                    {PERMS.map(pm => (
                      <option key={pm}>{pm}</option>
                    ))}
                    <option value="__remove">Remove access</option>
                  </select>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ borderTop: '1px solid var(--divider)', paddingTop: 12 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            General access
          </div>
          <div className="row" style={{ gap: 10 }}>
            <span className="ftype" style={{ '--c': 'var(--text-2)' } as React.CSSProperties}>
              {access === 'private' ? <Lock size={14} /> : <Building2 size={14} />}
            </span>
            <div className="grow">
              <select
                className="select"
                style={{ height: 28, width: 'auto', borderColor: 'transparent', paddingLeft: 4, fontWeight: 500, fieldSizing: 'content' } as React.CSSProperties}
                aria-label="General access"
                value={access}
                onChange={e => dispatch({ type: 'project/update', id: p.id, patch: { access: e.target.value as 'private' | 'workspace' } })}
              >
                <option value="private">Only people invited</option>
                <option value="workspace">Everyone at {data.ws.name}</option>
              </select>
              <div className="faint" style={{ fontSize: 11.5, paddingLeft: 4 }}>
                {access === 'private' ? 'Only people listed above can open this project.' : 'Anyone in the workspace can view and comment.'}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="modal-f">
        <Button variant="secondary" type="button" onClick={onCopyLink}>
          <Link size={14} />
          Copy link
        </Button>
        <span className="sp" />
        <Button variant="primary" type="button" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}

/* ---------- сохранение вида ---------- */

export function SaveViewDialog({ filters, type, onSubmit, onClose }: { filters: SavedView['filters']; type: SavedView['type']; onSubmit: (name: string, type: SavedView['type']) => void; onClose: () => void }) {
  const [name, setName] = React.useState('');
  const [layout, setLayout] = React.useState<SavedView['type']>(type);
  const n = filters.length;
  return (
    <Modal title="Save view" sub="Save the current filters as a tab on this project." size="sm" onClose={onClose} formId="sv-form">
      <form
        id="sv-form"
        className="modal-b"
        noValidate
        onSubmit={e => {
          e.preventDefault();
          onSubmit(name.trim() || 'Untitled view', layout);
        }}
      >
        <div className="field">
          <label className="label" htmlFor="sv-name">
            View name
          </label>
          <input className="input" id="sv-name" data-af placeholder="e.g. Design review queue" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="sv-type">
            Layout
          </label>
          <select className="select" id="sv-type" value={layout} onChange={e => setLayout(e.target.value as SavedView['type'])}>
            <option value="list">List</option>
            <option value="board">Board</option>
            <option value="table">Table</option>
          </select>
        </div>
        {n ? (
          <div className="hint">
            {n} filter{n > 1 ? 's' : ''} will be saved with this view.
          </div>
        ) : (
          <div className="alert info">
            <Info size={14} className="i" />
            <span>No filters are active — the view will show all tasks. You can add filters after saving.</span>
          </div>
        )}
      </form>
      <div className="modal-f">
        <span className="sp" />
        <Button variant="secondary" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" form="sv-form">
          Save view
        </Button>
      </div>
    </Modal>
  );
}

/* ---------- подтверждение ---------- */

export interface ConfirmSpec {
  title: string;
  body: React.ReactNode;
  ok: string;
  danger?: boolean;
  /** Для опасных действий — имя, которое нужно ввести */
  typeName?: string;
  run: () => void;
}

export function ConfirmModal({ spec, onClose }: { spec: ConfirmSpec; onClose: () => void }) {
  const [text, setText] = React.useState('');
  const needs = spec.typeName;
  const ok = !needs || text === needs;
  const Icon = spec.danger ? Trash2 : Archive;
  const submit = () => {
    if (!ok) return;
    onClose();
    spec.run();
  };
  return (
    <Modal size="sm" onClose={onClose}>
      <div className="modal-b" style={{ paddingTop: 18, gap: 10 }}>
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <span className="ftype" style={{ '--c': spec.danger ? 'var(--red)' : 'var(--amber)', width: 34, height: 34, borderRadius: 9 } as React.CSSProperties}>
            <Icon size={17} />
          </span>
          <div className="grow">
            <ModalTitle asChild>
              <h2 style={{ fontSize: 15, fontWeight: 600, margin: '4px 0 6px' }}>{spec.title}</h2>
            </ModalTitle>
            <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.55 }}>
              {spec.body}
            </p>
          </div>
        </div>
        {needs && (
          <div className="field" style={{ marginTop: 6 }}>
            <label className="label" htmlFor="confirm-in" style={{ fontWeight: 400, color: 'var(--text-2)' }}>
              Type <b style={{ color: 'var(--text)', fontWeight: 600 }}>{needs}</b> to confirm
            </label>
            <input
              className="input"
              id="confirm-in"
              data-af
              autoComplete="off"
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </div>
        )}
      </div>
      <div className="modal-f">
        <span className="sp" />
        <Button variant="secondary" type="button" data-af={needs ? undefined : ''} onClick={onClose}>
          Cancel
        </Button>
        <Button variant={spec.danger ? 'danger' : 'primary'} type="button" disabled={!ok} onClick={submit}>
          {spec.ok}
        </Button>
      </div>
    </Modal>
  );
}
