/* Settings → Оператор → Тарифы и модули (docs/architecture/licensing.md): справочник тарифов и лицензия арендатора
   (тариф, срок, докупленные модули со сроками). Только для оператора установки, API проверяет флаг сам. */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers } from 'lucide-react';
import { MODULES, MODULE_IDS, resolveModules, type LicenseLogEntry, type LicenseRaw, type ModuleId } from '@gr8r/shared';
import { fmtDateTime, fmtDateTimeIntl, fmtNumber } from '@/i18n/format';
import { Alert, Badge, Button, Checkbox, ConfirmDialog, Dialog, DialogContent, EmptyState, Field, Input, Select, Skeleton, Textarea, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';
import { SettingsHead, SRow } from './parts';

export interface PlanRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  modules: string[];
  all_modules: boolean;
  trial_days: number | null;
  is_default: boolean;
  sort_order: number;
  tenants: number;
}

export const plansKey = ['admin', 'plans'] as const;

export function usePlans() {
  const ws = useWsId();
  return useQuery({ queryKey: plansKey, queryFn: () => call<{ items: PlanRow[] }>(ws, 'GET', '/admin/plans') });
}

/** Название модуля и его зависимостей, которых нет в списке (для подсказки «также нужны») */
function useModuleName() {
  const t = useT();
  return (id: ModuleId) => t(`licensing.modules.${id}.name` as const);
}

