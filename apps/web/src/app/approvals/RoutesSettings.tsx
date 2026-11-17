/* Settings → Approval routes (задача 1199, docs/architecture/approvals.md): список маршрутов и редактор «условия → этапы → согласующие».
   Правят admin и owner; маршрут не удаляется, а уходит в архив (идущие процессы хранят снимок). */
import * as React from 'react';
import { ArrowDown, ArrowUp, Plus, Stamp, Trash2 } from 'lucide-react';
import { APPROVAL_STEP_MODES, APPROVAL_TARGET_KINDS, type ApprovalStepMode, type ApprovalTargetKind } from '@erp/shared';
import { Alert, Badge, Button, Checkbox, ConfirmDialog, EmptyState, Field, IconButton, Input, Select, Skeleton, Tab, Tabs, TabsList, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { useIsAdmin } from '../catalog/data';
import { useWorkspace } from '../data/store';
import { typeLabel, useOrganizations } from '../docs/data';
import { usePositions } from '../positions/data';
import { SettingsHead, SRow } from '../settings/parts';
import { useApprovalRoutes, useApprovalsApi, type ApprovalRoute } from './data';

/** Типы учётных документов, к которым привязывают маршруты */
export const ROUTE_DOC_TYPES = ['quote', 'customer_order', 'invoice', 'realization', 'act', 'customer_return', 'supplier_order', 'receipt', 'supplier_return', 'payment_request'] as const;

interface ParticipantDraft {
  key: string;
  kind: 'member' | 'position';
  id: string;
}
interface StepDraft {
  key: string;
  name: string;
  mode: ApprovalStepMode;
  dueHours: string;
  participants: ParticipantDraft[];
}
export interface RouteDraft {
  name: string;
  targetKind: ApprovalTargetKind;
  documentType: string;
  organizationId: string;
  amountFrom: string;
  amountTo: string;
  required: boolean;
  sortOrder: string;
  steps: StepDraft[];
}

let seq = 0;
const key = () => `k${++seq}`;
const blankStep = (): StepDraft => ({ key: key(), name: '', mode: 'sequential', dueHours: '', participants: [] });
export const blankRoute = (): RouteDraft => ({ name: '', targetKind: 'document', documentType: '', organizationId: '', amountFrom: '', amountTo: '', required: true, sortOrder: '0', steps: [blankStep()] });
export const fromRoute = (r: ApprovalRoute): RouteDraft => ({
  name: r.name,
  targetKind: r.targetKind,
  documentType: r.documentType ?? '',
  organizationId: r.organizationId ?? '',
  amountFrom: r.amountFrom ?? '',
  amountTo: r.amountTo ?? '',
  required: r.required,
  sortOrder: String(r.sortOrder),
  steps: r.steps.map(s => ({
    key: key(),
    name: s.name,
    mode: s.mode,
    dueHours: s.dueHours ? String(s.dueHours) : '',
    participants: s.participants.map(p => ({ key: key(), kind: p.memberId ? ('member' as const) : ('position' as const), id: (p.memberId ?? p.positionId)! })),
  })),
});

/** Тело POST/PATCH: пустые условия — null (сбрасывают условие при правке) */
export function routeBody(d: RouteDraft) {
  const isDoc = d.targetKind === 'document';
  const money = (v: string) => (isDoc && v.trim() ? v.trim().replace(',', '.') : null);
  return {
    name: d.name.trim(),
    targetKind: d.targetKind,
    documentType: isDoc && d.documentType ? d.documentType : null,
    organizationId: d.organizationId || null,
    amountFrom: money(d.amountFrom),
    amountTo: money(d.amountTo),
    required: d.required,
    sortOrder: Math.max(0, Math.floor(Number(d.sortOrder) || 0)),
    steps: d.steps.map(s => ({
      name: s.name.trim(),
      mode: s.mode,
      dueHours: s.dueHours.trim() ? Math.max(1, Math.floor(Number(s.dueHours) || 1)) : null,
      participants: s.participants.filter(p => p.id).map(p => (p.kind === 'member' ? { memberId: p.id } : { positionId: p.id })),
    })),
  };
}

/** Маршрут можно сохранить: есть название и в каждом этапе хотя бы один согласующий */
export const routeValid = (d: RouteDraft): boolean => !!d.name.trim() && d.steps.length > 0 && d.steps.every(s => s.participants.some(p => p.id));

const move = <T,>(list: T[], i: number, to: number): T[] => {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [x] = next.splice(i, 1);
  next.splice(to, 0, x!);
  return next;
};

function RouteForm({ draft, onChange, disabled }: { draft: RouteDraft; onChange: (d: RouteDraft) => void; disabled: boolean }) {
  const t = useT();
  const orgs = useOrganizations().data ?? [];
  const members = useWorkspace().data.members;
  const positions = usePositions().data ?? [];
  const isDoc = draft.targetKind === 'document';
  const setStep = (i: number, patch: Partial<StepDraft>) => onChange({ ...draft, steps: draft.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label={t('approvals.settings.name')}>{p => <Input {...p} disabled={disabled} maxLength={200} value={draft.name} onChange={e => onChange({ ...draft, name: e.target.value })} />}</Field>
        <Field label={t('approvals.settings.target')}>
          {p => (
            <Select
              id={p.id}
              disabled={disabled}
              value={draft.targetKind}
              onValueChange={v => onChange({ ...draft, targetKind: v as ApprovalTargetKind })}
              options={APPROVAL_TARGET_KINDS.map(k => ({ value: k, label: t(`approvals.objectKind.${k}`) }))}
              aria-label={t('approvals.settings.target')}
            />
          )}
        </Field>
        {isDoc && (
          <Field label={t('approvals.settings.docType')}>
            {p => <Select id={p.id} disabled={disabled} value={draft.documentType} onValueChange={v => onChange({ ...draft, documentType: v })} options={[{ value: '', label: t('approvals.settings.anyType') }, ...ROUTE_DOC_TYPES.map(k => ({ value: k, label: typeLabel(k) }))]} aria-label={t('approvals.settings.docType')} />}
          </Field>
        )}
        <Field label={t('approvals.settings.organization')}>
          {p => <Select id={p.id} disabled={disabled} value={draft.organizationId} onValueChange={v => onChange({ ...draft, organizationId: v })} options={[{ value: '', label: t('approvals.settings.anyOrg') }, ...orgs.map(o => ({ value: o.id, label: o.name }))]} aria-label={t('approvals.settings.organization')} />}
        </Field>
      </div>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {isDoc && (
          <>
            <Field label={t('approvals.settings.amountFrom')}>{p => <Input {...p} inputMode="decimal" disabled={disabled} value={draft.amountFrom} onChange={e => onChange({ ...draft, amountFrom: e.target.value })} />}</Field>
            <Field label={t('approvals.settings.amountTo')}>{p => <Input {...p} inputMode="decimal" disabled={disabled} value={draft.amountTo} onChange={e => onChange({ ...draft, amountTo: e.target.value })} />}</Field>
          </>
        )}
        <Field label={t('approvals.settings.sortOrder')}>{p => <Input {...p} inputMode="numeric" disabled={disabled} value={draft.sortOrder} onChange={e => onChange({ ...draft, sortOrder: e.target.value.replace(/\D/g, '') })} />}</Field>
        <label className="row" style={{ gap: 6, fontSize: 13 }}>
          <Checkbox checked={draft.required} disabled={disabled} onChange={() => onChange({ ...draft, required: !draft.required })} aria-label={t('approvals.settings.required')} />
          {t('approvals.settings.required')}
        </label>
      </div>
      <p className="faint" style={{ fontSize: 12, margin: 0 }}>
        {isDoc ? `${t('approvals.settings.amountHint')} ` : ''}
        {t('approvals.settings.requiredHint')}
      </p>

      <div className="stack" style={{ gap: 10 }}>
        <b style={{ fontSize: 13 }}>{t('approvals.settings.steps')}</b>
        {draft.steps.map((s, i) => (
          <div key={s.key} className="panel" style={{ padding: 10 }} role="group" aria-label={`${t('approvals.settings.steps')} ${i + 1}`}>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <span className="faint num" style={{ paddingBottom: 8 }}>{i + 1}</span>
              <Field label={t('approvals.settings.stepName')}>{p => <Input {...p} disabled={disabled} maxLength={120} placeholder={t('approvals.settings.stepNamePlaceholder')} value={s.name} onChange={e => setStep(i, { name: e.target.value })} />}</Field>
              <Field label={t('approvals.settings.mode')}>
                {p => <Select id={p.id} disabled={disabled} value={s.mode} onValueChange={v => setStep(i, { mode: v as ApprovalStepMode })} options={APPROVAL_STEP_MODES.map(m => ({ value: m, label: t(`approvals.stepMode.${m}`) }))} aria-label={t('approvals.settings.mode')} />}
              </Field>
              <Field label={t('approvals.settings.dueHours')}>{p => <Input {...p} inputMode="numeric" disabled={disabled} placeholder={t('approvals.settings.dueHoursHint')} value={s.dueHours} onChange={e => setStep(i, { dueHours: e.target.value.replace(/\D/g, '') })} />}</Field>
              {!disabled && (
                <span className="row" style={{ gap: 2, paddingBottom: 4 }}>
                  <IconButton size="xs" label={t('approvals.settings.moveUp')} disabled={i === 0} onClick={() => onChange({ ...draft, steps: move(draft.steps, i, i - 1) })}><ArrowUp size={13} /></IconButton>
                  <IconButton size="xs" label={t('approvals.settings.moveDown')} disabled={i === draft.steps.length - 1} onClick={() => onChange({ ...draft, steps: move(draft.steps, i, i + 1) })}><ArrowDown size={13} /></IconButton>
                  {draft.steps.length > 1 && (
                    <IconButton size="xs" label={t('approvals.settings.removeStep')} onClick={() => onChange({ ...draft, steps: draft.steps.filter((_, j) => j !== i) })}><Trash2 size={13} /></IconButton>
                  )}
                </span>
              )}
            </div>
            <div className="stack" style={{ gap: 6, marginTop: 8 }}>
              <span className="label">{t('approvals.settings.participants')}</span>
              {s.participants.map((p, j) => (
                <div key={p.key} className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <Badge tone={p.kind === 'position' ? 'violet' : 'gray'}>{p.kind === 'position' ? t('approvals.settings.positionBadge') : t('approvals.settings.addMember')}</Badge>
                  <Select
                    disabled={disabled}
                    value={p.id}
                    onValueChange={v => setStep(i, { participants: s.participants.map((x, k) => (k === j ? { ...x, id: v } : x)) })}
                    placeholder={p.kind === 'position' ? t('approvals.settings.pickPosition') : t('approvals.settings.pickMember')}
                    options={p.kind === 'position' ? positions.map(x => ({ value: x.id, label: x.name })) : members.map(m => ({ value: m.id, label: m.name }))}
                    aria-label={p.kind === 'position' ? t('approvals.settings.pickPosition') : t('approvals.settings.pickMember')}
                  />
                  {!disabled && (
                    <IconButton size="xs" label={t('approvals.settings.removeParticipant')} onClick={() => setStep(i, { participants: s.participants.filter((_, k) => k !== j) })}><Trash2 size={13} /></IconButton>
                  )}
                </div>
              ))}
              {!disabled && (
                <div className="row" style={{ gap: 6 }}>
                  <Button size="sm" variant="ghost" onClick={() => setStep(i, { participants: [...s.participants, { key: key(), kind: 'member', id: '' }] })}><Plus size={13} />{t('approvals.settings.addMember')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setStep(i, { participants: [...s.participants, { key: key(), kind: 'position', id: '' }] })}><Plus size={13} />{t('approvals.settings.addPosition')}</Button>
                </div>
              )}
            </div>
          </div>
        ))}
        {!disabled && (
          <div>
            <Button size="sm" variant="ghost" onClick={() => onChange({ ...draft, steps: [...draft.steps, blankStep()] })}><Plus size={13} />{t('approvals.settings.addStep')}</Button>
          </div>
        )}
        {!routeValid(draft) && draft.name.trim() && <p className="faint" style={{ fontSize: 12, margin: 0 }}>{t('approvals.settings.needSteps')}</p>}
      </div>
    </div>
  );
}

export function ApprovalRoutesSection({ title }: { title: string }) {
  const t = useT();
  const isAdmin = useIsAdmin();
  const api = useApprovalsApi();
  const orgs = useOrganizations().data ?? [];
  const [archived, setArchived] = React.useState(false);
  const routes = useApprovalRoutes(archived);
  const [open, setOpen] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState<RouteDraft>(blankRoute());
  const [del, setDel] = React.useState<ApprovalRoute | null>(null);

  const summary = (r: ApprovalRoute) => {
    const cond = [
      r.targetKind === 'contract' ? t('approvals.objectKind.contract') : r.documentType ? typeLabel(r.documentType) : '',
      r.organizationId ? (orgs.find(o => o.id === r.organizationId)?.name ?? '') : '',
      r.amountFrom ? `≥ ${r.amountFrom}` : '',
      r.amountTo ? `≤ ${r.amountTo}` : '',
    ].filter(Boolean);
    return t('approvals.settings.summary', { steps: t('approvals.settings.stepsCount', { count: r.steps.length }), conditions: cond.length ? cond.join(', ') : t('approvals.settings.anyConditions') });
  };
  const save = async (id: string | null) => {
    const r = await api(id ? 'PATCH' : 'POST', id ? `/approval-routes/${id}` : '/approval-routes', routeBody(draft));
    if (r) {
      toast(t('approvals.settings.saved'));
      setAdding(false);
      setOpen(null);
    }
  };

  return (
    <>
      <SettingsHead title={title} lead={t('approvals.settings.lead')} />
      {!isAdmin && <Alert tone="info" className="mb-3">{t('approvals.settings.onlyAdmins')}</Alert>}
      <div className="sblock">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <Tabs value={archived ? 'archived' : 'active'} onValueChange={v => { setArchived(v === 'archived'); setOpen(null); setAdding(false); }}>
            <TabsList aria-label={title}>
              <Tab value="active">{t('approvals.settings.active')}</Tab>
              <Tab value="archived">{t('approvals.settings.archived')}</Tab>
            </TabsList>
          </Tabs>
          {isAdmin && !archived && (
            <Button size="sm" variant="ghost" onClick={() => { setAdding(true); setOpen(null); setDraft(blankRoute()); }}>
              <Plus size={13} />
              {t('approvals.settings.add')}
            </Button>
          )}
        </div>
        {routes.isPending ? (
          <Skeleton w="100%" h={60} />
        ) : !(routes.data ?? []).length && !adding ? (
          <EmptyState icon={<Stamp size={20} />} title={archived ? t('approvals.settings.emptyArchive') : t('approvals.settings.empty')}>{archived ? '' : t('approvals.settings.emptyHint')}</EmptyState>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {adding && (
              <div className="srow" style={{ display: 'block' }}>
                <RouteForm draft={draft} onChange={setDraft} disabled={false} />
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <Button size="sm" disabled={!routeValid(draft)} onClick={() => void save(null)}>{t('approvals.settings.save')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>{t('approvals.settings.cancel')}</Button>
                </div>
              </div>
            )}
            {(routes.data ?? []).map(r => (
              <div key={r.id} className="srow" style={{ display: 'block' }}>
                <SRow t={<>{r.name} {r.required && <Badge tone="amber">{t('approvals.settings.required')}</Badge>}</>} d={summary(r)}>
                  <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setOpen(open === r.id ? null : r.id); setDraft(fromRoute(r)); }}>
                    {open === r.id ? t('approvals.settings.cancel') : t('approvals.settings.edit')}
                  </Button>
                  {isAdmin && archived && (
                    <Button size="sm" variant="ghost" onClick={async () => { if (await api('POST', `/approval-routes/${r.id}/restore`)) toast(t('approvals.settings.restoredToast')); }}>{t('approvals.settings.restore')}</Button>
                  )}
                </SRow>
                {open === r.id && (
                  <div style={{ marginTop: 8 }}>
                    <RouteForm draft={draft} onChange={setDraft} disabled={!isAdmin || archived} />
                    {isAdmin && !archived && (
                      <div className="row" style={{ gap: 8, marginTop: 8 }}>
                        <Button size="sm" disabled={!routeValid(draft)} onClick={() => void save(r.id)}>{t('approvals.settings.save')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => setDel(r)}>{t('approvals.settings.archive')}</Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={!!del}
        onOpenChange={o => !o && setDel(null)}
        title={t('approvals.settings.archive')}
        description={del ? t('approvals.settings.archiveConfirm', { name: del.name }) : ''}
        confirmLabel={t('approvals.settings.archive')}
        cancelLabel={t('approvals.settings.cancel')}
        danger
        onConfirm={async () => {
          if (del && (await api('DELETE', `/approval-routes/${del.id}`))) {
            toast(t('approvals.settings.archivedToast'));
            setOpen(null);
          }
          setDel(null);
        }}
      />
    </>
  );
}
