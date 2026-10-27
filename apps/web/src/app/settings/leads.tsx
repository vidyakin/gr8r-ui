/* Settings → Lead statuses / Lead forms (задача 1175): статусы с категориями и цветом, формы сайта с адресом вебхука. Правят admin и owner. */
import * as React from 'react';
import { ArrowDown, ArrowUp, Copy, Globe, ListOrdered, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { LEAD_STATUS_CATEGORIES, LEAD_STATUS_COLORS, type LeadStatusCategory } from '@gr8r/shared';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, Field, Input, Select, Skeleton, Switch, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { useIsAdmin } from '../catalog/data';
import { useWorkspace } from '../data/store';
import { useMembersWith } from '../positions/data';
import { StatusBadge } from '../leads/StatusBadge';
import { useLeadForms, useLeadsApi, useLeadStatuses, webhookUrl, type LeadForm, type LeadStatus } from '../leads/data';
import { SettingsHead, SRow } from './parts';

export function LeadStatusesSection({ title }: { title: string }) {
  const t = useT();
  const isAdmin = useIsAdmin();
  const api = useLeadsApi();
  const statuses = useLeadStatuses();
  const [name, setName] = React.useState('');
  const [category, setCategory] = React.useState<LeadStatusCategory>('in_progress');
  const [color, setColor] = React.useState<string>('gray');
  const [del, setDel] = React.useState<LeadStatus | null>(null);
  const list = statuses.data ?? [];

  const move = async (i: number, d: -1 | 1) => {
    const ids = list.map(s => s.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    await api('POST', '/lead-statuses/reorder', { ids });
  };

  return (
    <>
      <SettingsHead title={title} lead={t('leads.settings.statusesLead')} />
      {!isAdmin && <Alert tone="info" className="mb-3">{t('leads.settings.onlyAdmins')}</Alert>}
      <div className="sblock">
        {statuses.isPending ? (
          <Skeleton w="100%" h={60} />
        ) : !list.length ? (
          <EmptyState icon={<ListOrdered size={20} />} title={t('leads.settings.statusEmpty')} />
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {list.map((s, i) => (
              <div key={s.id} className="srow" style={{ display: 'block' }}>
                <SRow t={<><StatusBadge status={s} /> <Badge>{t(`leads.category.${s.category}`)}</Badge></>}>
                  {isAdmin && (
                    <div className="row" style={{ gap: 4 }}>
                      <Select size="sm" value={s.category} aria-label={t('leads.col.status')} onValueChange={v => void api('PATCH', `/lead-statuses/${s.id}`, { category: v })} options={LEAD_STATUS_CATEGORIES.map(c => ({ value: c, label: t(`leads.category.${c}`) }))} />
                      <Select size="sm" value={s.color} aria-label={t('leads.settings.statusName')} onValueChange={v => void api('PATCH', `/lead-statuses/${s.id}`, { color: v })} options={LEAD_STATUS_COLORS.map(c => ({ value: c, label: t(`leads.color.${c}`) }))} />
                      <Button size="sm" variant="ghost" aria-label={t('leads.settings.up')} disabled={i === 0} onClick={() => void move(i, -1)}><ArrowUp size={13} /></Button>
                      <Button size="sm" variant="ghost" aria-label={t('leads.settings.down')} disabled={i === list.length - 1} onClick={() => void move(i, 1)}><ArrowDown size={13} /></Button>
                      <Button size="sm" variant="ghost" aria-label={t('leads.settings.statusDeleteTitle')} onClick={() => setDel(s)}><Trash2 size={13} /></Button>
                    </div>
                  )}
                </SRow>
              </div>
            ))}
          </div>
        )}
        {isAdmin && (
          <div className="row" style={{ gap: 8, marginTop: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field label={t('leads.settings.statusName')}>{p => <Input {...p} maxLength={200} value={name} onChange={e => setName(e.target.value)} />}</Field>
            <Select value={category} aria-label={t('leads.col.status')} onValueChange={v => setCategory(v as LeadStatusCategory)} options={LEAD_STATUS_CATEGORIES.map(c => ({ value: c, label: t(`leads.category.${c}`) }))} />
            <Select value={color} aria-label={t('leads.settings.statusName')} onValueChange={setColor} options={LEAD_STATUS_COLORS.map(c => ({ value: c, label: t(`leads.color.${c}`) }))} />
            <Button
              size="sm"
              disabled={!name.trim()}
              onClick={async () => {
                if (await api('POST', '/lead-statuses', { name: name.trim(), category, color })) setName('');
              }}
            >
              <Plus size={13} />
              {t('leads.settings.statusesAdd')}
            </Button>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={!!del}
        onOpenChange={o => !o && setDel(null)}
        title={t('leads.settings.statusDeleteTitle')}
        description={del ? t('leads.settings.statusDelete', { name: del.name }) : ''}
        confirmLabel={t('leads.card.delete')}
        cancelLabel={t('leads.settings.cancel')}
        danger
        onConfirm={async () => {
          if (del) await api('DELETE', `/lead-statuses/${del.id}`);
          setDel(null);
        }}
      />
    </>
  );
}

const AUTO = '__auto';

function FormRow({ form, isAdmin }: { form: LeadForm; isAdmin: boolean }) {
  const t = useT();
  const api = useLeadsApi();
  const { data: ws } = useWorkspace();
  const owners = useMembersWith(ws.members.filter(m => m.status === 'active'), 'sales_manager', [form.defaultOwnerId]);
  const [name, setName] = React.useState(form.name);
  const [source, setSource] = React.useState(form.source);
  const [del, setDel] = React.useState(false);
  const [rotate, setRotate] = React.useState(false);
  const url = form.webhookToken ? webhookUrl(form.webhookToken) : '';
  const patch = (b: Record<string, unknown>) => api('PATCH', `/lead-forms/${form.id}`, b);

  return (
    <div className="srow" style={{ display: 'block' }}>
      <SRow t={<>{form.name} {!form.enabled && <Badge tone="gray">{t('leads.settings.formEnabled')}: 0</Badge>}</>} d={form.source}>
        {isAdmin && <Switch checked={form.enabled} aria-label={t('leads.settings.formEnabled')} onChange={e => void patch({ enabled: e.target.checked })} />}
      </SRow>
      {isAdmin && (
        <div className="stack" style={{ gap: 8, marginTop: 8 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Field label={t('leads.settings.formName')}>{p => <Input {...p} maxLength={200} value={name} onChange={e => setName(e.target.value)} onBlur={() => name.trim() && name !== form.name && void patch({ name: name.trim() })} />}</Field>
            <Field label={t('leads.settings.formSource')}>{p => <Input {...p} maxLength={200} value={source} onChange={e => setSource(e.target.value)} onBlur={() => source !== form.source && void patch({ source })} />}</Field>
            <Field label={t('leads.settings.formOwner')}>
              {p => (
                <Select {...p} value={form.defaultOwnerId ?? AUTO} onValueChange={v => void patch({ defaultOwnerId: v === AUTO ? null : v })} options={[{ value: AUTO, label: t('leads.settings.formOwnerAuto') }, ...owners.map(m => ({ value: m.id, label: m.name }))]} />
              )}
            </Field>
          </div>
          <Field label={t('leads.settings.webhook')} hint={t('leads.settings.fieldsHint')}>
            {p => (
              <div className="row" style={{ gap: 8 }}>
                <Input {...p} readOnly value={url} style={{ flex: 1, fontFamily: 'var(--mono, monospace)', fontSize: 12 }} onFocus={e => e.target.select()} />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void navigator.clipboard?.writeText(url).then(() => toast(t('leads.settings.copied')));
                  }}
                >
                  <Copy size={13} />
                  {t('leads.settings.copy')}
                </Button>
              </div>
            )}
          </Field>
          <div className="row" style={{ gap: 8 }}>
            <Button size="sm" variant="ghost" onClick={() => setRotate(true)}><RefreshCw size={13} />{t('leads.settings.rotate')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setDel(true)}><Trash2 size={13} />{t('leads.card.delete')}</Button>
          </div>
        </div>
      )}
      <ConfirmDialog open={rotate} onOpenChange={setRotate} title={t('leads.settings.rotate')} description={t('leads.settings.rotateConfirm')} confirmLabel={t('leads.settings.rotate')} cancelLabel={t('leads.settings.cancel')} danger onConfirm={async () => { await api('POST', `/lead-forms/${form.id}/rotate`); setRotate(false); }} />
      <ConfirmDialog open={del} onOpenChange={setDel} title={t('leads.card.delete')} description={t('leads.settings.formDeleteConfirm', { name: form.name })} confirmLabel={t('leads.card.delete')} cancelLabel={t('leads.settings.cancel')} danger onConfirm={async () => { await api('DELETE', `/lead-forms/${form.id}?hard=true`); setDel(false); }} />
    </div>
  );
}

export function LeadFormsSection({ title }: { title: string }) {
  const t = useT();
  const isAdmin = useIsAdmin();
  const api = useLeadsApi();
  const forms = useLeadForms();
  const [name, setName] = React.useState('');
  const list = forms.data ?? [];

  return (
    <>
      <SettingsHead title={title} lead={t('leads.settings.formsLead')} />
      {!isAdmin && <Alert tone="info" className="mb-3">{t('leads.settings.onlyAdmins')}</Alert>}
      <div className="sblock">
        {forms.isPending ? (
          <Skeleton w="100%" h={60} />
        ) : !list.length ? (
          <EmptyState icon={<Globe size={20} />} title={t('leads.settings.formEmpty')}>{t('leads.settings.formEmptyHint')}</EmptyState>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {list.map(f => (
              <FormRow key={f.id} form={f} isAdmin={isAdmin} />
            ))}
          </div>
        )}
        {isAdmin && (
          <div className="row" style={{ gap: 8, marginTop: 12, alignItems: 'flex-end' }}>
            <Field label={t('leads.settings.formName')}>{p => <Input {...p} maxLength={200} value={name} onChange={e => setName(e.target.value)} />}</Field>
            <Button
              size="sm"
              disabled={!name.trim()}
              onClick={async () => {
                if (await api('POST', '/lead-forms', { name: name.trim(), source: name.trim() })) setName('');
              }}
            >
              <Plus size={13} />
              {t('leads.settings.formsAdd')}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
