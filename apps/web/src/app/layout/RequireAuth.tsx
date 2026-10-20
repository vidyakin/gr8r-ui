/* Защита оболочки: без сессии открывается экран входа, без воркспейсов — онбординг (создание первого воркспейса) */
import { Navigate } from 'react-router';
import { useSession } from '../data/session';
import { LoadingScreen } from '../data/store';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status, workspaces } = useSession();
  if (status === 'loading') return <LoadingScreen />;
  if (status === 'anon') return <Navigate to="/signin" replace />;
  if (!workspaces.length) return <Navigate to="/onboarding" replace />;
  return children;
}
