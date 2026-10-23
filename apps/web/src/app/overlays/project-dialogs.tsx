/* Окна форм проекта — порт projectModal, shareModal, saveView и confirmModal из overlays/modals.js */
import * as React from 'react';
import { Archive, Building2, Check, CircleAlert, Info, Link, Lock, Trash2 } from 'lucide-react';
import { Button, Input, Textarea, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { useWorkspace, uid } from '../data/store';
import { PROJECT_COLORS, project as findProject } from '../data/selectors';
import type { Project, ProjectColor, SavedView } from '../data/types';
import { NamedIcon } from '../components/icons';
import { MemberAvatar } from '../components/workspace';
import { Modal, ModalTitle } from './modal-shell';

/* ---------- проект: создание и настройки ---------- */

export const PICONS = ['globe', 'smartphone', 'megaphone', 'rocket', 'component', 'building-2', 'layout-grid', 'palette', 'code', 'briefcase', 'target', 'layers', 'zap', 'heart', 'folder', 'sparkles'];

/* Каталог шаблонов проекта. Поля name/desc — английские идентификаторы,
   нужные другим страницам (OnboardingPage и т. п.). В UI рендерим t-ключ. */
export const TEMPLATES = [
  { id: 'blank', name: 'Blank project', icon: 'file', desc: 'Start from scratch', tasks: [] as string[] },
  { id: 'product', name: 'Product Development', icon: 'target', desc: 'Discovery to launch', tasks: ['taskDefineProblem', 'taskUserResearch', 'taskWritePrd', 'taskDesignExploration', 'taskBuildMvp', 'taskBetaLaunch'] },
  { id: 'web', name: 'Website', icon: 'globe', desc: 'IA, design, build, launch', tasks: ['taskSitemap', 'taskWireframes', 'taskVisualDesign', 'taskBuildPages', 'taskContentMigration', 'taskQaLaunch'] },
  { id: 'mkt', name: 'Marketing Campaign', icon: 'megaphone', desc: 'Brief, assets, channels', tasks: ['taskCampaignBrief', 'taskAudienceResearch', 'taskCreativeAssets', 'taskChannelPlan', 'taskLaunch', 'taskPerformanceReport'] },
  { id: 'design', name: 'Design Project', icon: 'palette', desc: 'Discovery to handoff', tasks: ['taskDiscovery', 'taskMoodboard', 'taskConcepts', 'taskRefinement', 'taskHandoff'] },
  { id: 'software', name: 'Software Development', icon: 'code', desc: 'Spec, build, ship', tasks: ['taskTechSpec', 'taskRepoCi', 'taskCoreApi', 'taskTests', 'taskCodeReview', 'taskDeployStaging'] },
  { id: 'personal', name: 'Personal Project', icon: 'heart', desc: 'Plan your own goals', tasks: ['taskBrainDump', 'taskPriorities', 'taskFocusTime', 'taskWeeklyReview'] },
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
  const t = useT();
  const [f, setF] = React.useState(initial);
  const [err, setErr] = React.useState('');
  const nameRef = React.useRef<HTMLInputElement>(null);
  const set = <K extends keyof ProjectFormValues>(k: K, v: ProjectFormValues[K]) => setF(s => ({ ...s, [k]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = f.name.trim();
    if (!name) {
      setErr(t('overlays.projectDialog.nameRequired'));
      nameRef.current?.focus();
      return;
    }
    onSubmit({ ...f, name });
  };

  return (
    <Modal title={edit ? t('overlays.projectDialog.editTitle') : t('overlays.projectDialog.newTitle')} sub={edit ? '' : t('overlays.projectDialog.newSub')} onClose={onClose} formId="project-form">
      <form id="project-form" className="modal-b" onSubmit={submit} noValidate>
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <button type="button" className="picon lg" style={{ '--c': PROJECT_COLORS[f.color], cursor: 'default', flexShrink: 0, marginTop: 22 } as React.CSSProperties} aria-hidden="true" tabIndex={-1}>
            <NamedIcon name={f.icon} size={18} />
          </button>
          <div className="field grow">
            <label className="label" htmlFor="p-name">
              {t('overlays.projectDialog.nameLabel')}
            </label>
            <Input
              id="p-name"
              ref={nameRef}
              data-af
              invalid={!!err}
              value={f.name}
              placeholder={t('overlays.projectDialog.namePlaceholder')}
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
            {t('overlays.projectDialog.descLabel')}
          </label>
          <Textarea id="p-desc" rows={2} placeholder={t('overlays.projectDialog.descPlaceholder')} value={f.desc} onChange={e => set('desc', e.target.value)} />
        </div>
        <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <span className="label">{t('overlays.projectDialog.iconLabel')}</span>
            <div className="iconpick" role="radiogroup" aria-label={t('overlays.projectDialog.iconLabel')}>
              {PICONS.map(i => (
                <button key={i} type="button" role="radio" aria-checked={f.icon === i} className={f.icon === i ? 'on' : ''} onClick={() => set('icon', i)} aria-label={i}>
                  <NamedIcon name={i} size={15} />
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="label">{t('overlays.projectDialog.colorLabel')}</span>
            <div className="swatches" role="radiogroup" aria-label={t('overlays.projectDialog.colorLabel')} style={{ maxWidth: 140 }}>
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
              {t('overlays.projectDialog.teamLabel')}
            </label>
            <select className="select" id="p-team" value={f.team} onChange={e => set('team', e.target.value)}>
              {data.teams.map(team => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 150 }}>
            <label className="label" htmlFor="p-lead">
              {t('overlays.projectDialog.leadLabel')}
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
              {t('overlays.projectDialog.dueLabel')}
            </label>
            <input type="date" className="input" id="p-due" value={f.due || ''} onChange={e => set('due', e.target.value)} />
          </div>
        </div>
        {!edit && (
          <div className="field">
            <span className="label">{t('overlays.projectDialog.templateLabel')}</span>
            <div className="tmpls" role="radiogroup">
              {TEMPLATES.map(tmpl => (
                <button
                  key={tmpl.id}
                  type="button"
                  role="radio"
                  aria-checked={f.tmpl === tmpl.id}
                  className={'opt' + (f.tmpl === tmpl.id ? ' on' : '')}
                  style={{ padding: 10 }}
                  onClick={() =>
                    setF(s => ({ ...s, tmpl: tmpl.id, icon: s.icon === 'folder' ? (tmpl.icon === 'file' ? 'folder' : tmpl.icon) : s.icon }))
                  }
                >
                  <NamedIcon name={tmpl.icon} size={16} />
                  <b style={{ fontSize: 12.5 }}>{t(`overlays.projectDialog.templates.${tmpl.id}.name` as any)}</b>
                  <span>{tmpl.tasks.length ? t('overlays.projectDialog.starterTasks', { count: tmpl.tasks.length }) : t(`overlays.projectDialog.templates.${tmpl.id}.desc` as any)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </form>
      <div className="modal-f">
        <span className="sp" />
        <Button variant="secondary" type="button" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" type="submit" form="project-form">
          {edit ? t('overlays.projectDialog.save') : t('overlays.projectDialog.create')}
        </Button>
      </div>
    </Modal>
  );
}

/* ---------- доступ к проекту ---------- */

export const PERMS = ['view', 'comment', 'edit', 'full'] as const;
type PermKey = (typeof PERMS)[number];

export function ShareDialog({ projectId, onClose, onCopyLink }: { projectId: string; onClose: () => void; onCopyLink: () => void }) {
  const { data, dispatch } = useWorkspace();
  const t = useT();
  const p = findProject(data, projectId);
  const [q, setQ] = React.useState('');
  const [perm, setPerm] = React.useState<PermKey>('edit');
  if (!p) return null;
  const perms = p.perms ?? {};
  const access = p.access ?? 'workspace';
  const ql = q.toLowerCase();
  const matches = q ? data.members.filter(x => !p.members.includes(x.id) && (x.name.toLowerCase().includes(ql) || x.email.includes(ql))) : [];

  const permLabel = (k: string) => {
    if (k === 'Can view') return t('overlays.projectDialog.perms.view');
    if (k === 'Can comment') return t('overlays.projectDialog.perms.comment');
    if (k === 'Can edit') return t('overlays.projectDialog.perms.edit');
    if (k === 'Full access') return t('overlays.projectDialog.perms.full');
    return t(`overlays.projectDialog.perms.${k}` as 'overlays.projectDialog.perms.edit');
  };

  const add = (id: string) => {
    const m = data.members.find(x => x.id === id)!;
    dispatch({ type: 'project/update', id: p.id, patch: { members: [...p.members, id] } });
    setQ('');
    toast(t('overlays.projectDialog.share.addedToast', { name: m.name, project: p.name }));
  };

  const invite = (e: React.FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    if (!v) return;
    const ex = data.members.find(x => x.email.toLowerCase() === v.toLowerCase() || x.name.toLowerCase() === v.toLowerCase());
    if (ex) {
      if (!p.members.includes(ex.id)) dispatch({ type: 'project/update', id: p.id, patch: { members: [...p.members, ex.id], perms: { ...perms, [ex.id]: perm } } });
      setQ('');
      toast(t('overlays.projectDialog.share.sharedToast', { name: ex.name }));
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(v)) {
      toast.error(t('overlays.projectDialog.share.invalidEmail'));
      return;
    }
    const name = v
      .split('@')[0]
      .replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
    dispatch({ type: 'project/inviteMember', id: p.id, perm, member: { id: uid('m'), name, email: v, role: 'Guest', team: p.team, title: 'Guest', c: '#6B7280', status: 'invited', last: null, tz: '—' } });
    setQ('');
    toast(t('overlays.projectDialog.share.invitedToast', { email: v }));
  };

  const setMemberPerm = (id: string, value: string) => {
    const m = data.members.find(x => x.id === id)!;
    if (value === '__remove') {
      const prev = { members: p.members, perms: p.perms };
      dispatch({ type: 'project/update', id: p.id, patch: { members: p.members.filter(x => x !== id) } });
      toast(t('overlays.projectDialog.share.removedToast', { name: m.name }), { action: { label: t('common.undo'), onClick: () => dispatch({ type: 'project/update', id: p.id, patch: prev }) } });
    } else {
      dispatch({ type: 'project/update', id: p.id, patch: { perms: { ...perms, [id]: value } } });
      toast(t('overlays.projectDialog.share.permToast', { name: m.name, permission: permLabel(value) }), { duration: 1800 });
    }
  };

  return (
    <Modal title={t('overlays.projectDialog.share.title', { name: p.name })} onClose={onClose}>
      <div className="modal-b">
        <form className="row" style={{ gap: 6 }} onSubmit={invite} noValidate>
          <div className="grow">
            <label className="sr" htmlFor="share-in">
              {t('overlays.projectDialog.share.inviteAria')}
            </label>
            <input className="input" id="share-in" data-af placeholder={t('overlays.projectDialog.share.invitePlaceholder')} value={q} onChange={e => setQ(e.target.value)} autoComplete="off" />
          </div>
          <select className="select" id="share-perm" style={{ width: 132 }} aria-label={t('overlays.projectDialog.share.permAria')} value={perm} onChange={e => setPerm(e.target.value as PermKey)}>
            {PERMS.map(x => (
              <option key={x} value={x}>
                {t(`overlays.projectDialog.perms.${x}` as 'overlays.projectDialog.perms.edit')}
              </option>
            ))}
          </select>
          <Button variant="primary" type="submit">
            {t('overlays.projectDialog.share.invite')}
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
                {q.includes('@') ? t('overlays.projectDialog.share.noMatchEmail', { email: q }) : t('overlays.projectDialog.share.noMatchName')}
              </div>
            )}
          </div>
        )}
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>
            {t('overlays.projectDialog.share.peopleWithAccess')}
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
                    {id === data.me && <> <span className="faint" style={{ fontWeight: 400 }}>{t('overlays.projectDialog.share.you')}</span></>}
                  </div>
                  <div className="faint" style={{ fontSize: 11.5 }}>
                    {x.email}
                    {id === p.lead ? t('overlays.projectDialog.share.projectLeadSuffix') : ''}
                  </div>
                </div>
                {id === p.lead ? (
                  <span className="muted" style={{ fontSize: 12.5, paddingRight: 8 }}>
                    {t('overlays.projectDialog.perms.full')}
                  </span>
                ) : (
                  <select className="select" style={{ width: 'auto', height: 26, fontSize: 12, borderColor: 'transparent', backgroundColor: 'transparent', fieldSizing: 'content' } as React.CSSProperties} aria-label={t('overlays.projectDialog.share.permFor', { name: x.name })} value={cur} onChange={e => setMemberPerm(id, e.target.value)}>
                    {PERMS.map(pm => (
                      <option key={pm} value={pm}>
                        {t(`overlays.projectDialog.perms.${pm}` as 'overlays.projectDialog.perms.edit')}
                      </option>
                    ))}
                    <option value="__remove">{t('overlays.projectDialog.share.removeAccess')}</option>
                  </select>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ borderTop: '1px solid var(--divider)', paddingTop: 12 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            {t('overlays.projectDialog.share.generalAccess')}
          </div>
          <div className="row" style={{ gap: 10 }}>
            <span className="ftype" style={{ '--c': 'var(--text-2)' } as React.CSSProperties}>
              {access === 'private' ? <Lock size={14} /> : <Building2 size={14} />}
            </span>
            <div className="grow">
              <select
                className="select"
                style={{ height: 28, width: 'auto', borderColor: 'transparent', paddingLeft: 4, fontWeight: 500, fieldSizing: 'content' } as React.CSSProperties}
                aria-label={t('overlays.projectDialog.share.generalAccess')}
                value={access}
                onChange={e => dispatch({ type: 'project/update', id: p.id, patch: { access: e.target.value as 'private' | 'workspace' } })}
              >
                <option value="private">{t('overlays.projectDialog.share.onlyInvited')}</option>
                <option value="workspace">{t('overlays.projectDialog.share.everyoneAt', { name: data.ws.name })}</option>
              </select>
              <div className="faint" style={{ fontSize: 11.5, paddingLeft: 4 }}>
                {access === 'private' ? t('overlays.projectDialog.share.onlyInvitedHint') : t('overlays.projectDialog.share.workspaceHint')}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="modal-f">
        <Button variant="secondary" type="button" onClick={onCopyLink}>
          <Link size={14} />
          {t('overlays.projectDialog.share.copyLink')}
        </Button>
        <span className="sp" />
        <Button variant="primary" type="button" onClick={onClose}>
          {t('overlays.projectDialog.share.done')}
        </Button>
      </div>
    </Modal>
  );
}

/* ---------- сохранение вида ---------- */

export function SaveViewDialog({ filters, type, onSubmit, onClose }: { filters: SavedView['filters']; type: SavedView['type']; onSubmit: (name: string, type: SavedView['type']) => void; onClose: () => void }) {
  const t = useT();
  const [name, setName] = React.useState('');
  const [layout, setLayout] = React.useState<SavedView['type']>(type);
  const n = filters.length;
  return (
    <Modal title={t('overlays.projectDialog.saveView.title')} sub={t('overlays.projectDialog.saveView.sub')} size="sm" onClose={onClose} formId="sv-form">
      <form
        id="sv-form"
        className="modal-b"
        noValidate
        onSubmit={e => {
          e.preventDefault();
          onSubmit(name.trim() || t('overlays.projectDialog.saveView.untitled'), layout);
        }}
      >
        <div className="field">
          <label className="label" htmlFor="sv-name">
            {t('overlays.projectDialog.saveView.nameLabel')}
          </label>
          <input className="input" id="sv-name" data-af placeholder={t('overlays.projectDialog.saveView.namePlaceholder')} value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="sv-type">
            {t('overlays.projectDialog.saveView.layoutLabel')}
          </label>
          <select className="select" id="sv-type" value={layout} onChange={e => setLayout(e.target.value as SavedView['type'])}>
            <option value="list">{t('overlays.projectDialog.saveView.layouts.list')}</option>
            <option value="board">{t('overlays.projectDialog.saveView.layouts.board')}</option>
            <option value="table">{t('overlays.projectDialog.saveView.layouts.table')}</option>
          </select>
        </div>
        {n ? (
          <div className="hint">
            {t('overlays.projectDialog.saveView.filtersHint', { count: n })}
          </div>
        ) : (
          <div className="alert info">
            <Info size={14} className="i" />
            <span>{t('overlays.projectDialog.saveView.noFilters')}</span>
          </div>
        )}
      </form>
      <div className="modal-f">
        <span className="sp" />
        <Button variant="secondary" type="button" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" type="submit" form="sv-form">
          {t('overlays.projectDialog.saveView.save')}
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
  /** Иконка в кружке (по умолчанию корзина для опасных действий, иначе архив) */
  icon?: React.ComponentType<{ size?: number }>;
  run: () => void;
}

export function ConfirmModal({ spec, onClose }: { spec: ConfirmSpec; onClose: () => void }) {
  const t = useT();
  const [text, setText] = React.useState('');
  const needs = spec.typeName;
  const ok = !needs || text === needs;
  const Icon = spec.icon ?? (spec.danger ? Trash2 : Archive);
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
              {t('overlays.projectDialog.confirm.before')}<b style={{ color: 'var(--text)', fontWeight: 600 }}>{needs}</b>{t('overlays.projectDialog.confirm.after')}
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
          {t('common.cancel')}
        </Button>
        <Button variant={spec.danger ? 'danger' : 'primary'} type="button" disabled={!ok} onClick={submit}>
          {spec.ok}
        </Button>
      </div>
    </Modal>
  );
}
