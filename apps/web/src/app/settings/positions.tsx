/* Settings → Positions и Nomenclature kinds (задача 1172): справочники воркспейса, правят admin и owner.
   Должность = название + функции (списки выбора) + разделы меню + оказываемые виды номенклатуры (для специалиста записи). */
import * as React from 'react';
import { BriefcaseBusiness, Plus, Shapes } from 'lucide-react';
import { POSITION_FUNCTIONS, POSITION_SECTIONS, PRODUCT_KIND_TYPES, type PositionFunction, type PositionSection, type ProductKindType } from '@gr8r/shared';
import { Alert, Badge, Button, Checkbox, ConfirmDialog, EmptyState, Field, Input, Select, Skeleton, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { useIsAdmin } from '../catalog/data';
import { usePositions, usePositionsApi, useProductKinds, type PositionItem, type ProductKindItem } from '../positions/data';
import { SettingsHead, SRow } from './parts';

interface Draft {
  name: string;
  functions: PositionFunction[];
  sections: PositionSection[];
  productKindIds: string[];
}

const blank = (): Draft => ({ name: '', functions: [], sections: [], productKindIds: [] });
const fromPosition = (p: PositionItem): Draft => ({ name: p.name, functions: p.functions, sections: p.sections, productKindIds: p.productKindIds });
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

export function PositionsSection({ title }: { title: string }) {
  const t = useT();
  const isAdmin = useIsAdmin();
  const api = usePositionsApi();
  const positions = usePositions();
  const [open, setOpen] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>(blank());
  const [del, setDel] = React.useState<PositionItem | null>(null);

  const body = (d: Draft) => ({ name: d.name.trim(), functions: d.functions, sections: d.sections, productKindIds: d.functions.includes('appointments_specialist') ? d.productKindIds : [] });
  const summary = (p: PositionItem) =>
    [p.functions.map(f => t(`positions.fn.${f}`)).join(', '), p.sections.length ? p.sections.map(s => t(`positions.section.${s}`)).join(', ') : t('positions.settings.allSections')].filter(Boolean).join(' · ');

  return (
    <>
      <SettingsHead title={title} lead={t('positions.settings.lead')} />
      {!isAdmin && <Alert tone="info" className="mb-3">{t('positions.settings.onlyAdmins')}</Alert>}
      <div className="sblock">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          {isAdmin && (
            <Button size="sm" variant="ghost" onClick={() => { setAdding(true); setOpen(null); setDraft(blank()); }}>
              <Plus size={13} />
              {t('positions.settings.add')}
            </Button>
          )}
        </div>
        {positions.isPending ? (
          <Skeleton w="100%" h={60} />
        ) : !(positions.data ?? []).length && !adding ? (
          <EmptyState icon={<BriefcaseBusiness size={20} />} title={t('positions.settings.empty')}>{t('positions.settings.emptyHint')}</EmptyState>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {adding && (
              <div className="srow" style={{ display: 'block' }}>
                <PositionForm draft={draft} onChange={setDraft} disabled={false} />
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <Button
                    size="sm"
                    disabled={!draft.name.trim()}
                    onClick={async () => {
                      if (await api('POST', '/positions', body(draft))) {
                        toast(t('positions.settings.saved'));
                        setAdding(false);
                      }
                    }}
                  >
                    {t('positions.settings.save')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>{t('positions.settings.cancel')}</Button>
                </div>
              </div>
            )}
            {(positions.data ?? []).map(p => (
              <div key={p.id} className="srow" style={{ display: 'block' }}>
                <SRow t={<>{p.name} <Badge>{t('positions.settings.members', { count: p.memberIds.length })}</Badge></>} d={summary(p)}>
                  <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setOpen(open === p.id ? null : p.id); setDraft(fromPosition(p)); }}>
                    {open === p.id ? t('positions.settings.cancel') : t('positions.settings.edit')}
                  </Button>
                </SRow>
                {open === p.id && (
                  <div style={{ marginTop: 8 }}>
                    <PositionForm draft={draft} onChange={setDraft} disabled={!isAdmin} />
                    {isAdmin && (
                      <div className="row" style={{ gap: 8, marginTop: 8 }}>
                        <Button
                          size="sm"
                          disabled={!draft.name.trim()}
                          onClick={async () => {
                            if (await api('PATCH', `/positions/${p.id}`, body(draft))) {
                              toast(t('positions.settings.saved'));
                              setOpen(null);
                            }
                          }}
                        >
                          {t('positions.settings.save')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDel(p)}>{t('positions.settings.delete')}</Button>
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
        title={t('positions.settings.delete')}
        description={del ? t('positions.settings.confirmDelete', { name: del.name }) : ''}
        confirmLabel={t('positions.settings.delete')}
        cancelLabel={t('positions.settings.cancel')}
        danger
        onConfirm={async () => {
          if (del && (await api('DELETE', `/positions/${del.id}`))) {
            toast(t('positions.settings.deleted'));
            setOpen(null);
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
