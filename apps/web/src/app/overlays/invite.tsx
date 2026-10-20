/* Приглашение участников — порт inviteModal и submitInvite из overlays/modals.js и actions/actions.js */
import * as React from 'react';
import { Info, Link } from 'lucide-react';
import { Button, Dialog, DialogClose, DialogContent, Field, Textarea, toast } from '@/components/ui';
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

/** Ссылка-приглашение воркспейса (в оригинале — фиксированный токен) */
export const inviteLink = (wsUrl: string) => `https://gr8rstudio.com/join/${wsUrl}-7f3k2`;

function InviteDialog({ open, onOpenChange, opts }: { open: boolean; onOpenChange: (v: boolean) => void; opts: InviteOptions }) {
  const { data, dispatch } = useWorkspace();
  const [emails, setEmails] = React.useState('');
  const [role, setRole] = React.useState<Member['role']>('Member');
  const [team, setTeam] = React.useState('');
  const [error, setError] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const timer = React.useRef<number>(undefined);

  // Каждое открытие начинается с чистой формы
  React.useEffect(() => {
    if (!open) return;
    setEmails('');
    setRole('Member');
    setTeam(opts.team && data.teams.some(t => t.id === opts.team) ? opts.team : (data.teams[0]?.id ?? ''));
    setError('');
    setSending(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  React.useEffect(() => () => clearTimeout(timer.current), []);

  const submit = () => {
    if (sending) return;
    const list = emails
      .split(/[\s,;]+/)
      .map(s => s.trim())
      .filter(Boolean);
    const bad = list.find(e => !EMAIL_RE.test(e));
    if (!list.length) return setError('Enter at least one email address');
    if (bad) return setError(`${bad} isn't a valid email address`);
    setError('');
    setSending(true);
    // Короткая пауза на кнопке, как loadingBtn в оригинале
    timer.current = window.setTimeout(() => {
      dispatch({ type: 'member/invite', emails: list, role, team });
      onOpenChange(false);
      toast(`${list.length} invitation${list.length > 1 ? 's' : ''} sent`);
    }, 600);
  };

  const copyLink = () => {
    navigator.clipboard?.writeText(inviteLink(data.ws.url)).catch(() => {});
    toast('Invite link copied');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Invite to ${data.ws.name}`}
        description="Invited people get an email with a link to join."
        footer={
          <>
            <Button variant="ghost" onClick={copyLink}>
              <Link size={14} />
              Copy invite link
            </Button>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="primary" type="submit" form="invite-form" loading={sending}>
              Send invites
            </Button>
          </>
        }
      >
        <form
          id="invite-form"
          className="contents"
          noValidate
          onSubmit={e => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Email addresses" hint="Separate multiple addresses with commas." error={error}>
            {f => (
              <Textarea
                {...f}
                placeholder="name@company.com, another@company.com"
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
                Role
              </label>
              <select className="select" id="inv-role" value={role} onChange={e => setRole(e.target.value as Member['role'])}>
                {INVITE_ROLES.map(r => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 0 }}>
              <label className="label" htmlFor="inv-team">
                Team
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
              <b>Guests</b> can only see projects they&apos;re added to and can&apos;t create projects.
            </span>
          </div>
        </form>
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
