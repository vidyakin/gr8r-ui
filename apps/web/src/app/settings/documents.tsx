/* Settings → Organizations и Warehouses. Организации — собственные юрлица воркспейса (реквизиты, подписанты, налогообложение, печать и подписи
   ссылкой), склады — места хранения; здесь же настройка «разрешить отрицательный остаток». Меняет admin и выше. */
import * as React from 'react';
import { Archive, Building2, Pencil, Plus, Star, Tags, Warehouse as WarehouseIcon } from 'lucide-react';
import { COST_DISTRIBUTIONS, COST_DISTRIBUTION_LABELS, TAX_SYSTEMS, TAX_SYSTEM_LABELS, VAT_LABELS, VAT_RATES, type CostDistribution, type CostItemKind, type FileRef, type TaxSystem, type VatRate, type WarehouseKind } from '@gr8r/shared';
import { Alert, Badge, Button, ConfirmDialog, Dialog, DialogClose, DialogContent, EmptyState, Field, IconButton, Input, Skeleton, toast } from '@/components/ui';
import { useCompanies, useIsAdmin } from '../catalog/data';
import { BankAccountsEditor, RequisitesFields, checkRequisites, type RequisitesValue } from '../docs/requisites';
import { useCostItems, useDocsApi, useInventorySettings, useOrganizations, useWarehouses, type CostItem, type Organization, type Warehouse } from '../docs/data';
import { SettingsHead, SRow, Toggle } from './parts';
import { t as tFn, hasKey, useT, type TKey } from '@/i18n';

/** Подпись значения из settings.enums.* с локальным fallback (для случая, когда справочник шире словаря) */
function enumLabel(group: 'costItem' | 'warehouseKind' | 'costDistribution' | 'taxSystem' | 'materialPriceSource' | 'workOrderStateCategory', value: string, fallback: string): string {
  const key = `settings.enums.${group}.${value}`;
  return hasKey(key) ? tFn(key as TKey) : fallback;
}

/* ---------------- организации ---------------- */

