/* Форма команды — порт teamModal из features/teams.js и действий newTeam/editTeam/submitTeam/delTeam из actions/teams.js */
import * as React from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Check, CircleAlert, Trash2, Users } from 'lucide-react';
import { Button, Checkbox, Input, toast } from '@/components/ui';
import { useWorkspace, uid } from '../data/store';
import { PROJECT_COLORS } from '../data/selectors';
import type { ProjectColor, Team } from '../data/types';
import { NamedIcon } from '../components/icons';
import { MemberAvatar } from '../components/workspace';
import { Modal } from './modal-shell';
import { ConfirmModal, PICONS, type ConfirmSpec } from './project-dialogs';

export interface TeamFormApi {
  /** Новая команда */
  create(): void;
  /** Редактирование команды (название, иконка, состав; там же удаление) */
  edit(teamId: string): void;
}

interface FormValues {
  name: string;
  desc: string;
  icon: string;
  color: ProjectColor;
  members: string[];
}

type Dlg = { kind: 'form'; edit?: string } | { kind: 'confirm'; spec: ConfirmSpec };

const Ctx = React.createContext<TeamFormApi | null>(null);

const colorKey = (c: string) => ((Object.keys(PROJECT_COLORS) as ProjectColor[]).find(k => PROJECT_COLORS[k] === c) ?? 'slate') as ProjectColor;

function TeamDialog({ edit, onClose, onSubmit, onDelete }: { edit?: Team; onClose: () => void; onSubmit: (f: FormValues) => void; onDelete?: () => void }) {
  const { data } = useWorkspace();
  const [f, setF] = React.useState<FormValues>(() => ({
    name: edit?.name ?? '',
    desc: edit?.desc ?? '',
    icon: edit?.icon ?? 'users',
    color: edit ? colorKey(edit.c) : 'teal',
    members: edit ? data.members.filter(m => m.team === edit.id).map(m => m.id) : [],
  }));
  const [err, setErr] = React.useState('');
  const nameRef = React.useRef<HTMLInputElement>(null);
  const set = <K extends keyof FormValues>(k: K, v: FormValues[K]) => setF(s => ({ ...s, [k]: v }));
  const people = data.members.filter(x => x.status !== 'deactivated');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = f.name.trim();
    const fail = (m: string) => {
      setErr(m);
      nameRef.current?.focus();
    };
    if (!name) return fail('Give the team a name');
    if (data.teams.some(t => t.name.toLowerCase() === name.toLowerCase() && t.id !== edit?.id)) return fail(`A team called “${name}” already exists`);
    onSubmit({ ...f, name, desc: f.desc.trim() });
  };

  return (
    <Modal title={edit ? 'Edit team' : 'New team'} sub={edit ? '' : 'Teams group the people who work on projects together.'} onClose={onClose} formId="team-form">
      <form id="team-form" className="modal-b" onSubmit={submit} noValidate>
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <span className="picon lg" style={{ '--c': PROJECT_COLORS[f.color], marginTop: 22 } as React.CSSProperties} aria-hidden="true">
            <NamedIcon name={f.icon} size={18} />
          </span>
          <div className="field grow">
            <label className="label" htmlFor="tm-name">
              Team name
            </label>
            <Input
              id="tm-name"
              ref={nameRef}
              data-af
              invalid={!!err}
              value={f.name}
              placeholder="e.g. Growth"
              aria-describedby={err ? 'tm-name-err' : undefined}
              onChange={e => {
                set('name', e.target.value);
                if (err && e.target.value.trim()) setErr('');
              }}
            />
            {err && (
              <span className="err" id="tm-name-err" role="alert">
                <CircleAlert size={12} />
                {err}
              </span>
            )}
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="tm-desc">
            What does this team own?
          </label>
          <input className="input" id="tm-desc" value={f.desc} placeholder="e.g. Acquisition experiments and lifecycle email" onChange={e => set('desc', e.target.value)} />
        </div>
        <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <span className="label" id="tm-icon-l">
              Icon
            </span>
            <div className="iconpick" role="radiogroup" aria-labelledby="tm-icon-l">
              {PICONS.map(i => (
                <button key={i} type="button" role="radio" aria-checked={f.icon === i} className={f.icon === i ? 'on' : ''} onClick={() => set('icon', i)} aria-label={i}>
                  <NamedIcon name={i} size={15} />
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="label" id="tm-color-l">
              Color
            </span>
            <div className="swatches" role="radiogroup" aria-labelledby="tm-color-l" style={{ maxWidth: 140 }}>
              {(Object.entries(PROJECT_COLORS) as [ProjectColor, string][]).map(([k, v]) => (
                <button key={k} type="button" role="radio" aria-checked={f.color === k} className={'sw' + (f.color === k ? ' on' : '')} style={{ '--c': v, width: 22, height: 22 } as React.CSSProperties} onClick={() => set('color', k)} aria-label={k}>
                  {f.color === k && <Check size={12} />}
                </button>
              ))}
            </div>
          </div>
        </div>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 6, padding: '0 2px' }}>
            Members <span className="faint" style={{ fontWeight: 400 }}>· {f.members.length} selected</span>
          </legend>
          <div className="panel" style={{ maxHeight: 220, overflowY: 'auto', padding: 4 }}>
            {people.map(x => {
              const other = x.team && x.team !== edit?.id ? data.teams.find(t => t.id === x.team) : undefined;
              return (
                <label key={x.id} className="mi" style={{ cursor: 'pointer', minHeight: 36 }}>
                  <Checkbox checked={f.members.includes(x.id)} onChange={() => set('members', f.members.includes(x.id) ? f.members.filter(id => id !== x.id) : [...f.members, x.id])} />
                  <MemberAvatar id={x.id} size="sm" tooltip={false} />
                  <span className="grow trunc">{x.name}</span>
                  <span className="r">{other?.name ?? ''}</span>
                </label>
              );
            })}
          </div>
          <span className="hint">Everyone belongs to one primary team. Adding someone here moves them from their current team.</span>
        </fieldset>
      </form>
      <div className="modal-f">
        {edit && (
          <Button variant="danger-ghost" type="button" onClick={onDelete}>
            <Trash2 size={14} />
            Delete team
          </Button>
        )}
        <span className="sp" />
        <Button variant="secondary" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" form="team-form">
          {edit ? 'Save changes' : 'Create team'}
        </Button>
      </div>
    </Modal>
  );
}

