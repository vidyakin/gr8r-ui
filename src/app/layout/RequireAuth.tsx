/* Защита оболочки: без входа открывается экран входа (в оригинале приложение не рисуется, пока S.ui.auth задан) */
import { Navigate } from 'react-router';
import { useSignedIn } from '../lib/auth';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  return useSignedIn() ? children : <Navigate to="/signin" replace />;
}