function ModuleChecks({ value, onChange }: { value: ModuleId[]; onChange: (v: ModuleId[]) => void }) {
  const t = useT();
  const name = useModuleName();
  return (
    <div className="stack" style={{ gap: 6 }}>
      {MODULES.filter(m => m.id !== 'core').map(m => {
        const missing = m.requires.filter(r => r !== 'core' && !value.includes(r));
        return (
          <label key={m.id} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
            <Checkbox checked={value.includes(m.id)} onChange={e => onChange(e.target.checked ? [...value, m.id] : value.filter(x => x !== m.id))} />
            <span>
              {name(m.id)} <span className="muted">{t(`licensing.modules.${m.id}.description` as const)}</span>
              {value.includes(m.id) && missing.length > 0 && <span className="muted"> ({t('licensing.operator.requires', { modules: missing.map(name).join(', ') })})</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function PlanDialog({ plan, onClose }: { plan: PlanRow | 'new' | null; onClose: () => void }) {
  const t = useT();
  const ws = useWsId();
  const qc = useQueryClient();
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [modules, setModules] = React.useState<ModuleId[]>([]);
  const [all, setAll] = React.useState(false);
  const [trial, setTrial] = React.useState('');
  const [isDefault, setIsDefault] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    const p = plan && plan !== 'new' ? plan : null;
    setName(p?.name ?? '');
    setDescription(p?.description ?? '');
    setModules((p?.modules ?? []).filter((m): m is ModuleId => (MODULE_IDS as readonly string[]).includes(m)));
    setAll(p?.all_modules ?? false);
    setTrial(p?.trial_days ? String(p.trial_days) : '');
    setIsDefault(p?.is_default ?? false);
  }, [plan]);

  const save = async () => {
    setBusy(true);
    try {
      const body = { name, description: description || null, modules, allModules: all, trialDays: trial ? Number(trial) : null, isDefault };
      if (plan === 'new') await call(ws, 'POST', '/admin/plans', body);
      else if (plan) await call(ws, 'PUT', `/admin/plans/${plan.id}`, body);
      toast(t('licensing.operator.saved'));
      void qc.invalidateQueries({ queryKey: plansKey });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!plan} onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={plan === 'new' ? t('licensing.operator.newPlan') : t('licensing.operator.editPlan')}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>{t('licensing.operator.cancel')}</Button>
            <Button disabled={busy || !name.trim()} onClick={save}>{t('licensing.operator.save')}</Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <Field label={t('licensing.operator.name')}>{p => <Input {...p} maxLength={100} value={name} onChange={e => setName(e.target.value)} />}</Field>
          <Field label={t('licensing.operator.description')}>{p => <Textarea {...p} maxLength={1000} rows={2} value={description} onChange={e => setDescription(e.target.value)} />}</Field>
          <label className="row" style={{ gap: 8 }}>
            <Checkbox checked={all} onChange={e => setAll(e.target.checked)} />
            {t('licensing.operator.allModules')}
          </label>
          {!all && (
            <Field label={t('licensing.operator.modules')}>{() => <ModuleChecks value={modules} onChange={setModules} />}</Field>
          )}
          <Field label={t('licensing.operator.trialDays')}>{p => <Input {...p} inputMode="numeric" style={{ width: 120 }} value={trial} onChange={e => setTrial(e.target.value.replace(/\D/g, ''))} />}</Field>
          <label className="row" style={{ gap: 8 }}>
            <Checkbox checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
            {t('licensing.operator.isDefault')}
          </label>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PlansSection({ title }: { title: string }) {
  const t = useT();
  const ws = useWsId();
  const qc = useQueryClient();
  const name = useModuleName();
  const list = usePlans();
  const [edit, setEdit] = React.useState<PlanRow | 'new' | null>(null);
  const [del, setDel] = React.useState<PlanRow | null>(null);
  const items = list.data?.items ?? [];
  return (
    <>
      <SettingsHead title={title} lead={t('licensing.operator.lead')} />
      <div className="sblock">
        <Button size="sm" onClick={() => setEdit('new')}>{t('licensing.operator.newPlan')}</Button>
      </div>
      <div className="sblock">
        {list.isPending ? (
          <Skeleton w="100%" h={60} />
        ) : list.isError ? (
          <Alert tone="danger">{errorMessage(list.error)}</Alert>
        ) : !items.length ? (
          <EmptyState icon={<Layers size={20} />} title={t('licensing.operator.empty')} />
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {items.map(p => (
              <SRow
                key={p.id}
                t={
                  <>
                    {p.name} {p.is_default && <Badge tone="violet">{t('licensing.operator.defaultBadge')}</Badge>}
                  </>
                }
                d={[p.all_modules ? t('licensing.operator.allModules') : ['core', ...p.modules].map(m => name(m as ModuleId)).join(', '), t('licensing.operator.tenants', { n: p.tenants })].join(' · ')}
              >
                <Button size="sm" variant="ghost" onClick={() => setEdit(p)}>{t('licensing.operator.editPlan')}</Button>
                <Button size="sm" variant="ghost" onClick={() => setDel(p)}>{t('licensing.operator.delete')}</Button>
              </SRow>
            ))}
          </div>
        )}
      </div>
      <PlanDialog plan={edit} onClose={() => setEdit(null)} />
      <ConfirmDialog
        open={!!del}
        onOpenChange={o => !o && setDel(null)}
        title={t('licensing.operator.delete')}
        description={del ? t('licensing.operator.confirmDelete', { name: del.name }) : ''}
        confirmLabel={t('licensing.operator.delete')}
        cancelLabel={t('licensing.operator.cancel')}
        danger
        onConfirm={async () => {
          if (del) {
            try {
              await call(ws, 'DELETE', `/admin/plans/${del.id}`);
              void qc.invalidateQueries({ queryKey: plansKey });
            } catch (e) {
              toast.error(errorMessage(e));
            }
          }
          setDel(null);
        }}
      />
    </>
  );
}

/* ---------------- лицензия арендатора ---------------- */

type TenantLicense = LicenseRaw & { assigned: boolean };
const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
const fromDateInput = (d: string) => (d ? new Date(`${d}T23:59:59`).toISOString() : null);

/** Журнал изменений лицензии арендатора (задача 1209): одна строка на изменение, старое → новое */
export function LicenseLog({ tenantId }: { tenantId: string }) {
  const t = useT();
  const ws = useWsId();
  const name = useModuleName();
  const log = useQuery({ queryKey: ['admin', 'license-log', tenantId], queryFn: () => call<{ items: LicenseLogEntry[] }>(ws, 'GET', `/admin/tenants/${tenantId}/license-log`) });
  const date = (v: unknown) => (typeof v === 'string' ? fmtDateTimeIntl(v, { dateStyle: 'medium' }) : t('licensing.log.never'));
  const show = (e: LicenseLogEntry, v: unknown): string => {
    if (e.kind === 'plan_expires' || e.kind === 'grant_expires') return date(v);
    if (e.kind === 'grant_added' || e.kind === 'grant_removed' || e.kind === 'trial_started') return date((v as { expiresAt?: unknown } | null)?.expiresAt ?? v);
    if (v === null || v === undefined) return t('licensing.log.none');
    if (typeof v === 'boolean') return v ? t('licensing.log.yes') : t('licensing.log.no');
    if (Array.isArray(v)) return v.length ? v.join(', ') : t('licensing.log.none');
    if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${String(x)}`).join(', ') || t('licensing.log.none');
    return typeof v === 'number' ? fmtNumber(v) : String(v);
  };
  const text = (e: LicenseLogEntry) => {
    const isModule = e.kind.startsWith('grant');
    const subject = isModule && (MODULE_IDS as readonly string[]).includes(e.subject ?? '') ? name(e.subject as ModuleId) : e.kind === 'plan_edit' ? t(`licensing.log.fields.${e.subject}` as 'licensing.log.fields.modules') : (e.subject ?? '');
    return t(`licensing.log.${e.kind}` as 'licensing.log.plan', { subject, context: e.context ?? '', old: show(e, e.old), new: show(e, e.new) });
  };
  return (
    <div>
      <div className="t">{t('licensing.log.title')}</div>
      {log.isPending ? (
        <Skeleton w="100%" h={40} />
      ) : log.isError ? (
        <Alert tone="danger">{errorMessage(log.error)}</Alert>
      ) : !log.data.items.length ? (
        <div className="muted">{t('licensing.log.empty')}</div>
      ) : (
        <div className="stack" style={{ gap: 4, maxHeight: 220, overflowY: 'auto' }}>
          {log.data.items.map(e => (
            <div key={e.id}>
              <span className="muted">
                {fmtDateTime(e.at)} · {e.actorEmail ?? t('licensing.log.system')}
              </span>{' '}
              {text(e)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TenantLicenseDialog({ tenant, onClose }: { tenant: { id: string; name: string } | null; onClose: () => void }) {
  const t = useT();
  const ws = useWsId();
  const qc = useQueryClient();
  const name = useModuleName();
  const plans = usePlans();
  const lic = useQuery({
    queryKey: ['admin', 'license', tenant?.id],
    enabled: !!tenant,
    queryFn: () => call<TenantLicense>(ws, 'GET', `/admin/tenants/${tenant!.id}/license`),
  });
  const [planId, setPlanId] = React.useState('');
  const [planExpires, setPlanExpires] = React.useState('');
  const [isTrial, setIsTrial] = React.useState(false);
  const [grants, setGrants] = React.useState<{ module: ModuleId; expiresAt: string }[]>([]);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    const l = lic.data;
    if (!l) return;
    setPlanId(l.planId ?? '');
    setPlanExpires(toDateInput(l.planExpiresAt));
    setIsTrial(l.isTrial ?? false);
    setGrants(l.grants.filter((g): g is { module: ModuleId; expiresAt: string | null } => (MODULE_IDS as readonly string[]).includes(g.module)).map(g => ({ module: g.module, expiresAt: toDateInput(g.expiresAt) })));
  }, [lic.data]);

  const plan = plans.data?.items.find(p => p.id === planId);
  // что будет включено после сохранения: ядро + тариф + доп. модули и их зависимости
  const effective = resolveModules([...(plan?.all_modules ? ['*'] : (plan?.modules ?? [])), ...grants.map(g => g.module)]);
  const setGrant = (module: ModuleId, on: boolean) => setGrants(g => (on ? [...g, { module, expiresAt: '' }] : g.filter(x => x.module !== module)));

  const save = async () => {
    if (!tenant || !planId) return;
    setBusy(true);
    try {
      await call(ws, 'PUT', `/admin/tenants/${tenant.id}/license`, {
        planId,
        planExpiresAt: fromDateInput(planExpires),
        isTrial,
        grants: grants.map(g => ({ module: g.module, expiresAt: fromDateInput(g.expiresAt) })),
      });
      toast(t('licensing.operator.saved'));
      void qc.invalidateQueries({ queryKey: ['admin'] });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!tenant} onOpenChange={o => !o && onClose()}>
      <DialogContent
        size="lg"
        title={t('licensing.operator.licenseTitle', { name: tenant?.name ?? '' })}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>{t('licensing.operator.cancel')}</Button>
            <Button disabled={busy || !planId} onClick={save}>{t('licensing.operator.save')}</Button>
          </>
        }
      >
        {lic.isPending ? (
          <Skeleton w="100%" h={80} />
        ) : lic.isError ? (
          <Alert tone="danger">{errorMessage(lic.error)}</Alert>
        ) : (
          <div className="stack" style={{ gap: 14 }}>
            {!lic.data?.assigned && <Alert tone="info">{t('licensing.operator.unassigned')}</Alert>}
            <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Field label={t('licensing.operator.plan')}>
                {p => <Select {...p} value={planId} onValueChange={setPlanId} options={(plans.data?.items ?? []).map(x => ({ value: x.id, label: x.name }))} />}
              </Field>
              <Field label={t('licensing.operator.planExpires')} hint={t('licensing.operator.noExpiry')}>
                {p => <Input {...p} type="date" value={planExpires} onChange={e => setPlanExpires(e.target.value)} />}
              </Field>
              <label className="row" style={{ gap: 6, paddingBottom: 8 }}>
                <Checkbox checked={isTrial} onChange={e => setIsTrial(e.target.checked)} />
                {t('licensing.operator.isTrial')}
              </label>
            </div>
            <div>
              <div className="t">{t('licensing.operator.addons')}</div>
              <div className="muted" style={{ marginBottom: 6 }}>{t('licensing.operator.addonsHint')}</div>
              <div className="stack" style={{ gap: 6 }}>
                {MODULES.filter(m => m.id !== 'core').map(m => {
                  const g = grants.find(x => x.module === m.id);
                  return (
                    <div key={m.id} className="row" style={{ gap: 10, alignItems: 'center' }}>
                      <label className="row" style={{ gap: 8, minWidth: 180 }}>
                        <Checkbox checked={!!g} onChange={e => setGrant(m.id, e.target.checked)} />
                        {name(m.id)}
                      </label>
                      {g && (
                        <label className="row muted" style={{ gap: 6 }}>
                          {t('licensing.operator.addonExpires')}
                          <Input type="date" size="sm" value={g.expiresAt} aria-label={t('licensing.operator.addonExpires')} onChange={e => setGrants(list => list.map(x => (x.module === m.id ? { ...x, expiresAt: e.target.value } : x)))} />
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="muted">
              {t('licensing.operator.effective')}: {MODULE_IDS.filter(id => effective.has(id)).map(name).join(', ')}
            </div>
            {tenant && <LicenseLog tenantId={tenant.id} />}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
