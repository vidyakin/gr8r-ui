/* Settings → Organizations и Warehouses. Организации — собственные юрлица воркспейса (реквизиты, подписанты, налогообложение, печать и подписи
   ссылкой), склады — места хранения; здесь же настройка «разрешить отрицательный остаток». Меняет admin и выше. */
import * as React from 'react';
import { Archive, Building2, Pencil, Plus, Star, Tags, Warehouse as WarehouseIcon } from 'lucide-react';
import { COST_DISTRIBUTIONS, COST_DISTRIBUTION_LABELS, TAX_SYSTEMS, TAX_SYSTEM_LABELS, VAT_LABELS, VAT_RATES, type CostDistribution, type CostItemKind, type FileRef, type TaxSystem, type VatRate, type WarehouseKind } from '@gr8r/shared';
import { Alert, Badge, Button, ConfirmDialog, Dialog, DialogClose, DialogContent, EmptyState, Field, IconButton, Input, Skeleton, toast } from '@/components/ui';
import { useIsAdmin } from '../catalog/data';
import { BankAccountsEditor, RequisitesFields, checkRequisites, type RequisitesValue } from '../docs/requisites';
import { useCostItems, useDocsApi, useInventorySettings, useOrganizations, useWarehouses, type CostItem, type Organization, type Warehouse } from '../docs/data';
import { SettingsHead, SRow, Toggle } from './parts';

/* ---------------- организации ---------------- */

