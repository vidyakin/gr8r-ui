/* Приглашение участников — порт inviteModal и submitInvite из overlays/modals.js и actions/actions.js */
import * as React from 'react';
import { Info, Link } from 'lucide-react';
import { Button, Dialog, DialogClose, DialogContent, Field, Textarea, toast } from '@/components/ui';
import { tEnum, useT } from '@/i18n';
import { apiFor, errorMessage, ok } from '../data/api';
import { useSession } from '../data/session';
import { useWorkspace } from '../data/store';
import type { Member } from '../data/types';

export interface InviteOptions {
  /** Команда, выбранная в списке по умолчанию (например, при приглашении из команды) */
  team?: string;
}

export interface InviteApi {
  open(opts?: InviteOptions): void;
}

const Ctx = React.createContext<InviteApi | null>(null);

const INVITE_ROLES: Member['role'][] = ['Member', 'Admin', 'Guest'];
const EMAIL_RE = /^\S+@\S+\.\S+$/;

/** Рабочая ссылка-приглашение: токен привязан к адресу и действует 7 дней (маршрут `/join/:token`, hash-роутинг) */
export const inviteLink = (token: string) => `${window.location.origin}${window.location.pathname}#/join/${token}`;

/** Выдаёт новую ссылку для неотвеченного приглашения и копирует её. Писем нет (почта не подключена), ссылку передают вручную */
export function useCopyInviteLink() {
  const t = useT();
  const wsId = useSession().active?.id;
  return React.useCallback(
    async (email: string) => {
      if (!wsId) return;
      try {
        const r = await ok<{ token: string }>(apiFor().workspaces[':id'].invites.link.$post({ param: { id: wsId }, json: { email } }));
        await navigator.clipboard?.writeText(inviteLink(r.token)).catch(() => {});
        toast(t('overlays.invite.linkCopiedFor', { email }));
      } catch (e) {
        toast.error(errorMessage(e));
      }
    },
    [wsId, t],
  );
}

function InviteDialog({ open, onOpenChange, opts }: { open: boolean; onOpenChange: (v: boolean) => void; opts: InviteOptions }) {
  const { data, dispatch } = useWorkspace();
  const t = useT();
  const [emails, setEmails] = React.useState('');
  const [role, setRole] = React.useState<Member['role']>('Member');
  const [team, setTeam] = React.useState('');
  const [error, setError] = React.useState('');
  const [created, setCreated] = React.useState<string[] | null>(null);
  const copyLink = useCopyInviteLink();

  // Каждое открытие начинается с чистой формы
  React.useEffect(() => {
    if (!open) return;
    setEmails('');
    setRole('Member');
    setTeam(opts.team && data.teams.some(t => t.id === opts.team) ? opts.team : (data.teams[0]?.id ?? ''));
    setError('');
    setCreated(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = () => {
    const list = emails
      .split(/[\s,;]+/)
      .map(s => s.trim())
      .filter(Boolean);
    const bad = list.find(e => !EMAIL_RE.test(e));
    if (!list.length) return setError(t('overlays.invite.noEmails'));
    if (bad) return setError(t('overlays.invite.invalidEmail', { email: bad }));
    setError('');
    // Профиль «приглашён» создаётся сразу; письма не уходят, поэтому дальше показываем ссылки для передачи вручную
    const fresh = list.filter((e, i) => list.indexOf(e) === i && !data.members.some(m => m.email === e));
    if (!fresh.length) return setError(t('overlays.invite.allExist'));
    dispatch({ type: 'member/invite', emails: list, role, team });
    setCreated(fresh);
    toast(t('overlays.invite.sent', { count: fresh.length }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('overlays.invite.title', { name: data.ws.name })}
        description={t('overlays.invite.description')}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">{created ? t('overlays.invite.done') : t('common.cancel')}</Button>
            </DialogClose>
            {!created && (
              <Button variant="primary" type="submit" form="invite-form">
                {t('overlays.invite.send')}
              </Button>
            )}
          </>
        }
      >
        {created ? (
          <div className="col" style={{ gap: 10 }}>
            <div className="alert info">
              <Info size={14} />
              <span>{t('overlays.invite.linksHint')}</span>
            </div>
            {created.map(e => (
              <div key={e} className="row" style={{ gap: 10 }}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e}</span>
                <Button variant="secondary" onClick={() => void copyLink(e)}>
                  <Link size={14} />
                  {t('overlays.invite.copyLink')}
                </Button>
              </div>
            ))}
          </div>
        ) : (
        <form
          id="invite-form"
          className="contents"
          noValidate
          onSubmit={e => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label={t('overlays.invite.emailsLabel')} hint={t('overlays.invite.emailsHint')} error={error}>
            {f => (
              <Textarea
                {...f}
                placeholder={t('overlays.invite.emailsPlaceholder')}
                rows={3}
                autoFocus
                value={emails}
                onChange={e => setEmails(e.target.value)}
                // Cmd/Ctrl+Enter отправляет форму, как в оригинале
                onKeyDown={e => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && (e.preventDefault(), submit())}
              />
            )}
          </Field>
          <div className="row" style={{ gap: 12 }}>
            <div className="field" style={{ flex: 1, minWidth: 0 }}>
              <label className="label" htmlFor="inv-role">
                {t('overlays.invite.roleLabel')}
              </label>
              <select className="select" id="inv-role" value={role} onChange={e => setRole(e.target.value as Member['role'])}>
                {INVITE_ROLES.map(r => (
                  <option key={r} value={r}>{tEnum('role', r, r)}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 0 }}>
              <label className="label" htmlFor="inv-team">
                {t('overlays.invite.teamLabel')}
              </label>
              <select className="select" id="inv-team" value={team} onChange={e => setTeam(e.target.value)}>
                {data.teams.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {/* Разметка как в оригинале: иконка 14px и span (у Alert из UI-кита иконка 15px) */}
          <div className="alert info">
            <Info size={14} />
            <span>
              <b>{t('overlays.invite.guestsLabel')}</b> {t('overlays.invite.guestsText')}
            </span>
          </div>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function InviteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [opts, setOpts] = React.useState<InviteOptions>({});
  const api = React.useMemo<InviteApi>(
    () => ({
      open: (o = {}) => {
        setOpts(o);
        setOpen(true);
      },
    }),
    [],
  );
  return (
    <Ctx.Provider value={api}>
      {children}
      <InviteDialog open={open} onOpenChange={setOpen} opts={opts} />
    </Ctx.Provider>
  );
}

export function useInvite() {
  const api = React.useContext(Ctx);
  if (!api) throw new Error('useInvite: нет InviteProvider');
  return api;
}
