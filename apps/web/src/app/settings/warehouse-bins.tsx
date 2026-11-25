import * as React from 'react';
import { Archive, Pencil, Plus, RotateCcw } from 'lucide-react';
import { warehouseBinCreate, warehouseBinUpdate } from '@erp/shared';
import { Button, ConfirmDialog, Dialog, DialogContent, Field, IconButton, Input, Select, Skeleton, Tab, Tabs, TabsContent, TabsList } from '@/components/ui';
import { fmtNumber, useT } from '@/i18n';
import { useUnits } from '../catalog/data';
import { useBinBalances, useDocsApi, useWarehouseBins, type Warehouse, type WarehouseBin } from '../docs/data';

const pageSize = 20;

export function WarehouseBinsDialog({ warehouse, editable, onClose }: { warehouse: Warehouse; editable: boolean; onClose: () => void }) {
  const t = useT();
  const bins = useWarehouseBins(warehouse.id);
  const balances = useBinBalances(warehouse.id);
  const units = useUnits();
  const api = useDocsApi();
  const [editing, setEditing] = React.useState<{ bin?: WarehouseBin } | null>(null);
  const [archiving, setArchiving] = React.useState<WarehouseBin | null>(null);
  const [reactivating, setReactivating] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState('all');
  const path = `/warehouses/${warehouse.id}/bins`;
  const labels = new Map(bins.data?.map(b => [b.id, b.code]));
  const unitLabels = new Map(units.data?.map(u => [u.code, u.symbol]));
  const balanceRows = (balances.data ?? []).filter(b => filter === 'all' || b.binId === filter);

  return (
    <>
      <Dialog open onOpenChange={open => !open && onClose()}>
        <DialogContent title={t('settings.warehouses.bins.title', { name: warehouse.name })} size="lg">
          <Tabs defaultValue="bins">
            <TabsList>
              <Tab value="bins">{t('settings.warehouses.bins.list')}</Tab>
              <Tab value="balances">{t('settings.warehouses.bins.balances')}</Tab>
            </TabsList>
            <TabsContent value="bins">
              {editable && (
                <div className="my-3">
                  <Button size="sm" variant="primary" disabled={bins.isPending || bins.isError} onClick={() => setEditing({})}>
                    <Plus size={14} /> {t('settings.warehouses.bins.add')}
                  </Button>
                </div>
              )}
              {bins.isPending ? <Skeleton w="100%" h={48} /> : bins.isError ? (
                <Button variant="secondary" onClick={() => void bins.refetch()}>{t('common.retry')}</Button>
              ) : (
                <PagedRows rows={bins.data ?? []} empty={t('settings.warehouses.bins.empty')}>
                  {bin => (
                    <div key={bin.id} className="srow">
                      <div className="min-w-0">
                        <div className="t break-words">{bin.code}{bin.name ? ` · ${bin.name}` : ''}</div>
                        <div className="d break-words">{[labels.get(bin.parentId ?? ''), bin.zone, bin.rack, bin.shelf, bin.cell].filter(Boolean).join(' / ')}</div>
                        {!bin.active && <div className="d">{t('common.inactive')}</div>}
                      </div>
                      {editable && (
                        <div className="row">
                          <IconButton size="xs" label={t('settings.warehouses.bins.edit', { code: bin.code })} onClick={() => setEditing({ bin })}><Pencil size={14} /></IconButton>
                          {bin.active ? (
                            <IconButton size="xs" label={t('settings.warehouses.bins.archive', { code: bin.code })} onClick={() => setArchiving(bin)}><Archive size={14} /></IconButton>
                          ) : (
                            <IconButton
                              size="xs"
                              label={t('settings.warehouses.bins.reactivate', { code: bin.code })}
                              disabled={reactivating !== null}
                              onClick={async () => {
                                setReactivating(bin.id);
                                await api('PATCH', `${path}/${bin.id}`, { active: true });
                                setReactivating(null);
                              }}
                            ><RotateCcw size={14} /></IconButton>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </PagedRows>
              )}
            </TabsContent>
            <TabsContent value="balances">
              <div className="my-3 max-w-xs">
                <Select
                  aria-label={t('settings.warehouses.bins.list')}
                  value={filter}
                  onValueChange={setFilter}
                  options={[{ value: 'all', label: t('common.all') }, ...(bins.data ?? []).map(bin => ({ value: bin.id, label: bin.code }))]}
                />
              </div>
              {balances.isPending ? <Skeleton w="100%" h={48} /> : balances.isError ? (
                <Button variant="secondary" onClick={() => void balances.refetch()}>{t('common.retry')}</Button>
              ) : (
                <PagedRows key={filter} rows={balanceRows} empty={t('settings.warehouses.bins.noBalances')}>
                  {row => (
                    <div key={`${row.binId}:${row.productId}`} className="srow">
                      <div className="min-w-0">
                        <div className="t break-words">{row.productName}</div>
                        <div className="d">{row.code}</div>
                      </div>
                      <span className="num">{fmtNumber(row.qty, { maximumFractionDigits: 3 })} {unitLabels.get(row.unitCode) ?? row.unitCode}</span>
                    </div>
                  )}
                </PagedRows>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
      {editing && <WarehouseBinEditor path={path} bin={editing.bin} bins={bins.data ?? []} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!archiving}
        onOpenChange={open => !open && setArchiving(null)}
        title={t('settings.warehouses.bins.archive', { code: archiving?.code ?? '' })}
        description={t('settings.warehouses.bins.archiveHint')}
        confirmLabel={t('settings.warehouses.bins.archiveConfirm')}
        cancelLabel={t('common.cancel')}
        onConfirm={async () => {
          if (archiving) await api('DELETE', `${path}/${archiving.id}`);
        }}
      />
    </>
  );
}

function PagedRows<T>({ rows, empty, children }: { rows: T[]; empty: string; children: (row: T) => React.ReactNode }) {
  const t = useT();
  const [page, setPage] = React.useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages - 1);
  return rows.length ? (
    <>
      <div className="srows-tight">{rows.slice(current * pageSize, (current + 1) * pageSize).map(children)}</div>
      {pages > 1 && (
        <div className="row mt-3 gap-2">
          <Button size="sm" variant="secondary" disabled={current === 0} onClick={() => setPage(current - 1)}>{t('common.previous')}</Button>
          <span className="muted">{t('settings.warehouses.bins.page', { page: fmtNumber(current + 1), total: fmtNumber(pages) })}</span>
          <Button size="sm" variant="secondary" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>{t('common.next')}</Button>
        </div>
      )}
    </>
  ) : <p className="muted">{empty}</p>;
}

const addressFields = ['zone', 'rack', 'shelf', 'cell'] as const;

function WarehouseBinEditor({ path, bin, bins, onClose }: { path: string; bin?: WarehouseBin; bins: WarehouseBin[]; onClose: () => void }) {
  const t = useT();
  const api = useDocsApi();
  const [form, setForm] = React.useState(() => ({
    code: bin?.code ?? '', name: bin?.name ?? '', zone: bin?.zone ?? '', rack: bin?.rack ?? '',
    shelf: bin?.shelf ?? '', cell: bin?.cell ?? '', parentId: bin?.parentId ?? null,
  }));
  const [invalid, setInvalid] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const formId = React.useId();
  const submit = async () => {
    if (busy) return;
    const parsed = (bin ? warehouseBinUpdate : warehouseBinCreate).safeParse(form);
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    setBusy(true);
    const result = await api(bin ? 'PATCH' : 'POST', bin ? `${path}/${bin.id}` : path, parsed.data);
    setBusy(false);
    if (result) onClose();
  };

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent
        title={bin ? t('settings.warehouses.bins.edit', { code: bin.code }) : t('settings.warehouses.bins.add')}
        footer={<>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form={formId} disabled={busy}>{t('common.save')}</Button>
        </>}
      >
        <form id={formId} className="grid gap-3" noValidate onSubmit={e => { e.preventDefault(); void submit(); }}>
          <Field label={t('settings.warehouses.dialog.fields.code')} error={invalid ? t('settings.warehouses.bins.codeRequired') : undefined}>
            {p => <Input {...p} autoFocus required maxLength={64} value={form.code} onChange={e => { setForm({ ...form, code: e.target.value }); setInvalid(false); }} />}
          </Field>
          <Field label={t('common.name')}>{p => <Input {...p} maxLength={100} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />}</Field>
          <Field label={t('settings.warehouses.bins.parent')}>
            {p => <Select
              {...p}
              value={form.parentId ?? 'none'}
              onValueChange={id => setForm({ ...form, parentId: id === 'none' ? null : id })}
              options={[{ value: 'none', label: '—' }, ...bins.filter(b => b.id !== bin?.id && (b.active || b.id === form.parentId)).map(b => ({ value: b.id, label: b.code, disabled: !b.active }))]}
            />}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            {addressFields.map(field => (
              <Field key={field} label={t(`settings.warehouses.bins.${field}`)}>
                {p => <Input {...p} maxLength={100} value={form[field]} onChange={e => setForm({ ...form, [field]: e.target.value })} />}
              </Field>
            ))}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
