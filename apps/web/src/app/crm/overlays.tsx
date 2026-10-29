/* Оверлеи CRM: карточки сделки и контакта, формы создания, подтверждение Won и причина Lost.
   Всё открывается через useCrmUi() из любого места модуля — как хуки в app/overlays. */
import * as React from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Button, Dialog, DialogClose, DialogContent, Textarea, toast } from '@/components/ui';
import { parseNumber, useT } from '@/i18n';
import { useWorkspace } from '../data/store';
import { useTaskDrawer } from '../overlays';
import { ContactDrawer, DealDrawer } from './drawers';
import { CompanyFormDialog, ContactFormDialog, DealFormDialog } from './forms';
import { money } from './format';
import { deal as findDeal } from './selectors';
import { openStagesOf, stage, stagesOf } from './stages';
import { missingFor } from './pipelines';
import { useLeadSources } from './ad-data';
import { contactsOfCompany } from './selectors';
import { useCrm, type DealPatch } from './store';
import { CrmUiCtx, type CrmUi, type DealDefaults } from './ui-context';
import type { StageId } from './types';

type Drawer = { kind: 'deal' | 'contact'; id: string } | null;
type Dlg =
  | { kind: 'deal'; defaults: DealDefaults }
  | { kind: 'company' }
  | { kind: 'contact'; defaults: { company?: string } }
  | { kind: 'move'; id: string; stage: StageId; before: string | null }
  | null;

interface MoveResult {
  patch: DealPatch;
  lostReasonId?: string;
  note?: string;
}

/** Переход на этап, которому нужен ввод: подтверждение победы, причина проигрыша, обязательные поля этапа.
    Значения полей уходят тем же запросом, что и смена этапа (сервер проверяет поля по значениям после изменения). */
