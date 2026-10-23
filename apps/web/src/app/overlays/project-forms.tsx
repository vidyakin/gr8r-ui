/* Формы проекта — порт projectModal, shareModal и saveView из overlays/modals.js и обработчиков из actions/actions.js */
import * as React from 'react';
import { useLocation, useNavigate } from 'react-router';
import { toast } from '@/components/ui';
import { useT } from '@/i18n';
import { useWorkspace, uid } from '../data/store';
import { dOff } from '../lib/dates';
import { me, project as findProject, tasksOf } from '../data/selectors';
import type { SavedView } from '../data/types';
import { ConfirmModal, ProjectDialog, SaveViewDialog, ShareDialog, TEMPLATES, type ConfirmSpec, type ProjectFormValues } from './project-dialogs';

export interface ProjectFormsApi {
  /** Новый проект */
  create(): void;
  /** Редактирование проекта (Rename & edit, Project settings, Edit в About) */
  edit(projectId: string): void;
  /** Доступ к проекту: участники и ссылка */
  share(projectId: string): void;
  /** Сохранить текущие фильтры как вид проекта (filters — из useListView страницы проекта) */
  saveView(projectId: string, filters?: SavedView['filters'], type?: SavedView['type']): void;
  /** Копия проекта вместе с задачами */
  duplicate(projectId: string): void;
  /** Архивация с подтверждением */
  archive(projectId: string): void;
  /** Удаление с подтверждением (нужно ввести название) */
  remove(projectId: string): void;
  /** Копирует ссылку на проект */
  copyLink(projectId: string): void;
}

type Dlg =
  | { kind: 'create' }
  | { kind: 'edit'; id: string }
  | { kind: 'share'; id: string }
  | { kind: 'saveView'; id: string; filters: SavedView['filters']; type: SavedView['type'] }
  | { kind: 'confirm'; spec: ConfirmSpec };

const Ctx = React.createContext<ProjectFormsApi | null>(null);

