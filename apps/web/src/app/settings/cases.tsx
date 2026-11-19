/* Настройки → Обращения (docs/architecture/cases.md): сроки SLA по приоритетам, формы обращений на сайте (вебхук), подсказка про приём из почты.
   Правят admin и owner. */
import * as React from 'react';
import { Copy, Globe, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { CASE_PRIORITIES, DEFAULT_CASE_SLA, type CasePriority, type CaseSlaRules } from '@erp/shared';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, Field, Input, Select, Skeleton, Switch, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { NumberField } from '@/components/erp/number-field';
import { useIsAdmin } from '../catalog/data';
import { caseWebhookUrl, useCaseForms, useCaseSlaRules, useCasesApi, type CaseForm } from '../cases/data';
import { useWorkspace } from '../data/store';
import { useMembersWith } from '../positions/data';
import { SettingsHead, SRow } from './parts';

function SlaRules({ isAdmin }: { isAdmin: boolean }) {
  const t = useT();
  const api = useCasesApi();
  const rules = useCaseSlaRules();
  const [draft, setDraft] = React.useState<CaseSlaRules | null>(null);
  const cur = draft ?? rules.data ?? DEFAULT_CASE_SLA;
  const set = (p: CasePriority, k: 'firstResponseHours' | 'resolveHours', v: string) => {
    const n = Math.max(1, Math.min(8760, Number(v.replace(/\D/g, '')) || 1));
    setDraft({ ...cur, [p]: { ...cur[p], [k]: n } });
  };
  if (rules.isPending) return <Skeleton w="100%" h={80} />;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {/* Таблица сроков: заголовки один раз, часы — числовые поля со степпером */}
      <div style={{ display: 'grid', gridTemplateColumns: '120px 140px 140px', gap: '6px 12px', alignItems: 'center' }}>
        <span />
        <span className="label">{t('cases.settings.firstResponseHours')}</span>
        <span className="label">{t('cases.settings.resolveHours')}</span>
        {CASE_PRIORITIES.map(p => (
          <React.Fragment key={p}>
            <span>{t(`cases.priority.${p}`)}</span>
            <NumberField min={1} max={8760} disabled={!isAdmin} aria-label={`${t(`cases.priority.${p}`)}: ${t('cases.settings.firstResponseHours')}`} value={cur[p].firstResponseHours} onChange={v => set(p, 'firstResponseHours', String(v))} />
            <NumberField min={1} max={8760} disabled={!isAdmin} aria-label={`${t(`cases.priority.${p}`)}: ${t('cases.settings.resolveHours')}`} value={cur[p].resolveHours} onChange={v => set(p, 'resolveHours', String(v))} />
          </React.Fragment>
        ))}
      </div>
      {isAdmin && (
        <div>
          <Button
            size="sm"
            variant="primary"
            disabled={!draft}
            onClick={async () => {
              if (await api('PUT', '/case-sla-rules', cur)) {
                setDraft(null);
                toast(t('cases.settings.saved'));
              }
            }}
          >
            {t('cases.settings.saveSla')}
          </Button>
        </div>
      )}
    </div>
  );
}

const AUTO = '__auto';

