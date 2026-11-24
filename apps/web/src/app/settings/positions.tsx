/* Settings → Positions и Nomenclature kinds (задача 1172): справочники воркспейса, правят admin и owner.
   Должность = название + функции (списки выбора) + разделы меню + оказываемые виды номенклатуры (для специалиста записи). */
import * as React from 'react';
import { BriefcaseBusiness, Plus, Shapes } from 'lucide-react';
import {
  POSITION_FUNCTIONS,
  POSITION_SECTIONS,
  PRODUCT_KIND_TYPES,
  RECORD_SCOPES,
  SENSITIVE_FIELD_KEYS,
  type PositionFunction,
  type PositionSection,
  type ProductKindType,
  type RecordScope,
  type SensitiveFieldKey,
} from '@erp/shared';
import { Alert, Badge, Button, Checkbox, ConfirmDialog, Dialog, DialogClose, DialogContent, EmptyState, Field, Input, Select, Skeleton, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { useIsAdmin } from '../catalog/data';
import { usePositions, usePositionsApi, useProductKinds, type PositionItem, type ProductKindItem } from '../positions/data';
import { activeFields, useAllEntities } from '../meta/data';
import { SettingsHead, SRow } from './parts';

interface Draft {
  name: string;
  functions: PositionFunction[];
  sections: PositionSection[];
  productKindIds: string[];
  recordScope: RecordScope;
  hiddenFields: string[];
}

const SENSITIVE_FIELD_I18N = {
  'deal.amount': 'positions.sensitiveField.deal_amount',
  'deal.probability': 'positions.sensitiveField.deal_probability',
  'contact.phone': 'positions.sensitiveField.contact_phone',
  'contact.email': 'positions.sensitiveField.contact_email',
  'lead.phone': 'positions.sensitiveField.lead_phone',
  'lead.email': 'positions.sensitiveField.lead_email',
  'company.requisites': 'positions.sensitiveField.company_requisites',
  'company.bankAccounts': 'positions.sensitiveField.company_bankAccounts',
  'document.total': 'positions.sensitiveField.document_total',
} as const satisfies Record<SensitiveFieldKey, string>;

const blank = (): Draft => ({ name: '', functions: [], sections: [], productKindIds: [], recordScope: 'all', hiddenFields: [] });
const fromPosition = (p: PositionItem): Draft => ({
  name: p.name,
  functions: p.functions,
  sections: p.sections,
  productKindIds: p.productKindIds,
  recordScope: p.recordScope ?? 'all',
  hiddenFields: p.hiddenFields ?? [],
});
const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

function Checks<T extends string>({ label, hint, options, value, onChange, disabled }: { label: string; hint?: string; options: { value: T; label: string }[]; value: T[]; onChange: (v: T[]) => void; disabled: boolean }) {
  return (
    <div>
      <div className="label" style={{ marginBottom: 4 }}>{label}</div>
      <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
        {options.map(o => (
          <label key={o.value} className="row" style={{ gap: 6, fontSize: 13 }}>
            <Checkbox checked={value.includes(o.value)} disabled={disabled} onChange={() => onChange(toggle(value, o.value))} aria-label={o.label} />
            {o.label}
          </label>
        ))}
      </div>
      {hint && <p className="faint" style={{ fontSize: 12, margin: '4px 0 0' }}>{hint}</p>}
    </div>
  );
}

function PositionForm({ draft, onChange, disabled }: { draft: Draft; onChange: (d: Draft) => void; disabled: boolean }) {
  const t = useT();
  const kinds = useProductKinds();
  const entities = useAllEntities();
  const customFields = (entities.data ?? []).filter(e => !e.archivedAt).flatMap(e =>
    activeFields(e).filter(f => !f.isSystem && !f.options.hidden).map(f => ({ value: `custom:${e.key}.${f.key}`, label: `${e.name} · ${f.name}` })),
  );
  const isSpecialist = draft.functions.includes('appointments_specialist');
  return (
    <div className="stack" style={{ gap: 12 }}>
      <Field label={t('positions.settings.name')}>{p => <Input {...p} disabled={disabled} maxLength={120} value={draft.name} onChange={e => onChange({ ...draft, name: e.target.value })} />}</Field>
      <Checks
        label={t('positions.settings.functions')}
        hint={t('positions.settings.functionsHint')}
        disabled={disabled}
        options={POSITION_FUNCTIONS.map(f => ({ value: f, label: t(`positions.fn.${f}`) }))}
        value={draft.functions}
        onChange={functions => onChange({ ...draft, functions })}
      />
      <Checks
        label={t('positions.settings.sections')}
        hint={t('positions.settings.sectionsHint')}
        disabled={disabled}
        options={POSITION_SECTIONS.map(s => ({ value: s, label: t(`positions.section.${s}`) }))}
        value={draft.sections}
        onChange={sections => onChange({ ...draft, sections })}
      />
      <div>
        <Field label={t('positions.settings.recordScope')}>
          {p => (
            <Select
              id={p.id}
              disabled={disabled}
              value={draft.recordScope}
              onValueChange={v => onChange({ ...draft, recordScope: v as RecordScope })}
              options={RECORD_SCOPES.map(s => ({ value: s, label: t(`positions.recordScope.${s}`) }))}
              aria-label={t('positions.settings.recordScope')}
            />
          )}
        </Field>
        <p className="faint" style={{ fontSize: 12, margin: '4px 0 0' }}>{t('positions.settings.recordScopeHint')}</p>
      </div>
      <Checks
        label={t('positions.settings.hiddenFields')}
        hint={t('positions.settings.hiddenFieldsHint')}
        disabled={disabled}
        options={[...SENSITIVE_FIELD_KEYS.map(k => ({ value: k, label: t(SENSITIVE_FIELD_I18N[k]) })), ...customFields]}
        value={draft.hiddenFields}
        onChange={hiddenFields => onChange({ ...draft, hiddenFields })}
      />
      {isSpecialist &&
        ((kinds.data ?? []).filter(k => k.type === 'service').length ? (
          <Checks
            label={t('positions.settings.kinds')}
            hint={t('positions.settings.kindsHint')}
            disabled={disabled}
            options={(kinds.data ?? []).filter(k => k.type === 'service').map(k => ({ value: k.id, label: k.name }))}
            value={draft.productKindIds}
            onChange={productKindIds => onChange({ ...draft, productKindIds })}
          />
        ) : (
          <p className="faint" style={{ fontSize: 12 }}>{t('positions.settings.noKinds')}</p>
        ))}
    </div>
  );
}

/** Окно должности: новая или правка существующей; удаление — слева в подвале */
function PositionDialog({ position, readOnly, onClose, onDelete }: { position?: PositionItem; readOnly: boolean; onClose: () => void; onDelete: (p: PositionItem) => void }) {
  const t = useT();
  const api = usePositionsApi();
  const [draft, setDraft] = React.useState<Draft>(position ? fromPosition(position) : blank());
  const [busy, setBusy] = React.useState(false);
  const save = async () => {
    if (!draft.name.trim() || readOnly) return;
    setBusy(true);
    const body = {
      name: draft.name.trim(),
      functions: draft.functions,
      sections: draft.sections,
      productKindIds: draft.functions.includes('appointments_specialist') ? draft.productKindIds : [],
      recordScope: draft.recordScope,
      hiddenFields: draft.hiddenFields,
    };
    const ok = position ? await api('PATCH', `/positions/${position.id}`, body) : await api('POST', '/positions', body);
    setBusy(false);
    if (!ok) return;
    toast(t('positions.settings.saved'));
    onClose();
  };
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        size="lg"
        title={position ? t('positions.settings.dialogEdit') : t('positions.settings.dialogNew')}
        footer={
          <>
            {position && !readOnly && (
              <Button variant="ghost" onClick={() => onDelete(position)}>
                {t('positions.settings.delete')}
              </Button>
            )}
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">{t('positions.settings.cancel')}</Button>
            </DialogClose>
            {!readOnly && (
              <Button variant="primary" disabled={busy || !draft.name.trim()} onClick={() => void save()}>
                {t('positions.settings.save')}
              </Button>
            )}
          </>
        }
      >
        <PositionForm draft={draft} onChange={setDraft} disabled={readOnly} />
      </DialogContent>
    </Dialog>
  );
}