export function OrganizationsSection({ title }: { title: string }) {
  const t = useT();
  const isAdmin = useIsAdmin();
  const list = useOrganizations();
  const api = useDocsApi();
  const [dialog, setDialog] = React.useState<{ org?: Organization } | null>(null);
  const [archiving, setArchiving] = React.useState<Organization | null>(null);
  const orgs = (list.data ?? []).filter(o => !o.archivedAt);

  return (
    <>
      <SettingsHead title={title} lead={t('settings.organizations.lead')} />
      {!isAdmin && (
        <Alert tone="info" className="mb-3">
          {t('settings.organizations.onlyAdmins')}
        </Alert>
      )}
      <div className="sblock">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{t('settings.organizations.title')}</h2>
          {isAdmin && (
            <Button size="sm" variant="primary" onClick={() => setDialog({})}>
              <Plus size={13} />
              {t('settings.organizations.new')}
            </Button>
          )}
        </div>
        {list.isPending ? (
          <Skeleton w="100%" h={80} />
        ) : !orgs.length ? (
          <EmptyState icon={<Building2 size={20} />} title={t('settings.organizations.empty.title')}>
            {t('settings.organizations.empty.hint')}
          </EmptyState>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {orgs.map(o => (
              <div key={o.id} className="srow org-row">
                <div style={{ minWidth: 0 }}>
                  <div className="t">
                    {o.name} {o.isDefault && <Badge tone="accent">{t('settings.organizations.default')}</Badge>}
                  </div>
                  <div className="d">
                    {o.inn ? t('settings.organizations.innKpp', { inn: o.inn }) : t('settings.organizations.noInn')}
                    {o.kpp ? ` · ${t('settings.organizations.kpp', { kpp: o.kpp })}` : ''} · {enumLabel('taxSystem', o.taxSystem, TAX_SYSTEM_LABELS[o.taxSystem])} · {t('settings.organizations.vat', { rate: VAT_LABELS[o.defaultVatRate] })}
                  </div>
                </div>
                {isAdmin && (
                  <div className="row" style={{ gap: 2 }}>
                    {!o.isDefault && (
                      <IconButton size="xs" label={t('settings.organizations.makeDefault', { name: o.name })} onClick={() => void api('PATCH', `/organizations/${o.id}`, { isDefault: true })}>
                        <Star size={14} />
                      </IconButton>
                    )}
                    <IconButton size="xs" label={t('settings.organizations.edit', { name: o.name })} onClick={() => setDialog({ org: o })}>
                      <Pencil size={14} />
                    </IconButton>
                    {!o.isDefault && (
                      <IconButton size="xs" label={t('settings.organizations.archiveOne', { name: o.name })} onClick={() => setArchiving(o)}>
                        <Archive size={14} />
                      </IconButton>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {dialog && <OrganizationDialog org={dialog.org} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={!!archiving}
        onOpenChange={o => !o && setArchiving(null)}
        danger
        title={t('settings.organizations.archiveTitle')}
        description={archiving ? <><b>{archiving.name}</b> {t('settings.organizations.archiveBody', { name: archiving.name })}</> : undefined}
        confirmLabel={t('settings.organizations.archiveConfirm')}
        cancelLabel={t('settings.common.cancel')}
        onConfirm={async () => {
          if (archiving && (await api('DELETE', `/organizations/${archiving.id}`))) toast(t('settings.organizations.archived', { name: archiving.name }));
          setArchiving(null);
        }}
      />
    </>
  );
}

const emptyFile = { name: '', url: '' };
const fileOf = (f: FileRef): { name: string; url: string } => (f ? { name: f.name, url: f.url } : emptyFile);
const fileBody = (f: { name: string; url: string }): FileRef => (f.url.trim() ? { name: f.name.trim() || f.url.trim().split('/').pop()!.slice(0, 80), url: f.url.trim() } : null);

function FileLink({ label, value, onChange, error }: { label: string; value: { name: string; url: string }; onChange: (v: { name: string; url: string }) => void; error?: string }) {
  const t = useT();
  return (
    <Field label={label} error={error} hint={t('settings.organizations.file.hint')}>
      {p => <Input {...p} placeholder={t('settings.organizations.file.placeholder')} value={value.url} onChange={e => onChange({ ...value, url: e.target.value })} />}
    </Field>
  );
}

function OrganizationDialog({ org, onClose }: { org?: Organization; onClose: () => void }) {
  const t = useT();
  const api = useDocsApi();
  const [f, setF] = React.useState({
    name: org?.name ?? '',
    fullName: org?.fullName ?? '',
    phone: org?.phone ?? '',
    email: org?.email ?? '',
    directorName: org?.directorName ?? '',
    directorTitle: org?.directorTitle ?? '',
    accountantName: org?.accountantName ?? '',
    taxSystem: (org?.taxSystem ?? 'osn') as TaxSystem,
    defaultVatRate: (org?.defaultVatRate ?? '20') as VatRate,
    isDefault: org?.isDefault ?? false,
  });
  const [req, setReq] = React.useState<RequisitesValue>({ kind: org?.kind ?? 'legal', inn: org?.inn ?? '', kpp: org?.kpp ?? '', ogrn: org?.ogrn ?? '', legalAddress: org?.legalAddress ?? '', actualAddress: org?.actualAddress ?? '' });
  const [stamp, setStamp] = React.useState(fileOf(org?.stampFile ?? null));
  const [dirSig, setDirSig] = React.useState(fileOf(org?.directorSignatureFile ?? null));
  const [accSig, setAccSig] = React.useState(fileOf(org?.accountantSignatureFile ?? null));
  const [err, setErr] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    const errs: Record<string, string> = { ...checkRequisites(req) };
    if (!f.name.trim()) errs.name = t('settings.organizations.fields.nameRequired');
    setErr(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const body = { ...f, name: f.name.trim(), fullName: f.fullName.trim() || f.name.trim(), ...req, stampFile: fileBody(stamp), directorSignatureFile: fileBody(dirSig), accountantSignatureFile: fileBody(accSig) };
    const r = org ? await api('PATCH', `/organizations/${org.id}`, body) : await api('POST', '/organizations', body);
    setBusy(false);
    if (!r) return;
    toast(org ? t('settings.organizations.saved', { name: f.name.trim() }) : t('settings.organizations.added', { name: f.name.trim() }));
    onClose();
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        size="lg"
        title={org ? t('settings.organizations.dialog.edit') : t('settings.organizations.dialog.new')}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">{t('settings.common.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              {org ? t('settings.organizations.dialog.save') : t('settings.organizations.dialog.create')}
            </Button>
          </>
        }
      >
        <form
          className="contents"
          noValidate
          onSubmit={e => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label={t('settings.organizations.fields.name')} error={err.name} hint={t('settings.organizations.fields.nameHint')}>
            {p => <Input {...p} autoFocus value={f.name} onChange={e => (setF({ ...f, name: e.target.value }), setErr(s => ({ ...s, name: '' })))} />}
          </Field>
          <Field label={t('settings.organizations.fields.fullName')} hint={t('settings.organizations.fields.fullNameHint')}>
            {p => <Input {...p} value={f.fullName} placeholder={f.name} onChange={e => setF({ ...f, fullName: e.target.value })} />}
          </Field>
          <RequisitesFields value={req} errors={err} onChange={patch => (setReq(r => ({ ...r, ...patch })), setErr({}))} />
          <div className="row req-row">
            <Field label={t('settings.organizations.fields.phone')} className="grow">
              {p => <Input {...p} value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} />}
            </Field>
            <Field label={t('settings.organizations.fields.email')} className="grow">
              {p => <Input {...p} value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />}
            </Field>
          </div>
          <div className="row req-row">
            <Field label={t('settings.organizations.fields.director')} className="grow">
              {p => <Input {...p} value={f.directorName} onChange={e => setF({ ...f, directorName: e.target.value })} />}
            </Field>
            <Field label={t('settings.organizations.fields.directorTitle')} className="grow">
              {p => <Input {...p} value={f.directorTitle} onChange={e => setF({ ...f, directorTitle: e.target.value })} />}
            </Field>
            <Field label={t('settings.organizations.fields.accountant')} className="grow">
              {p => <Input {...p} value={f.accountantName} onChange={e => setF({ ...f, accountantName: e.target.value })} />}
            </Field>
          </div>
          <div className="row req-row">
            <Field label={t('settings.organizations.fields.taxation')} className="grow">
              {p => (
                <select className="select" id={p.id} value={f.taxSystem} onChange={e => setF({ ...f, taxSystem: e.target.value as TaxSystem })}>
                  {TAX_SYSTEMS.map(ts => (
                    <option key={ts} value={ts}>
                      {enumLabel('taxSystem', ts, TAX_SYSTEM_LABELS[ts])}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t('settings.organizations.fields.defaultVat')} className="grow">
              {p => (
                <select className="select" id={p.id} value={f.defaultVatRate} onChange={e => setF({ ...f, defaultVatRate: e.target.value as VatRate })}>
                  {VAT_RATES.map(v => (
                    <option key={v} value={v}>
                      {VAT_LABELS[v]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <FileLink label={t('settings.organizations.file.stamp')} value={stamp} onChange={setStamp} />
          <FileLink label={t('settings.organizations.file.directorSig')} value={dirSig} onChange={setDirSig} />
          <FileLink label={t('settings.organizations.file.accountantSig')} value={accSig} onChange={setAccSig} />
          <SRow t={t('settings.organizations.fields.defaultOrg')} d={t('settings.organizations.fields.defaultOrgHint')}>
            <Toggle checked={f.isDefault} label={t('settings.organizations.fields.defaultOrg')} onChange={v => setF({ ...f, isDefault: v })} />
          </SRow>
          <div className="field">
            <span className="label">{t('settings.organizations.fields.bankAccounts')}</span>
            {org ? <BankAccountsEditor owner="organizations" ownerId={org.id} canEdit /> : <p className="faint" style={{ margin: 0 }}>{t('settings.organizations.fields.bankAccountsHint')}</p>}
          </div>
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- статьи затрат и доходов ---------------- */

/** Справочник статей затрат и доходов: списание пишется на статью затрат, оприходование — на статью доходов */
export function CostItemsSection({ title }: { title: string }) {
  const t = useT();
  const isAdmin = useIsAdmin();
  const list = useCostItems();
  const api = useDocsApi();
  const [dialog, setDialog] = React.useState<{ item?: CostItem } | null>(null);
  const [archiving, setArchiving] = React.useState<CostItem | null>(null);
  const items = (list.data ?? []).filter(c => !c.archivedAt);

  return (
    <>
      <SettingsHead title={title} lead={t('settings.costItems.lead')} />
      {!isAdmin && (
        <Alert tone="info" className="mb-3">
          {t('settings.costItems.onlyAdmins')}
        </Alert>
      )}
      <div className="sblock">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{t('settings.costItems.title')}</h2>
          {isAdmin && (
            <Button size="sm" variant="primary" onClick={() => setDialog({})}>
              <Plus size={13} />
              {t('settings.costItems.new')}
            </Button>
          )}
        </div>
        {list.isPending ? (
          <Skeleton w="100%" h={80} />
        ) : !items.length ? (
          <EmptyState icon={<Tags size={20} />} title={t('settings.costItems.empty.title')}>
            {t('settings.costItems.empty.hint')}
          </EmptyState>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {items.map(c => (
              <div key={c.id} className="srow">
                <div style={{ minWidth: 0 }}>
                  <div className="t">
                    {c.name} <Badge tone={c.kind === 'expense' ? 'gray' : 'accent'}>{enumLabel('costItem', c.kind, c.kind === 'expense' ? 'Expense' : 'Income')}</Badge>
                    {c.kind === 'expense' && c.distributionMethod !== 'none' && <Badge tone="accent">{enumLabel('costDistribution', c.distributionMethod, COST_DISTRIBUTION_LABELS[c.distributionMethod])}</Badge>}
                  </div>
                  <div className="d">
                    {c.kind === 'expense'
                      ? c.distributionMethod === 'none'
                        ? t('settings.costItems.writeOffsNone')
                        : t('settings.costItems.writeOffsAllocated', { method: enumLabel('costDistribution', c.distributionMethod, COST_DISTRIBUTION_LABELS[c.distributionMethod]).toLowerCase() })
                      : t('settings.costItems.postings')}
                  </div>
                </div>
                {isAdmin && (
                  <div className="row" style={{ gap: 2 }}>
                    <IconButton size="xs" label={t('settings.costItems.edit', { name: c.name })} onClick={() => setDialog({ item: c })}>
                      <Pencil size={14} />
                    </IconButton>
                    <IconButton size="xs" label={t('settings.costItems.archive', { name: c.name })} onClick={() => setArchiving(c)}>
                      <Archive size={14} />
                    </IconButton>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {dialog && <CostItemDialog item={dialog.item} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={!!archiving}
        onOpenChange={o => !o && setArchiving(null)}
        danger
        title={t('settings.costItems.archiveTitle')}
        description={archiving ? <><b>{archiving.name}</b> {t('settings.costItems.archiveBody', { name: archiving.name })}</> : undefined}
        confirmLabel={t('settings.costItems.archiveConfirm')}
        cancelLabel={t('settings.common.cancel')}
        onConfirm={async () => {
          if (archiving && (await api('DELETE', `/cost-items/${archiving.id}`))) toast(t('settings.costItems.archived', { name: archiving.name }));
          setArchiving(null);
        }}
      />
    </>
  );
}

function CostItemDialog({ item, onClose }: { item?: CostItem; onClose: () => void }) {
  const t = useT();
  const api = useDocsApi();
  const [name, setName] = React.useState(item?.name ?? '');
  const [kind, setKind] = React.useState<CostItemKind>(item?.kind ?? 'expense');
  const [method, setMethod] = React.useState<CostDistribution>(item?.distributionMethod ?? 'none');
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const submit = async () => {
    if (!name.trim()) return setErr(t('settings.costItems.dialog.fields.nameRequired'));
    setBusy(true);
    const body = { name: name.trim(), kind, distributionMethod: kind === 'expense' ? method : 'none' };
    const r = item ? await api('PATCH', `/cost-items/${item.id}`, body) : await api('POST', '/cost-items', body);
    setBusy(false);
    if (!r) return;
    toast(item ? t('settings.costItems.saved', { name: body.name }) : t('settings.costItems.added', { name: body.name }));
    onClose();
  };
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={item ? t('settings.costItems.dialog.edit') : t('settings.costItems.dialog.new')}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">{t('settings.common.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              {item ? t('settings.costItems.dialog.save') : t('settings.costItems.dialog.create')}
            </Button>
          </>
        }
      >
        <form
          className="contents"
          noValidate
          onSubmit={e => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label={t('settings.costItems.dialog.fields.name')} error={err}>
            {p => <Input {...p} autoFocus value={name} onChange={e => (setName(e.target.value), setErr(''))} />}
          </Field>
          <Field label={t('settings.costItems.dialog.fields.kind')} hint={t('settings.costItems.dialog.fields.kindHint')}>
            {p => (
              <select className="select" id={p.id} value={kind} onChange={e => setKind(e.target.value as CostItemKind)}>
                <option value="expense">{enumLabel('costItem', 'expense', 'Expense')}</option>
                <option value="income">{enumLabel('costItem', 'income', 'Income')}</option>
              </select>
            )}
          </Field>
          {kind === 'expense' && (
            <Field label={t('settings.costItems.dialog.fields.method')} hint={t('settings.costItems.dialog.fields.methodHint')}>
              {p => (
                <select className="select" id={p.id} value={method} onChange={e => setMethod(e.target.value as CostDistribution)}>
                  {COST_DISTRIBUTIONS.map(m => (
                    <option key={m} value={m}>
                      {enumLabel('costDistribution', m, COST_DISTRIBUTION_LABELS[m])}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- склады ---------------- */

export function WarehousesSection({ title }: { title: string }) {
  const t = useT();
  const isAdmin = useIsAdmin();
  const list = useWarehouses();
  const settings = useInventorySettings();
  const api = useDocsApi();
  const [dialog, setDialog] = React.useState<{ wh?: Warehouse } | null>(null);
  const [archiving, setArchiving] = React.useState<Warehouse | null>(null);
  const items = (list.data ?? []).filter(w => !w.archivedAt);

  return (
    <>
      <SettingsHead title={title} lead={t('settings.warehouses.lead')} />
      <div className="sblock">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{t('settings.warehouses.title')}</h2>
          {isAdmin && (
            <Button size="sm" variant="primary" onClick={() => setDialog({})}>
              <Plus size={13} />
              {t('settings.warehouses.new')}
            </Button>
          )}
        </div>
        {list.isPending ? (
          <Skeleton w="100%" h={80} />
        ) : !items.length ? (
          <EmptyState icon={<WarehouseIcon size={20} />} title={t('settings.warehouses.empty.title')}>
            {t('settings.warehouses.empty.hint')}
          </EmptyState>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {items.map(w => (
              <div key={w.id} className="srow">
                <div style={{ minWidth: 0 }}>
                  <div className="t">
                    {w.name} {w.code && <span className="mono faint">{w.code}</span>} {w.isDefault && <Badge tone="accent">{t('settings.warehouses.default')}</Badge>} {w.kind !== 'warehouse' && <Badge tone="gray">{enumLabel('warehouseKind', w.kind, w.kind === 'workshop' ? 'Workshop' : 'In transit')}</Badge>} {w.counterpartyId && <Badge tone="accent">{t('settings.warehouses.counterparty')}</Badge>}
                  </div>
                  <div className="d">{w.address || t('settings.warehouses.noAddress')}</div>
                </div>
                {isAdmin && (
                  <div className="row" style={{ gap: 2 }}>
                    {!w.isDefault && (
                      <IconButton size="xs" label={t('settings.warehouses.makeDefault', { name: w.name })} onClick={() => void api('PATCH', `/warehouses/${w.id}`, { isDefault: true })}>
                        <Star size={14} />
                      </IconButton>
                    )}
                    <IconButton size="xs" label={t('settings.warehouses.edit', { name: w.name })} onClick={() => setDialog({ wh: w })}>
                      <Pencil size={14} />
                    </IconButton>
                    {!w.isDefault && (
                      <IconButton size="xs" label={t('settings.warehouses.archive', { name: w.name })} onClick={() => setArchiving(w)}>
                        <Archive size={14} />
                      </IconButton>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="sblock">
        <h2>{t('settings.warehouses.stockRules')}</h2>
        <SRow t={t('settings.warehouses.allowNegative.t')} d={t('settings.warehouses.allowNegative.d')}>
          <Toggle
            checked={settings.data?.allowNegativeStock ?? false}
            label={t('settings.warehouses.allowNegative.t')}
            onChange={v => void api('PATCH', '/stock/settings', { allowNegativeStock: v }).then(() => settings.refetch())}
            notify={t('settings.warehouses.stockRuleSaved')}
          />
        </SRow>
        {!isAdmin && (
          <Alert tone="info" className="mt-3">
            {t('settings.warehouses.onlyAdmins')}
          </Alert>
        )}
      </div>
      {dialog && <WarehouseDialog wh={dialog.wh} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={!!archiving}
        onOpenChange={o => !o && setArchiving(null)}
        danger
        title={t('settings.warehouses.archiveTitle')}
        description={archiving ? <><b>{archiving.name}</b> {t('settings.warehouses.archiveBody', { name: archiving.name })}</> : undefined}
        confirmLabel={t('settings.warehouses.archiveConfirm')}
        cancelLabel={t('settings.common.cancel')}
        onConfirm={async () => {
          if (archiving && (await api('DELETE', `/warehouses/${archiving.id}`))) toast(t('settings.warehouses.archived', { name: archiving.name }));
          setArchiving(null);
        }}
      />
    </>
  );
}

function WarehouseDialog({ wh, onClose }: { wh?: Warehouse; onClose: () => void }) {
  const t = useT();
  const api = useDocsApi();
  const companies = useCompanies();
  const [name, setName] = React.useState(wh?.name ?? '');
  const [code, setCode] = React.useState(wh?.code ?? '');
  const [address, setAddress] = React.useState(wh?.address ?? '');
  const [kind, setKind] = React.useState<WarehouseKind>(wh?.kind ?? 'warehouse');
  // склад контрагента: на стороне переработчика хранятся наши материалы, отданные ему в переработку
  const [counterpartyId, setCounterpartyId] = React.useState(wh?.counterpartyId ?? '');
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const submit = async () => {
    if (!name.trim()) return setErr(t('settings.warehouses.dialog.fields.nameRequired'));
    setBusy(true);
    const body = { name: name.trim(), code: code.trim(), address: address.trim(), kind, counterpartyId: counterpartyId || null };
    const r = wh ? await api('PATCH', `/warehouses/${wh.id}`, body) : await api('POST', '/warehouses', body);
    setBusy(false);
    if (!r) return;
    toast(wh ? t('settings.warehouses.saved', { name: body.name }) : t('settings.warehouses.added', { name: body.name }));
    onClose();
  };
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={wh ? t('settings.warehouses.dialog.edit') : t('settings.warehouses.dialog.new')}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">{t('settings.common.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              {wh ? t('settings.warehouses.dialog.save') : t('settings.warehouses.dialog.create')}
            </Button>
          </>
        }
      >
        <form
          className="contents"
          noValidate
          onSubmit={e => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label={t('settings.warehouses.dialog.fields.name')} error={err}>
            {p => <Input {...p} autoFocus value={name} onChange={e => (setName(e.target.value), setErr(''))} />}
          </Field>
          <Field label={t('settings.warehouses.dialog.fields.code')}>{p => <Input {...p} value={code} onChange={e => setCode(e.target.value)} />}</Field>
          <Field label={t('settings.warehouses.dialog.fields.address')}>{p => <Input {...p} value={address} onChange={e => setAddress(e.target.value)} />}</Field>
          <Field label={t('settings.warehouses.dialog.fields.kind')} hint={t('settings.warehouses.dialog.fields.kindHint')}>
            {p => (
              <select className="select" id={p.id} value={kind} onChange={e => setKind(e.target.value as WarehouseKind)}>
                <option value="warehouse">{enumLabel('warehouseKind', 'warehouse', 'Warehouse')}</option>
                <option value="workshop">{enumLabel('warehouseKind', 'workshop', 'Workshop')}</option>
                <option value="transit">{enumLabel('warehouseKind', 'transit', 'In transit')}</option>
              </select>
            )}
          </Field>
          <Field label={t('settings.warehouses.dialog.fields.counterparty')} hint={t('settings.warehouses.dialog.fields.counterpartyHint')}>
            {p => (
              <select className="select" id={p.id} value={counterpartyId} onChange={e => setCounterpartyId(e.target.value)}>
                <option value="">{t('settings.warehouses.dialog.fields.counterpartyNo')}</option>
                {(companies.data ?? []).map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}