function MoveDealDialog({ id, to, onCancel, onConfirm }: { id: string; to: StageId; onCancel: () => void; onConfirm: (r: MoveResult) => void }) {
  const { data, pipes } = useCrm();
  const t = useT();
  const { data: sources } = useLeadSources();
  const d = findDeal(data, id);
  const st = stage(to);
  const missing = d ? missingFor(d, st.required) : [];
  const [reason, setReason] = React.useState(pipes.reasons[0]?.id ?? '');
  const [note, setNote] = React.useState('');
  const [vals, setVals] = React.useState<Record<string, string>>({});
  if (!d) return null;
  const won = st.category === 'won';
  const lost = st.category === 'lost';
  const companyContacts = contactsOfCompany(data, d.company);
  const set = (k: string, v: string) => setVals(x => ({ ...x, [k]: v }));
  const filled = (k: string) => (vals[k] ?? '').trim() !== '' && (k !== 'amount' || parseNumber(vals[k]!) > 0);
  const canConfirm = missing.every(filled) && (!lost || !!reason);
  const submit = () => {
    const patch: DealPatch = {};
    const custom: Record<string, unknown> = { ...d.custom };
    for (const k of missing) {
      if (k === 'amount') patch.amount = parseNumber(vals[k]!);
      else if (k === 'closeDate') patch.closeDate = vals[k]!;
      else if (k === 'contact') patch.contacts = [...new Set([...d.contacts, vals[k]!])];
      else if (k === 'source') patch.sourceId = vals[k]!;
      else if (k.startsWith('custom:')) custom[k.slice(7)] = vals[k]!.trim();
    }
    if (missing.some(k => k.startsWith('custom:'))) patch.custom = custom;
    onConfirm({ patch, ...(lost ? { lostReasonId: reason } : {}), ...(lost && note.trim() ? { note: note.trim() } : {}) });
  };
  const label = (k: string) => (k.startsWith('custom:') ? k.slice(7) : t(`crm.pipelines.required.${k}` as never));
  return (
    <Dialog open onOpenChange={o => !o && onCancel()}>
      <DialogContent
        size="sm"
        title={won ? t('crm.deals.markWonConfirm') : lost ? t('crm.deals.drawer.lostTitle') : t('crm.pipelines.moveTitle', { stage: st.name })}
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
            <Button variant={lost ? 'danger' : 'primary'} disabled={!canConfirm} onClick={submit}>
              {won ? t('crm.deals.markWonBtn') : lost ? t('crm.deals.markLostBtn') : t('crm.pipelines.moveBtn')}
            </Button>
          </>
        }
      >
        <div className="col" style={{ gap: 12 }}>
          {missing.length > 0 && <p className="muted" style={{ fontSize: 13, margin: 0 }}>{t('crm.pipelines.requiredHint', { stage: st.name })}</p>}
          {missing.map(k => (
            <div className="field" key={k}>
              <label className="label" htmlFor={`req-${k}`}>
                {label(k)}
              </label>
              {k === 'closeDate' ? (
                <input className="input" id={`req-${k}`} type="date" value={vals[k] ?? ''} onChange={e => set(k, e.target.value)} />
              ) : k === 'contact' ? (
                <select className="select" id={`req-${k}`} value={vals[k] ?? ''} onChange={e => set(k, e.target.value)}>
                  <option value="">—</option>
                  {companyContacts.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : k === 'source' ? (
                <select className="select" id={`req-${k}`} value={vals[k] ?? ''} onChange={e => set(k, e.target.value)}>
                  <option value="">—</option>
                  {(sources ?? []).filter(s => !s.archivedAt).map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="input" id={`req-${k}`} inputMode={k === 'amount' ? 'decimal' : undefined} value={vals[k] ?? ''} onChange={e => set(k, e.target.value)} />
              )}
            </div>
          ))}
          {lost && (
            <>
              <div className="field">
                <label className="label" htmlFor="lost-reason">
                  {t('crm.deals.lostReasonLabel')}
                </label>
                <select className="select" id="lost-reason" data-af value={reason} onChange={e => setReason(e.target.value)}>
                  {pipes.reasons.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor="lost-note">
                  {t('crm.deals.lostDetailsLabel')}
                </label>
                <Textarea id="lost-note" rows={2} placeholder={t('crm.deals.lostDetailsPlaceholder')} value={note} onChange={e => setNote(e.target.value)} />
              </div>
            </>
          )}
        </div>
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
    const doMove = (id: string, to: StageId, before: string | null, extra: { patch?: DealPatch; lostReasonId?: string; lostReason?: string } = {}) => {
      const { data: d, me } = latest.current;
      const x = findDeal(d, id);
      if (!x) return;
      dispatch({ type: 'deal/move', id, stage: to, before, by: me, ...extra });
      if (x.stage !== to) toast(t('crm.deals.moved', { name: x.name, stage: stage(to).name }), { duration: 2200 });
    };
    /** Нужен ли диалог: победа подтверждается, проигрыш требует причину, обязательные поля этапа — значения */
    const requestMove = (id: string, to: StageId, before: string | null) => {
      const x = findDeal(latest.current.data, id);
      if (!x) return;
      const st = stage(to);
      const changed = x.stage !== to;
      if (changed && (st.category !== 'in_progress' || missingFor(x, st.required).length > 0)) setDlg({ kind: 'move', id, stage: to, before });
      else doMove(id, to, before);
    };
    const targetOf = (id: string, target: 'won' | 'lost' | 'reopen'): StageId | null => {
      const x = findDeal(latest.current.data, id);
      if (!x) return null;
      const list = stagesOf(stage(x.stage).pipelineId);
      const open = list.filter(s => s.category === 'in_progress');
      if (target === 'won') return list.find(s => s.category === 'won')?.id ?? null;
      if (target === 'lost') return list.find(s => s.category === 'lost')?.id ?? null;
      // возврат в работу: из «выиграна» — на последний открытый этап, из «проиграна» — на первый
      return (stage(x.stage).category === 'won' ? open[open.length - 1] : open[0])?.id ?? null;
    };
    return {
      openDeal: id => openDrawer({ kind: 'deal', id }),
      openContact: id => openDrawer({ kind: 'contact', id }),
      closeDrawer: () => setDrawer(null),
      newDeal: (defaults = {}) => setDlg({ kind: 'deal', defaults }),
      newCompany: () => setDlg({ kind: 'company' }),
      newContact: (defaults = {}) => setDlg({ kind: 'contact', defaults }),
      moveDeal: (id, to, before = null) => requestMove(id, to, before),
      moveDealTo: (id, target) => {
        const to = targetOf(id, target);
        if (to) requestMove(id, to, null);
      },
      movePipeline: (id, pipelineId) => {
        const first = openStagesOf(pipelineId)[0];
        if (first) requestMove(id, first.id, null);
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
      {dlg?.kind === 'move' && (
        <MoveDealDialog
          id={dlg.id}
          to={dlg.stage}
          onCancel={closeDlg}
          onConfirm={r => {
            const { id, stage: to, before } = dlg;
            closeDlg();
            const x = findDeal(latest.current.data, id);
            const cat = stage(to).category;
            dispatch({ type: 'deal/move', id, stage: to, before, by: latest.current.me, patch: r.patch, ...(r.lostReasonId ? { lostReasonId: r.lostReasonId } : {}), ...(r.note ? { lostReason: r.note } : {}) });
            if (x) toast(cat === 'won' ? t('crm.deals.wonToast', { name: x.name, amount: money(x.amount) }) : cat === 'lost' ? t('crm.deals.lostToast', { name: x.name }) : t('crm.deals.moved', { name: x.name, stage: stage(to).name }), { duration: 2600 });
          }}
        />
      )}
    </CrmUiCtx.Provider>
  );
}