export function PositionsSection({ title }: { title: string }) {
  const t = useT();
  const isAdmin = useIsAdmin();
  const api = usePositionsApi();
  const positions = usePositions();
  const [dialog, setDialog] = React.useState<{ position?: PositionItem } | null>(null);
  const [del, setDel] = React.useState<PositionItem | null>(null);

  const summary = (p: PositionItem) =>
    [
      p.functions.map(f => t(`positions.fn.${f}`)).join(', '),
      p.sections.length ? p.sections.map(s => t(`positions.section.${s}`)).join(', ') : t('positions.settings.allSections'),
      p.recordScope && p.recordScope !== 'all' ? t(`positions.recordScope.${p.recordScope}`) : '',
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <>
      <SettingsHead title={title} lead={t('positions.settings.lead')} />
      {!isAdmin && <Alert tone="info" className="mb-3">{t('positions.settings.onlyAdmins')}</Alert>}
      <div className="sblock">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          {isAdmin && (
            <Button size="sm" variant="primary" onClick={() => setDialog({})}>
              <Plus size={13} />
              {t('positions.settings.add')}
            </Button>
          )}
        </div>
        {positions.isPending ? (
          <Skeleton w="100%" h={60} />
        ) : !(positions.data ?? []).length ? (
          <EmptyState icon={<BriefcaseBusiness size={20} />} title={t('positions.settings.empty')}>{t('positions.settings.emptyHint')}</EmptyState>
        ) : (
          <div className="srows-tight">
            {(positions.data ?? []).map(p => (
              <SRow
                key={p.id}
                t={
                  <>
                    <button type="button" className="srow-open" aria-label={t('positions.settings.editOne', { name: p.name })} onClick={() => setDialog({ position: p })}>
                      {p.name}
                    </button>{' '}
                    <Badge>{t('positions.settings.members', { count: p.memberIds.length })}</Badge>
                  </>
                }
                d={summary(p)}
              />
            ))}
          </div>
        )}
      </div>
      {dialog && <PositionDialog position={dialog.position} readOnly={!isAdmin} onClose={() => setDialog(null)} onDelete={setDel} />}
      <ConfirmDialog
        open={!!del}
        onOpenChange={o => !o && setDel(null)}
        title={t('positions.settings.delete')}
        description={del ? t('positions.settings.confirmDelete', { name: del.name }) : ''}
        confirmLabel={t('positions.settings.delete')}
        cancelLabel={t('positions.settings.cancel')}
        danger
        onConfirm={async () => {
          if (del && (await api('DELETE', `/positions/${del.id}`))) {
            toast(t('positions.settings.deleted'));
            setDialog(null);
          }
          setDel(null);
        }}
      />
    </>
  );
}

