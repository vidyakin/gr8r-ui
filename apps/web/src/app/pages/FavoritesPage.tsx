/* Избранное — порт pageFavorites из pages/favorites.js */
import { useNavigate } from 'react-router';
import { Star } from 'lucide-react';
import { Button, EmptyState } from '@/components/ui';
import { useWorkspace } from '../data/store';
import { allTasks, canSee, visibleProjects } from '../data/selectors';
import { SECTIONS } from '../routes';
import { ProjectCard } from '../components/project';
import { MiniTaskRow, useTaskActions } from '../components/workspace';
import { useT } from '@/i18n';

export function FavoritesPage() {
  const t = useT();
  const { data } = useWorkspace();
  const navigate = useNavigate();
  const { open } = useTaskActions();
  const projects = visibleProjects(data).filter(p => p.fav && canSee(data, p));
  const tasks = allTasks(data).filter(t2 => t2.fav);

  return (
    <div className="page wide">
      <div className="ph">
        <div>
          <h1>{t('pages.favorites.title')}</h1>
          <p>{t('pages.favorites.subline')}</p>
        </div>
      </div>
      {!projects.length && !tasks.length ? (
        <div className="panel">
          <EmptyState
            icon={<Star />}
            title={t('pages.favorites.emptyTitle')}
            action={
              <Button size="sm" onClick={() => navigate(SECTIONS.projects.path)}>
                {t('pages.favorites.browseProjects')}
              </Button>
            }
          >
            {t('pages.favorites.emptyHint')}
          </EmptyState>
        </div>
      ) : (
        <>
          <h2 className="sec" style={{ marginBottom: 10 }}>
            {t('pages.favorites.projectsTitle')}{' '}
            <span className="faint" style={{ fontWeight: 500 }}>
              {projects.length}
            </span>
          </h2>
          {projects.length ? (
            <div className="pgrid" style={{ marginBottom: 28 }}>
              {projects.map(p => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
          ) : (
            <p className="faint" style={{ marginBottom: 28 }}>
              {t('pages.favorites.noFavoriteProjects')}
            </p>
          )}
          <h2 className="sec" style={{ marginBottom: 6 }}>
            {t('pages.favorites.tasksTitle')}{' '}
            <span className="faint" style={{ fontWeight: 500 }}>
              {tasks.length}
            </span>
          </h2>
          {tasks.length ? (
            <div className="panel" style={{ overflow: 'hidden' }}>
              {tasks.map(t2 => (
                <MiniTaskRow key={t2.id} task={t2} onOpen={open} />
              ))}
            </div>
          ) : (
            <p className="faint">{t('pages.favorites.noFavoriteTasks')}</p>
          )}
        </>
      )}
    </div>
  );
}