export function TeamFormProvider({ children }: { children: React.ReactNode }) {
  const { data, dispatch } = useWorkspace();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [dlg, setDlg] = React.useState<Dlg | null>(null);
  // Свежие данные и маршрут для колбэков, которые живут дольше одного рендера (Undo, подтверждение)
  const live = React.useRef({ data, pathname });
  live.current = { data, pathname };
  const close = React.useCallback(() => setDlg(null), []);

  const api = React.useMemo<TeamFormApi>(() => ({ create: () => setDlg({ kind: 'form' }), edit: id => setDlg({ kind: 'form', edit: id }) }), []);

  const editing = dlg?.kind === 'form' && dlg.edit ? data.teams.find(t => t.id === dlg.edit) : undefined;

  const submit = (f: FormValues) => {
    const c = PROJECT_COLORS[f.color];
    if (editing) {
      dispatch({ type: 'team/update', id: editing.id, patch: { name: f.name, desc: f.desc, icon: f.icon, c }, members: f.members });
      close();
      toast(`Saved ${f.name}`);
    } else {
      const team: Team = { id: uid('tm'), name: f.name, desc: f.desc || 'No description yet.', icon: f.icon, c };
      dispatch({ type: 'team/create', team, members: f.members });
      close();
      navigate(`/teams/${team.id}`);
      toast(`Created ${f.name}`);
    }
  };

  // Удаление: форма закрывается, затем подтверждение (как в оригинале)
  const askDelete = (t: Team) => {
    const d = live.current.data;
    const n = d.members.filter(x => x.team === t.id).length;
    const np = d.projects.filter(p => p.team === t.id).length;
    setDlg({
      kind: 'confirm',
      spec: {
        title: `Delete ${t.name}?`,
        body: (
          <>
            {n ? <b>{`${n} member${n > 1 ? 's' : ''}`}</b> : null}
            {n ? ' will have no team' : 'The team has no members'}
            {np ? (
              <>
                {' '}
                and <b>{`${np} project${np > 1 ? 's' : ''}`}</b> will need a new team
              </>
            ) : null}
            . People and projects are not deleted.
          </>
        ),
        ok: 'Delete team',
        danger: true,
        icon: Users,
        run: () => {
          const snap = live.current.data;
          dispatch({ type: 'team/delete', id: t.id });
          if (live.current.pathname === `/teams/${t.id}`) navigate('/teams');
          toast(`Deleted ${t.name}`, { action: { label: 'Undo', onClick: () => dispatch({ type: 'data/restore', data: snap }) } });
        },
      },
    });
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      {dlg?.kind === 'form' && (!dlg.edit || editing) && <TeamDialog key={dlg.edit ?? 'new'} edit={editing} onClose={close} onSubmit={submit} onDelete={() => editing && askDelete(editing)} />}
      {dlg?.kind === 'confirm' && <ConfirmModal spec={dlg.spec} onClose={close} />}
    </Ctx.Provider>
  );
}

export function useTeamForm() {
  const api = React.useContext(Ctx);
  if (!api) throw new Error('useTeamForm: нет TeamFormProvider');
  return api;
}
