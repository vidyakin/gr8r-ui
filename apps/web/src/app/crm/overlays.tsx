/* Оверлеи CRM: карточки сделки и контакта, формы создания, подтверждение Won и причина Lost.
   Всё открывается через useCrmUi() из любого места модуля — как хуки в app/overlays. */
import * as React from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Button, Dialog, DialogClose, DialogContent, Textarea, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { useWorkspace } from '../data/store';
import { useTaskDrawer } from '../overlays';
import { ContactDrawer, DealDrawer } from './drawers';
import { CompanyFormDialog, ContactFormDialog, DealFormDialog } from './forms';
import { money } from './format';
import { deal as findDeal } from './selectors';
import { LOST_REASONS, stage } from './stages';
import { lostReasonName, stageName } from './labels';
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
  const t = useT();
  const d = findDeal(data, id);
  const [reason, setReason] = React.useState(LOST_REASONS[0]);
  const [note, setNote] = React.useState('');
  if (!d) return null;
  const won = to === 'won';
  return (
    <Dialog open onOpenChange={o => !o && onCancel()}>
      <DialogContent
        size="sm"
        title={won ? t('crm.deals.markWonConfirm') : t('crm.deals.drawer.lostTitle')}
        description={
          <>
            <b>{d.name}</b> · {money(d.amount)}
            {won ? '. ' + t('crm.deals.drawer.markWonDesc') : ''}
          </>
        }
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="ghost">{t('crm.common.cancel')}</Button>
            </DialogClose>
            <Button variant={won ? 'primary' : 'danger'} onClick={() => onConfirm(won ? undefined : note.trim() ? `${reason}: ${note.trim()}` : reason)}>
              {won ? t('crm.deals.markWonBtn') : t('crm.deals.markLostBtn')}
            </Button>
          </>
        }
      >
        {!won && (
          <div className="col" style={{ gap: 12 }}>
            <div className="field">
              <label className="label" htmlFor="lost-reason">
                {t('crm.deals.lostReasonLabel')}
              </label>
              <select className="select" id="lost-reason" data-af value={reason} onChange={e => setReason(e.target.value)}>
                {LOST_REASONS.map(r => (
                  <option key={r}>{lostReasonName(r, r)}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="lost-note">
                {t('crm.deals.lostDetailsLabel')}
              </label>
              <Textarea id="lost-note" rows={2} placeholder={t('crm.deals.lostDetailsPlaceholder')} value={note} onChange={e => setNote(e.target.value)} />
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
  const t = useT();
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
      if (x.stage !== to) toast(t('crm.deals.moved', { name: x.name, stage: stageName(to, stage(to).name) }), { duration: 2200 });
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
  }, [dispatch, openDrawer, t]);

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
            toast(t('crm.deals.createdToast', { name: name ?? '' }), { action: { label: t('crm.common.open'), onClick: () => api.openDeal(id) } });
          }}
        />
      )}
      {dlg?.kind === 'company' && (
        <CompanyFormDialog
          onClose={closeDlg}
          onCreated={id => {
            toast(t('crm.companies.openCompanyToast'), { action: { label: t('crm.common.add'), onClick: () => navigate(`/crm/companies/${id}`) } });
          }}
        />
      )}
      {dlg?.kind === 'contact' && (
        <ContactFormDialog
          defaults={dlg.defaults}
          onClose={closeDlg}
          onCreated={id => {
            toast(t('crm.contacts.createdToast'), { action: { label: t('crm.common.open'), onClick: () => api.openContact(id) } });
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
            if (x) toast(to === 'won' ? t('crm.deals.wonToast', { name: x.name, amount: money(x.amount) }) : t('crm.deals.lostToast', { name: x.name }), { duration: 2600 });
          }}
        />
      )}
    </CrmUiCtx.Provider>
  );
}
