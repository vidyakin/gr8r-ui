/* Избранное — порт pageFavorites из pages/favorites.js */
import { useNavigate } from 'react-router';
import { Star } from 'lucide-react';
import { Button, EmptyState } from '@/components/ui';
import { useWorkspace } from '../data/store';
import { allTasks, canSee, visibleProjects } from '../data/selectors';
import { SECTIONS } from '../routes';
import { ProjectCard } from '../components/project';
import { MiniTaskRow, useTaskActions } from '../components/workspace';

export function FavoritesPage() {
  const { data } = useWorkspace();
  const navigate = useNavigate();
  const { open } = useTaskActions();
  const projects = visibleProjects(data).filter(p => p.fav && canSee(data, p));
  const tasks = allTasks(data).filter(t => t.fav);

  return (
    <div className="page wide">
      <div className="ph">
        <div>
          <h1>Favorites</h1>
          <p>Projects and tasks you've starred for quick access.</p>
        </div>
      </div>
      {!projects.length && !tasks.length ? (
        <div className="panel">
          <EmptyState
            icon={<Star />}
            title="No favorites yet"
            action={
              <Button size="sm" onClick={() => navigate(SECTIONS.projects.path)}>
                Browse projects
              </Button>
            }
          >
            Star a project or task to pin it here.
          </EmptyState>
        </div>
      ) : (
        <>
          <h2 className="sec" style={{ marginBottom: 10 }}>
            Projects{' '}
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
              No favorite projects.
            </p>
          )}
          <h2 className="sec" style={{ marginBottom: 6 }}>
            Tasks{' '}
            <span className="faint" style={{ fontWeight: 500 }}>
              {tasks.length}
            </span>
          </h2>
          {tasks.length ? (
            <div className="panel" style={{ overflow: 'hidden' }}>
              {tasks.map(t => (
                <MiniTaskRow key={t.id} task={t} onOpen={open} />
              ))}
            </div>
          ) : (
            <p className="faint">Open a task and click the star to add it here.</p>
          )}
        </>
      )}
    </div>
  );
}