function FormRow({ form, isAdmin }: { form: CaseForm; isAdmin: boolean }) {
  const t = useT();
  const api = useCasesApi();
  const { data: ws } = useWorkspace();
  const owners = useMembersWith(ws.members.filter(m => m.status === 'active'), 'support_agent', [form.defaultOwnerId]);
  const [name, setName] = React.useState(form.name);
  const [del, setDel] = React.useState(false);
  const [rotate, setRotate] = React.useState(false);
  const url = form.webhookToken ? caseWebhookUrl(form.webhookToken) : '';
  const patch = (b: Record<string, unknown>) => api('PATCH', `/case-forms/${form.id}`, b);
  return (
    <div className="srow" style={{ display: 'block' }}>
      <SRow t={<>{form.name} {!form.enabled && <Badge tone="gray">{t('cases.settings.formEnabled')}: 0</Badge>}</>}>
        {isAdmin && <Switch checked={form.enabled} aria-label={t('cases.settings.formEnabled')} onChange={e => void patch({ enabled: e.target.checked })} />}
      </SRow>
      {isAdmin && (
        <div className="stack" style={{ gap: 8, marginTop: 8 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Field label={t('cases.settings.formName')}>{p => <Input {...p} maxLength={200} value={name} onChange={e => setName(e.target.value)} onBlur={() => name.trim() && name !== form.name && void patch({ name: name.trim() })} />}</Field>
            <Field label={t('cases.settings.formOwner')}>
              {p => <Select {...p} value={form.defaultOwnerId ?? AUTO} onValueChange={v => void patch({ defaultOwnerId: v === AUTO ? null : v })} options={[{ value: AUTO, label: t('cases.settings.formOwnerAuto') }, ...owners.map(m => ({ value: m.id, label: m.name }))]} />}
            </Field>
          </div>
          <Field label={t('cases.settings.webhook')} hint={t('cases.settings.fieldsHint')}>
            {p => (
              <div className="row" style={{ gap: 8 }}>
                <Input {...p} readOnly value={url} style={{ flex: 1, fontFamily: 'var(--mono, monospace)', fontSize: 12 }} onFocus={e => e.target.select()} />
                <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(url).then(() => toast(t('cases.settings.copied')))}>
                  <Copy size={13} />
                  {t('cases.settings.copy')}
                </Button>
              </div>
            )}
          </Field>
          <div className="row" style={{ gap: 8 }}>
            <Button size="sm" variant="ghost" onClick={() => setRotate(true)}><RefreshCw size={13} />{t('cases.settings.rotate')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setDel(true)}><Trash2 size={13} />{t('cases.settings.delete')}</Button>
          </div>
        </div>
      )}
      <ConfirmDialog open={rotate} onOpenChange={setRotate} title={t('cases.settings.rotate')} description={t('cases.settings.rotateConfirm')} confirmLabel={t('cases.settings.rotate')} cancelLabel={t('cases.settings.cancel')} danger onConfirm={async () => { await api('POST', `/case-forms/${form.id}/rotate`); setRotate(false); }} />
      <ConfirmDialog open={del} onOpenChange={setDel} title={t('cases.settings.delete')} description={t('cases.settings.formDeleteConfirm', { name: form.name })} confirmLabel={t('cases.settings.delete')} cancelLabel={t('cases.settings.cancel')} danger onConfirm={async () => { await api('DELETE', `/case-forms/${form.id}?hard=true`); setDel(false); }} />
    </div>
  );
}

export function CasesSettingsSection({ title }: { title: string }) {
  const t = useT();
  const isAdmin = useIsAdmin();
  const api = useCasesApi();
  const forms = useCaseForms();
  const [name, setName] = React.useState('');
  const list = forms.data ?? [];
  return (
    <>
      <SettingsHead title={title} lead={t('cases.settings.slaLead')} />
      {!isAdmin && <Alert tone="info" className="mb-3">{t('cases.settings.onlyAdmins')}</Alert>}
      <div className="sblock">
        <h3 style={{ marginTop: 0 }}>{t('cases.settings.slaTitle')}</h3>
        <SlaRules isAdmin={isAdmin} />
      </div>
      <div className="sblock">
        <h3 style={{ marginTop: 0 }}>{t('cases.settings.formsTitle')}</h3>
        <p className="muted" style={{ fontSize: 13 }}>{t('cases.settings.formsLead')}</p>
        {forms.isPending ? (
          <Skeleton w="100%" h={60} />
        ) : !list.length ? (
          <EmptyState icon={<Globe size={20} />} title={t('cases.settings.formEmpty')}>{t('cases.settings.formEmptyHint')}</EmptyState>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {list.map(f => <FormRow key={f.id} form={f} isAdmin={isAdmin} />)}
          </div>
        )}
        {isAdmin && (
          <div className="row" style={{ gap: 8, marginTop: 12, alignItems: 'flex-end' }}>
            <Field label={t('cases.settings.formName')}>{p => <Input {...p} maxLength={200} value={name} onChange={e => setName(e.target.value)} />}</Field>
            <Button size="sm" disabled={!name.trim()} onClick={async () => { if (await api('POST', '/case-forms', { name: name.trim() })) setName(''); }}>
              <Plus size={13} />
              {t('cases.settings.formsAdd')}
            </Button>
          </div>
        )}
      </div>
      <div className="sblock">
        <h3 style={{ marginTop: 0 }}>{t('cases.settings.mailTitle')}</h3>
        <p className="muted" style={{ fontSize: 13 }}>{t('cases.settings.mailHint')}</p>
      </div>
    </>
  );
}