export function ProjectFormsProvider({ children }: { children: React.ReactNode }) {
  const { data, dispatch } = useWorkspace();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const t = useT();
  const [dlg, setDlg] = React.useState<Dlg | null>(null);
  // Свежие данные и маршрут для колбэков, которые живут дольше одного рендера (Undo, подтверждения)
  const live = React.useRef({ data, pathname });
  live.current = { data, pathname };
  const close = React.useCallback(() => setDlg(null), []);

  const api = React.useMemo<ProjectFormsApi>(() => {
    const onProjectPage = (id: string) => live.current.pathname.startsWith(`/projects/${id}`);
    const copyLink = (id: string) => {
      const { data: d } = live.current;
      const p = findProject(d, id);
      if (!p) return;
      const url = `https://gr8rstudio.com/${d.ws.url}/project/${p.key.toLowerCase()}`;
      navigator.clipboard.writeText(url).then(
        () => toast(t('common.linkCopied')),
        () => toast.info(t('overlays.projectForms.copyFallback', { url }), { duration: 6000 }),
      );
    };
    return {
      create: () => setDlg({ kind: 'create' }),
      edit: id => setDlg({ kind: 'edit', id }),
      share: id => setDlg({ kind: 'share', id }),
      saveView: (id, filters = [], type = 'list') => setDlg({ kind: 'saveView', id, filters: structuredClone(filters), type }),
      copyLink,
      duplicate: id => {
        const p = findProject(live.current.data, id);
        if (!p) return;
        const newId = uid('p');
        dispatch({ type: 'project/duplicate', id, newId });
        toast(t('overlays.projectForms.duplicated', { name: p.name }), { action: { label: t('overlays.projectForms.openAction'), onClick: () => navigate(`/projects/${newId}`) } });
      },
      archive: id => {
        const p = findProject(live.current.data, id);
        if (!p) return;
        setDlg({
          kind: 'confirm',
          spec: {
            title: t('overlays.projectForms.archiveTitle', { name: p.name }),
            body: t('overlays.projectForms.archiveBody'),
            ok: t('overlays.projectForms.archiveOk'),
            run: () => {
              dispatch({ type: 'project/update', id, patch: { archived: true, archivedAt: Date.now() } });
              if (onProjectPage(id)) navigate('/projects');
              toast(t('overlays.projectForms.archivedToast', { name: p.name }), { action: { label: t('common.undo'), onClick: () => dispatch({ type: 'project/update', id, patch: { archived: false, archivedAt: null } }) } });
            },
          },
        });
      },
      remove: id => {
        const p = findProject(live.current.data, id);
        if (!p) return;
        const n = tasksOf(live.current.data, id).length;
        setDlg({
          kind: 'confirm',
          spec: {
            title: t('overlays.projectForms.deleteTitle', { name: p.name }),
            body: (
              <>
                {t('overlays.projectForms.deleteBody', { count: n })}
              </>
            ),
            ok: t('overlays.projectForms.deleteOk'),
            danger: true,
            typeName: p.name,
            run: () => {
              const snapshot = live.current.data;
              dispatch({ type: 'project/delete', id });
              if (onProjectPage(id)) navigate('/projects');
              toast(t('overlays.projectForms.deletedToast', { name: p.name }), { action: { label: t('common.undo'), onClick: () => dispatch({ type: 'data/restore', data: snapshot }) } });
            },
          },
        });
      },
    };
  }, [dispatch, navigate]);

  const editing = dlg?.kind === 'edit' ? findProject(data, dlg.id) : undefined;
  const target = dlg?.kind === 'saveView' ? findProject(data, dlg.id) : undefined;

  return (
    <Ctx.Provider value={api}>
      {children}
      {dlg?.kind === 'create' && (
        <ProjectDialog
          initial={{ name: '', desc: '', icon: 'folder', color: 'indigo', team: me(data).team, lead: data.me, due: dOff(30), tmpl: 'blank' }}
          onClose={close}
          onSubmit={f => {
            const id = uid('p');
            const starter = TEMPLATES.find(tmpl => tmpl.id === f.tmpl)?.tasks ?? [];
            dispatch({ type: 'project/create', id, form: { name: f.name, desc: f.desc, icon: f.icon, color: f.color, team: f.team, lead: f.lead, due: f.due }, tasks: starter });
            close();
            navigate(`/projects/${id}/${f.tmpl === 'blank' ? 'overview' : 'board'}`);
            toast(starter.length ? t('overlays.projectForms.createdWithTasks', { name: f.name, count: starter.length }) : t('overlays.projectForms.created', { name: f.name }));
          }}
        />
      )}
      {editing && (
        <ProjectDialog
          edit={editing}
          initial={{ name: editing.name, desc: editing.desc, icon: editing.icon, color: editing.color, team: editing.team, lead: editing.lead, due: editing.due, tmpl: 'blank' }}
          onClose={close}
          onSubmit={(f: ProjectFormValues) => {
            const { name, desc, icon, color, team, lead, due } = f;
            dispatch({ type: 'project/update', id: editing.id, patch: { name, desc, icon, color, team, lead, due, members: [...new Set([...editing.members, lead])] } });
            close();
            toast(t('overlays.projectForms.updated'));
          }}
        />
      )}
      {dlg?.kind === 'share' && <ShareDialog projectId={dlg.id} onClose={close} onCopyLink={() => api.copyLink(dlg.id)} />}
      {dlg?.kind === 'saveView' && target && (
        <SaveViewDialog
          filters={dlg.filters}
          type={dlg.type}
          onClose={close}
          onSubmit={(name, type) => {
            const view: SavedView = { id: uid('v'), project: target.id, name, type, filters: dlg.filters };
            dispatch({ type: 'savedView/create', view });
            close();
            navigate(`/projects/${target.id}/v:${view.id}`);
            toast(t('overlays.projectForms.savedView', { name }));
          }}
        />
      )}
      {dlg?.kind === 'confirm' && <ConfirmModal spec={dlg.spec} onClose={close} />}
    </Ctx.Provider>
  );
}

export function useProjectForms() {
  const api = React.useContext(Ctx);
  if (!api) throw new Error('useProjectForms: нет ProjectFormsProvider');
  return api;
}