export function ProductKindsSection({ title }: { title: string }) {
  const t = useT();
  const isAdmin = useIsAdmin();
  const api = usePositionsApi();
  const kinds = useProductKinds();
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState('');
  const [type, setType] = React.useState<ProductKindType>('goods');
  const [del, setDel] = React.useState<ProductKindItem | null>(null);
  const typeOptions = PRODUCT_KIND_TYPES.map(k => ({ value: k, label: t(`positions.kindType.${k}`) }));

  return (
    <>
      <SettingsHead title={title} lead={t('positions.kinds.lead')} />
      {!isAdmin && <Alert tone="info" className="mb-3">{t('positions.kinds.onlyAdmins')}</Alert>}
      <div className="sblock">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          {isAdmin && (
            <Button size="sm" variant="ghost" onClick={() => { setAdding(true); setName(''); setType('goods'); }}>
              <Plus size={13} />
              {t('positions.kinds.add')}
            </Button>
          )}
        </div>
        {kinds.isPending ? (
          <Skeleton w="100%" h={60} />
        ) : !(kinds.data ?? []).length && !adding ? (
          <EmptyState icon={<Shapes size={20} />} title={t('positions.kinds.empty')}>{t('positions.kinds.emptyHint')}</EmptyState>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {adding && (
              <div className="srow" style={{ display: 'block' }}>
                <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <Field label={t('positions.kinds.name')}>{p => <Input {...p} maxLength={120} value={name} onChange={e => setName(e.target.value)} />}</Field>
                  <Field label={t('positions.kinds.type')}>{p => <Select id={p.id} value={type} onValueChange={v => setType(v as ProductKindType)} options={typeOptions} aria-label={t('positions.kinds.type')} />}</Field>
                  <Button
                    size="sm"
                    disabled={!name.trim()}
                    onClick={async () => {
                      if (await api('POST', '/product-kinds', { name: name.trim(), type })) {
                        toast(t('positions.kinds.saved'));
                        setAdding(false);
                      }
                    }}
                  >
                    {t('positions.kinds.save')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>{t('positions.settings.cancel')}</Button>
                </div>
              </div>
            )}
            {(kinds.data ?? []).map(k => (
              <div key={k.id} className="srow" style={{ display: 'block' }}>
                <SRow t={k.name} d={t(`positions.kindType.${k.type}`)}>
                  {isAdmin && <Button size="sm" variant="ghost" onClick={() => setDel(k)}>{t('positions.kinds.delete')}</Button>}
                </SRow>
              </div>
            ))}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={!!del}
        onOpenChange={o => !o && setDel(null)}
        title={t('positions.kinds.delete')}
        description={del ? t('positions.kinds.confirmDelete', { name: del.name }) : ''}
        confirmLabel={t('positions.kinds.delete')}
        cancelLabel={t('positions.settings.cancel')}
        danger
        onConfirm={async () => {
          if (del && (await api('DELETE', `/product-kinds/${del.id}`))) toast(t('positions.kinds.deleted'));
          setDel(null);
        }}
      />
    </>
  );
}