export function OrganizationsSection({ title }: { title: string }) {
  const isAdmin = useIsAdmin();
  const list = useOrganizations();
  const api = useDocsApi();
  const [dialog, setDialog] = React.useState<{ org?: Organization } | null>(null);
  const [archiving, setArchiving] = React.useState<Organization | null>(null);
  const orgs = (list.data ?? []).filter(o => !o.archivedAt);

  return (
    <>
      <SettingsHead title={title} lead="Your own legal entities. Documents are issued by an organization, and each organization numbers them separately." />
      {!isAdmin && (
        <Alert tone="info" className="mb-3">
          Only admins can change organizations.
        </Alert>
      )}
      <div className="sblock">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Organizations</h2>
          {isAdmin && (
            <Button size="sm" variant="primary" onClick={() => setDialog({})}>
              <Plus size={13} />
              New organization
            </Button>
          )}
        </div>
        {list.isPending ? (
          <Skeleton w="100%" h={80} />
        ) : !orgs.length ? (
          <EmptyState icon={<Building2 size={20} />} title="No organizations yet">
            Add the legal entity that issues invoices and shipments.
          </EmptyState>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {orgs.map(o => (
              <div key={o.id} className="srow org-row">
                <div style={{ minWidth: 0 }}>
                  <div className="t">
                    {o.name} {o.isDefault && <Badge tone="accent">Default</Badge>}
                  </div>
                  <div className="d">
                    {o.inn ? `INN ${o.inn}` : 'No INN yet'}
                    {o.kpp ? ` · KPP ${o.kpp}` : ''} · {TAX_SYSTEM_LABELS[o.taxSystem]} · VAT {VAT_LABELS[o.defaultVatRate]}
                  </div>
                </div>
                {isAdmin && (
                  <div className="row" style={{ gap: 2 }}>
                    {!o.isDefault && (
                      <IconButton size="xs" label={`Make ${o.name} the default`} onClick={() => void api('PATCH', `/organizations/${o.id}`, { isDefault: true })}>
                        <Star size={14} />
                      </IconButton>
                    )}
                    <IconButton size="xs" label={`Edit ${o.name}`} onClick={() => setDialog({ org: o })}>
                      <Pencil size={14} />
                    </IconButton>
                    {!o.isDefault && (
                      <IconButton size="xs" label={`Archive ${o.name}`} onClick={() => setArchiving(o)}>
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
        title="Archive organization?"
        description={archiving ? <><b>{archiving.name}</b> disappears from the lists. Documents it issued are kept.</> : undefined}
        confirmLabel="Archive"
        cancelLabel="Cancel"
        onConfirm={async () => {
          if (archiving && (await api('DELETE', `/organizations/${archiving.id}`))) toast(`Archived “${archiving.name}”`);
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
  return (
    <Field label={label} error={error} hint="Link to an image (https://… or a base64 image). Uploads arrive with file storage.">
      {p => <Input {...p} placeholder="https://…/stamp.png" value={value.url} onChange={e => onChange({ ...value, url: e.target.value })} />}
    </Field>
  );
}

function OrganizationDialog({ org, onClose }: { org?: Organization; onClose: () => void }) {
  const api = useDocsApi();
  const [f, setF] = React.useState({
    name: org?.name ?? '',
    fullName: org?.fullName ?? '',
    phone: org?.phone ?? '',
    email: org?.email ?? '',
    directorName: org?.directorName ?? '',
    directorTitle: org?.directorTitle ?? 'Генеральный директор',
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
    if (!f.name.trim()) errs.name = 'Enter a name';
    setErr(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const body = { ...f, name: f.name.trim(), fullName: f.fullName.trim() || f.name.trim(), ...req, stampFile: fileBody(stamp), directorSignatureFile: fileBody(dirSig), accountantSignatureFile: fileBody(accSig) };
    const r = org ? await api('PATCH', `/organizations/${org.id}`, body) : await api('POST', '/organizations', body);
    setBusy(false);
    if (!r) return;
    toast(org ? `Saved “${f.name.trim()}”` : `Added “${f.name.trim()}”`);
    onClose();
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        size="lg"
        title={org ? 'Edit organization' : 'New organization'}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              {org ? 'Save' : 'Create organization'}
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
          <Field label="Name" error={err.name} hint="Short name for lists and headers">
            {p => <Input {...p} autoFocus value={f.name} onChange={e => (setF({ ...f, name: e.target.value }), setErr(s => ({ ...s, name: '' })))} />}
          </Field>
          <Field label="Full name" hint="As it appears on invoices and shipments">
            {p => <Input {...p} value={f.fullName} placeholder={f.name} onChange={e => setF({ ...f, fullName: e.target.value })} />}
          </Field>
          <RequisitesFields value={req} errors={err} onChange={patch => (setReq(r => ({ ...r, ...patch })), setErr({}))} />
          <div className="row req-row">
            <Field label="Phone" className="grow">
              {p => <Input {...p} value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} />}
            </Field>
            <Field label="Email" className="grow">
              {p => <Input {...p} value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />}
            </Field>
          </div>
          <div className="row req-row">
            <Field label="Director" className="grow">
              {p => <Input {...p} value={f.directorName} onChange={e => setF({ ...f, directorName: e.target.value })} />}
            </Field>
            <Field label="Director's title" className="grow">
              {p => <Input {...p} value={f.directorTitle} onChange={e => setF({ ...f, directorTitle: e.target.value })} />}
            </Field>
            <Field label="Chief accountant" className="grow">
              {p => <Input {...p} value={f.accountantName} onChange={e => setF({ ...f, accountantName: e.target.value })} />}
            </Field>
          </div>
          <div className="row req-row">
            <Field label="Taxation" className="grow">
              {p => (
                <select className="select" id={p.id} value={f.taxSystem} onChange={e => setF({ ...f, taxSystem: e.target.value as TaxSystem })}>
                  {TAX_SYSTEMS.map(t => (
                    <option key={t} value={t}>
                      {TAX_SYSTEM_LABELS[t]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Default VAT rate" className="grow">
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
          <FileLink label="Stamp" value={stamp} onChange={setStamp} />
          <FileLink label="Director's signature" value={dirSig} onChange={setDirSig} />
          <FileLink label="Accountant's signature" value={accSig} onChange={setAccSig} />
          <SRow t="Default organization" d="New documents are issued by it unless you pick another.">
            <Toggle checked={f.isDefault} label="Default organization" onChange={v => setF({ ...f, isDefault: v })} />
          </SRow>
          <div className="field">
            <span className="label">Bank accounts</span>
            {org ? <BankAccountsEditor owner="organizations" ownerId={org.id} canEdit /> : <p className="faint" style={{ margin: 0 }}>Save the organization first, then add its bank accounts.</p>}
          </div>
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- статьи затрат и доходов ---------------- */

const COST_ITEM_KIND_LABEL: Record<CostItemKind, string> = { expense: 'Expense', income: 'Income' };
const WAREHOUSE_KIND_LABEL: Record<WarehouseKind, string> = { warehouse: 'Warehouse', workshop: 'Workshop', transit: 'In transit' };

/** Справочник статей затрат и доходов: списание пишется на статью затрат, оприходование — на статью доходов */
export function CostItemsSection({ title }: { title: string }) {
  const isAdmin = useIsAdmin();
  const list = useCostItems();
  const api = useDocsApi();
  const [dialog, setDialog] = React.useState<{ item?: CostItem } | null>(null);
  const [archiving, setArchiving] = React.useState<CostItem | null>(null);
  const items = (list.data ?? []).filter(c => !c.archivedAt);

  return (
    <>
      <SettingsHead title={title} lead="Cost and income items. A write-off needs an expense item, a posting needs an income item." />
      {!isAdmin && (
        <Alert tone="info" className="mb-3">
          Only admins can change cost items.
        </Alert>
      )}
      <div className="sblock">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Cost items</h2>
          {isAdmin && (
            <Button size="sm" variant="primary" onClick={() => setDialog({})}>
              <Plus size={13} />
              New cost item
            </Button>
          )}
        </div>
        {list.isPending ? (
          <Skeleton w="100%" h={80} />
        ) : !items.length ? (
          <EmptyState icon={<Tags size={20} />} title="No cost items yet">
            Add the items write-offs and postings are recorded against.
          </EmptyState>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {items.map(c => (
              <div key={c.id} className="srow">
                <div style={{ minWidth: 0 }}>
                  <div className="t">
                    {c.name} <Badge tone={c.kind === 'expense' ? 'gray' : 'accent'}>{COST_ITEM_KIND_LABEL[c.kind]}</Badge>
                    {c.kind === 'expense' && c.distributionMethod !== 'none' && <Badge tone="accent">{COST_DISTRIBUTION_LABELS[c.distributionMethod]}</Badge>}
                  </div>
                  <div className="d">
                    {c.kind === 'expense' ? (c.distributionMethod === 'none' ? 'Write-offs are recorded against this item; at closing it stays undistributed' : `Write-offs and service receipts go to indirect costs; at closing they are allocated ${COST_DISTRIBUTION_LABELS[c.distributionMethod].toLowerCase()}`) : 'Postings are recorded against this item'}
                  </div>
                </div>
                {isAdmin && (
                  <div className="row" style={{ gap: 2 }}>
                    <IconButton size="xs" label={`Edit ${c.name}`} onClick={() => setDialog({ item: c })}>
                      <Pencil size={14} />
                    </IconButton>
                    <IconButton size="xs" label={`Archive ${c.name}`} onClick={() => setArchiving(c)}>
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
        title="Archive cost item?"
        description={archiving ? <><b>{archiving.name}</b> disappears from the lists. Documents that used it keep it.</> : undefined}
        confirmLabel="Archive"
        cancelLabel="Cancel"
        onConfirm={async () => {
          if (archiving && (await api('DELETE', `/cost-items/${archiving.id}`))) toast(`Archived “${archiving.name}”`);
          setArchiving(null);
        }}
      />
    </>
  );
}

function CostItemDialog({ item, onClose }: { item?: CostItem; onClose: () => void }) {
  const api = useDocsApi();
  const [name, setName] = React.useState(item?.name ?? '');
  const [kind, setKind] = React.useState<CostItemKind>(item?.kind ?? 'expense');
  const [method, setMethod] = React.useState<CostDistribution>(item?.distributionMethod ?? 'none');
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const submit = async () => {
    if (!name.trim()) return setErr('Enter a name');
    setBusy(true);
    const body = { name: name.trim(), kind, distributionMethod: kind === 'expense' ? method : 'none' };
    const r = item ? await api('PATCH', `/cost-items/${item.id}`, body) : await api('POST', '/cost-items', body);
    setBusy(false);
    if (!r) return;
    toast(item ? `Saved “${body.name}”` : `Added “${body.name}”`);
    onClose();
  };
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={item ? 'Edit cost item' : 'New cost item'}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              {item ? 'Save' : 'Create cost item'}
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
          <Field label="Name" error={err}>
            {p => <Input {...p} autoFocus value={name} onChange={e => (setName(e.target.value), setErr(''))} />}
          </Field>
          <Field label="Kind" hint="Expenses are used by write-offs, income items by postings">
            {p => (
              <select className="select" id={p.id} value={kind} onChange={e => setKind(e.target.value as CostItemKind)}>
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
            )}
          </Field>
          {kind === 'expense' && (
            <Field label="Allocation base" hint="How the indirect costs of this item are split between the releases of the month">
              {p => (
                <select className="select" id={p.id} value={method} onChange={e => setMethod(e.target.value as CostDistribution)}>
                  {COST_DISTRIBUTIONS.map(m => (
                    <option key={m} value={m}>
                      {COST_DISTRIBUTION_LABELS[m]}
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
  const isAdmin = useIsAdmin();
  const list = useWarehouses();
  const settings = useInventorySettings();
  const api = useDocsApi();
  const [dialog, setDialog] = React.useState<{ wh?: Warehouse } | null>(null);
  const [archiving, setArchiving] = React.useState<Warehouse | null>(null);
  const items = (list.data ?? []).filter(w => !w.archivedAt);

  return (
    <>
      <SettingsHead title={title} lead="Places where goods are stored. Shipments and receipts move stock of the warehouse chosen in the document." />
      <div className="sblock">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Warehouses</h2>
          {isAdmin && (
            <Button size="sm" variant="primary" onClick={() => setDialog({})}>
              <Plus size={13} />
              New warehouse
            </Button>
          )}
        </div>
        {list.isPending ? (
          <Skeleton w="100%" h={80} />
        ) : !items.length ? (
          <EmptyState icon={<WarehouseIcon size={20} />} title="No warehouses yet">
            Add a warehouse to receive and ship goods.
          </EmptyState>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {items.map(w => (
              <div key={w.id} className="srow">
                <div style={{ minWidth: 0 }}>
                  <div className="t">
                    {w.name} {w.code && <span className="mono faint">{w.code}</span>} {w.isDefault && <Badge tone="accent">Default</Badge>} {w.kind !== 'warehouse' && <Badge tone="gray">{WAREHOUSE_KIND_LABEL[w.kind]}</Badge>}
                  </div>
                  <div className="d">{w.address || 'No address'}</div>
                </div>
                {isAdmin && (
                  <div className="row" style={{ gap: 2 }}>
                    {!w.isDefault && (
                      <IconButton size="xs" label={`Make ${w.name} the default`} onClick={() => void api('PATCH', `/warehouses/${w.id}`, { isDefault: true })}>
                        <Star size={14} />
                      </IconButton>
                    )}
                    <IconButton size="xs" label={`Edit ${w.name}`} onClick={() => setDialog({ wh: w })}>
                      <Pencil size={14} />
                    </IconButton>
                    {!w.isDefault && (
                      <IconButton size="xs" label={`Archive ${w.name}`} onClick={() => setArchiving(w)}>
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
        <h2>Stock rules</h2>
        <SRow t="Allow negative stock" d="Off by default: posting a shipment or a return to a supplier is refused when there is not enough stock. Turn on to let balances go below zero (average cost then restarts at the next receipt price).">
          <Toggle
            checked={settings.data?.allowNegativeStock ?? false}
            label="Allow negative stock"
            onChange={v => void api('PATCH', '/stock/settings', { allowNegativeStock: v }).then(() => settings.refetch())}
            notify="Stock rule saved"
          />
        </SRow>
        {!isAdmin && (
          <Alert tone="info" className="mt-3">
            Only admins can change warehouses and stock rules.
          </Alert>
        )}
      </div>
      {dialog && <WarehouseDialog wh={dialog.wh} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={!!archiving}
        onOpenChange={o => !o && setArchiving(null)}
        danger
        title="Archive warehouse?"
        description={archiving ? <><b>{archiving.name}</b> disappears from the lists. A warehouse that still holds stock cannot be archived.</> : undefined}
        confirmLabel="Archive"
        cancelLabel="Cancel"
        onConfirm={async () => {
          if (archiving && (await api('DELETE', `/warehouses/${archiving.id}`))) toast(`Archived “${archiving.name}”`);
          setArchiving(null);
        }}
      />
    </>
  );
}

function WarehouseDialog({ wh, onClose }: { wh?: Warehouse; onClose: () => void }) {
  const api = useDocsApi();
  const [name, setName] = React.useState(wh?.name ?? '');
  const [code, setCode] = React.useState(wh?.code ?? '');
  const [address, setAddress] = React.useState(wh?.address ?? '');
  const [kind, setKind] = React.useState<WarehouseKind>(wh?.kind ?? 'warehouse');
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const submit = async () => {
    if (!name.trim()) return setErr('Enter a name');
    setBusy(true);
    const body = { name: name.trim(), code: code.trim(), address: address.trim(), kind };
    const r = wh ? await api('PATCH', `/warehouses/${wh.id}`, body) : await api('POST', '/warehouses', body);
    setBusy(false);
    if (!r) return;
    toast(wh ? `Saved “${body.name}”` : `Added “${body.name}”`);
    onClose();
  };
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={wh ? 'Edit warehouse' : 'New warehouse'}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              {wh ? 'Save' : 'Create warehouse'}
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
          <Field label="Name" error={err}>
            {p => <Input {...p} autoFocus value={name} onChange={e => (setName(e.target.value), setErr(''))} />}
          </Field>
          <Field label="Code">{p => <Input {...p} value={code} onChange={e => setCode(e.target.value)} />}</Field>
          <Field label="Address">{p => <Input {...p} value={address} onChange={e => setAddress(e.target.value)} />}</Field>
          <Field label="Kind" hint="A workshop warehouse receives the materials of a work center; the transit warehouse is a service one">
            {p => (
              <select className="select" id={p.id} value={kind} onChange={e => setKind(e.target.value as WarehouseKind)}>
                <option value="warehouse">Warehouse</option>
                <option value="workshop">Workshop</option>
                <option value="transit">In transit</option>
              </select>
            )}
          </Field>
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}
