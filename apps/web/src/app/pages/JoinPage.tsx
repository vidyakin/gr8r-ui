/* Принятие приглашения по ссылке #/join/:token: без сессии отправляем входить (токен запоминаем), с сессией — принимаем и открываем воркспейс */
import * as React from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from '@/components/ui';
import { useT } from '@/i18n';
import { Logo } from '../components/brand';
import { AuthCard, AuthShell } from '../components/auth-shell';
import { apiFor, errorMessage, ok } from '../data/api';
import { rememberWorkspace, useSession } from '../data/session';
import { pendingInvite } from '../lib/auth';
import { SECTIONS } from '../routes';

export function JoinPage() {
  const tr = useT();
  const navigate = useNavigate();
  const { token = '' } = useParams();
  const session = useSession();
  const [error, setError] = React.useState('');
  const started = React.useRef(false);

  React.useEffect(() => {
    if (session.status !== 'authed' || started.current) return;
    started.current = true;
    pendingInvite.set(null);
    ok<{ id: string; name: string }>(apiFor().invites.accept.$post({ json: { token } }))
      .then(async ws => {
        rememberWorkspace(ws.id);
        await session.refreshWorkspaces();
        session.switchWorkspace(ws.id);
        toast(tr('pages.join.joined', { name: ws.name }));
        navigate(SECTIONS.home.path, { replace: true });
      })
      .catch(e => setError(errorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.status]);

  const goAuth = (path: string) => {
    pendingInvite.set(token);
    navigate(path);
  };

  return (
    <AuthShell>
      <AuthCard>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Logo height={30} />
        </div>
        <h1>{tr('pages.join.title')}</h1>
        {session.status === 'loading' && <p className="sub">{tr('pages.join.checking')}</p>}
        {session.status === 'anon' && (
          <>
            <p className="sub">{tr('pages.join.signInFirst')}</p>
            <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => goAuth('/signin')}>
              {tr('pages.auth.signIn')}
            </button>
            <button type="button" className="btn btn-secondary btn-lg btn-block" onClick={() => goAuth('/signup')}>
              {tr('pages.auth.signUp')}
            </button>
          </>
        )}
        {session.status === 'authed' && !error && <p className="sub">{tr('pages.join.joining')}</p>}
        {error && (
          <>
            <p className="sub">{error}</p>
            <p className="sub">{tr('pages.join.errorHint')}</p>
            <button type="button" className="btn btn-secondary btn-lg btn-block" onClick={() => navigate(SECTIONS.home.path, { replace: true })}>
              {tr('pages.join.toApp')}
            </button>
          </>
        )}
      </AuthCard>
    </AuthShell>
  );
}
