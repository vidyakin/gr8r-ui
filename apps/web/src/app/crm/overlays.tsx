/* Оверлеи CRM: карточки сделки и контакта, формы создания, подтверждение Won и причина Lost.
   Всё открывается через useCrmUi() из любого места модуля — как хуки в app/overlays. */
import * as React from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Button, Dialog, DialogClose, DialogContent, Textarea, toast } from '@/components/ui';
import { useWorkspace } from '../data/store';
import { useTaskDrawer } from '../overlays';
import { ContactDrawer, DealDrawer } from './drawers';
import { CompanyFormDialog, ContactFormDialog, DealFormDialog } from './forms';
import { money } from './format';
import { deal as findDeal } from './selectors';
import { LOST_REASONS, stage } from './stages';
import { useCrm } from './store';
import { CrmUiCtx, type CrmUi, type DealDefaults } from './ui-context';
import type { StageId } from './types';

type Drawer = { kind: 'deal' | 'contact'; id: string } | null;
type Dlg =
  | { kind: 'deal'; defaults: DealDefaults }
  | { kind: 'company' }
  | { kind: 'contact'; defaults: { company?: string } }
  | { kind: 'close'; id: string; stage: 'won' | 'lost'; before: string | null }
  | null;

/** Закрытие сделки: Won — подтверждение, Lost — причина проигрыша */
function CloseDealDialog({ id, to, onCancel, onConfirm }: { id: string; to: 'won' | 'lost'; onCancel: () => void; onConfirm: (reason?: string) => void }) {
  const { data } = useCrm();
  const d = findDeal(data, id);
  const [reason, setReason] = React.useState(LOST_REASONS[0]);
  const [note, setNote] = React.useState('');
  if (!d) return null;
  const won = to === 'won';
  return (
    <Dialog open onOpenChange={o => !o && onCancel()}>
      <DialogContent
        size="sm"
        title={won ? 'Mark deal as won?' : 'Why was this deal lost?'}
        description={
          <>
            <b>{d.name}</b> · {money(d.amount)}
            {won ? '. The close date is set to today and the amount counts toward revenue.' : ''}
          </>
        }
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button variant={won ? 'primary' : 'danger'} onClick={() => onConfirm(won ? undefined : note.trim() ? `${reason}: ${note.trim()}` : reason)}>
              {won ? 'Mark as won' : 'Mark as lost'}
            </Button>
          </>
        }
      >
        {!won && (
          <div className="col" style={{ gap: 12 }}>
            <div className="field">
              <label className="label" htmlFor="lost-reason">
                Reason
              </label>
              <select className="select" id="lost-reason" data-af value={reason} onChange={e => setReason(e.target.value)}>
                {LOST_REASONS.map(r => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="lost-note">
                Details (optional)
              </label>
              <Textarea id="lost-note" rows={2} placeholder="Anything the team should remember?" value={note} onChange={e => setNote(e.target.value)} />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CrmOverlays({ children }: { children: React.ReactNode }) {
  const { data: ws } = useWorkspace();
  const { data, dispatch } = useCrm();
  const taskDrawer = useTaskDrawer();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [drawer, setDrawer] = React.useState<Drawer>(null);
  const [dlg, setDlg] = React.useState<Dlg>(null);
  const latest = React.useRef({ data, me: ws.me });
  latest.current = { data, me: ws.me };

  // Открывая карточку CRM, закрываем карточку задачи: обе — боковые панели на одном месте
  const openDrawer = React.useCallback(
    (d: NonNullable<Drawer>) => {
      taskDrawer.close();
      setDrawer(d);
    },
    [taskDrawer],
  );

  // Смена страницы закрывает карточку (ссылка на компанию, переход в другой раздел)
  const first = React.useRef(true);
  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setDrawer(null);
  }, [pathname]);

  // Карточка удалённой сделки или контакта закрывается сама
  const gone = drawer && !(drawer.kind === 'deal' ? data.deals : data.contacts).some(x => x.id === drawer.id);
  React.useEffect(() => {
    if (gone) setDrawer(null);
  }, [gone]);

  const api = React.useMemo<CrmUi>(() => {
    const doMove = (id: string, to: StageId, before: string | null, lostReason?: string) => {
      const { data: d, me } = latest.current;
      const x = findDeal(d, id);
      if (!x) return;
      dispatch({ type: 'deal/move', id, stage: to, before, by: me, lostReason });
      if (x.stage !== to) toast(`Moved “${x.name}” to ${stage(to).name}`, { duration: 2200 });
    };
    return {
      openDeal: id => openDrawer({ kind: 'deal', id }),
      openContact: id => openDrawer({ kind: 'contact', id }),
      closeDrawer: () => setDrawer(null),
      newDeal: (defaults = {}) => setDlg({ kind: 'deal', defaults }),
      newCompany: () => setDlg({ kind: 'company' }),
      newContact: (defaults = {}) => setDlg({ kind: 'contact', defaults }),
      moveDeal: (id, to, before = null) => {
        const x = findDeal(latest.current.data, id);
        if (!x) return;
        if ((to === 'won' || to === 'lost') && x.stage !== to) setDlg({ kind: 'close', id, stage: to, before });
        else doMove(id, to, before);
      },
    };
  }, [dispatch, openDrawer]);

  const closeDlg = () => setDlg(null);

  return (
    <CrmUiCtx.Provider value={api}>
      {children}
      {drawer?.kind === 'deal' && <DealDrawer id={drawer.id} />}
      {drawer?.kind === 'contact' && <ContactDrawer id={drawer.id} />}
      {dlg?.kind === 'deal' && (
        <DealFormDialog
          defaults={dlg.defaults}
          onClose={closeDlg}
          onCreated={id => {
            const name = latest.current.data.deals.find(x => x.id === id)?.name;
            toast(`Created deal${name ? ` “${name}”` : ''}`, { action: { label: 'Open', onClick: () => api.openDeal(id) } });
          }}
        />
      )}
      {dlg?.kind === 'company' && (
        <CompanyFormDialog
          onClose={closeDlg}
          onCreated={id => {
            toast('Company created', { action: { label: 'Open', onClick: () => navigate(`/crm/companies/${id}`) } });
          }}
        />
      )}
      {dlg?.kind === 'contact' && (
        <ContactFormDialog
          defaults={dlg.defaults}
          onClose={closeDlg}
          onCreated={id => {
            toast('Contact created', { action: { label: 'Open', onClick: () => api.openContact(id) } });
          }}
        />
      )}
      {dlg?.kind === 'close' && (
        <CloseDealDialog
          id={dlg.id}
          to={dlg.stage}
          onCancel={closeDlg}
          onConfirm={reason => {
            const { id, stage: to, before } = dlg;
            closeDlg();
            const x = findDeal(latest.current.data, id);
            dispatch({ type: 'deal/move', id, stage: to, before, by: latest.current.me, lostReason: reason });
            if (x) toast(to === 'won' ? `Won “${x.name}” — ${money(x.amount)}` : `Marked “${x.name}” as lost`, { duration: 2600 });
          }}
        />
      )}
    </CrmUiCtx.Provider>
  );
}
