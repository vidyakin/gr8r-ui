/* Settings → Оператор → Арендаторы (docs/architecture/deploy.md): список арендаторов установки, создание пустого или демо,
   выгрузка архивом и удаление (выполняет воркер). Доступно только оператору (users.is_operator), API проверяет флаг сам. */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { Alert, Badge, Button, Checkbox, ConfirmDialog, EmptyState, Field, Input, Skeleton, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { fmtDateTimeIntl } from '@/i18n/format';
import { API_BASE, errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';
import { SettingsHead, SRow } from './parts';
import { TenantLicenseDialog } from './plans';

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  kind: 'regular' | 'demo';
  expires_at: string | null;
  delete_requested_at: string | null;
  owner_email: string | null;
  members: number;
}

interface Created {
  slug: string;
  ownerEmail: string;
  password: string | null;
}

const fmtDate = (d: string) => fmtDateTimeIntl(d, { dateStyle: 'medium' });

export function TenantsSection({ title }: { title: string }) {
  const t = useT();
  const ws = useWsId();
  const qc = useQueryClient();
  const queryKey = ['admin', 'tenants'] as const;
  const list = useQuery({ queryKey, queryFn: () => call<{ items: TenantRow[] }>(ws, 'GET', '/admin/tenants') });
  const [name, setName] = React.useState('');
  const [ownerEmail, setOwnerEmail] = React.useState('');
  const [ownerName, setOwnerName] = React.useState('');
  const [demo, setDemo] = React.useState(false);
  const [ttl, setTtl] = React.useState('14');
  const [busy, setBusy] = React.useState(false);
  const [created, setCreated] = React.useState<Created | null>(null);
  const [del, setDel] = React.useState<TenantRow | null>(null);
  const [licensing, setLicensing] = React.useState<TenantRow | null>(null);

  const create = async () => {
    setBusy(true);
    try {
      const body = { name, ownerEmail, ownerName: ownerName || undefined, demo, ttlDays: demo ? Number(ttl) || undefined : undefined };
      const res = await call<Created>(ws, 'POST', '/admin/tenants', body);
      setCreated(res);
      toast(t('settings.tenants.created', { slug: res.slug }));
      setName('');
      setOwnerEmail('');
      setOwnerName('');
      void qc.invalidateQueries({ queryKey });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Архив отдаётся файлом: скачиваем через blob, чтобы ушла cookie сессии
  const download = async (row: TenantRow) => {
    try {
      const res = await fetch(`${API_BASE()}/admin/tenants/${row.id}/export`, { credentials: 'include' });
      if (!res.ok) throw new Error(`${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement('a'), { href: url, download: `tenant-${row.slug}.gr8r.jsonl` });
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const items = list.data?.items ?? [];
  return (
    <>
      <SettingsHead title={title} lead={t('settings.tenants.lead')} />
      <div className="sblock">
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label={t('settings.tenants.name')}>{p => <Input {...p} maxLength={100} value={name} onChange={e => setName(e.target.value)} />}</Field>
          <Field label={t('settings.tenants.ownerEmail')}>{p => <Input {...p} type="email" maxLength={254} value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} />}</Field>
          <Field label={t('settings.tenants.ownerName')}>{p => <Input {...p} maxLength={100} value={ownerName} onChange={e => setOwnerName(e.target.value)} />}</Field>
        </div>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
          <label className="row" style={{ gap: 6 }}>
            <Checkbox checked={demo} onChange={e => setDemo(e.target.checked)} />
            {t('settings.tenants.demo')}
          </label>
          {demo && <Field label={t('settings.tenants.ttl')}>{p => <Input {...p} inputMode="numeric" style={{ width: 90 }} value={ttl} onChange={e => setTtl(e.target.value.replace(/\D/g, ''))} />}</Field>}
          <Button size="sm" disabled={busy || !name.trim() || !ownerEmail.includes('@')} onClick={create}>
            {t('settings.tenants.create')}
          </Button>
        </div>
        {created && (
          <Alert tone="ok" className="mt-3">
            {created.password ? t('settings.tenants.password', { email: created.ownerEmail, password: created.password }) : t('settings.tenants.existingOwner', { email: created.ownerEmail })}
          </Alert>
        )}
      </div>
      <div className="sblock">
        <h2>{title}</h2>
        {list.isPending ? (
          <Skeleton w="100%" h={60} />
        ) : list.isError ? (
          <Alert tone="danger">{errorMessage(list.error)}</Alert>
        ) : !items.length ? (
          <EmptyState icon={<Building2 size={20} />} title={t('settings.tenants.empty')} />
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {items.map(r => (
              <SRow
                key={r.id}
                t={
                  <>
                    {r.name} <span className="muted">{r.slug}</span> {r.kind === 'demo' && <Badge tone="violet">{t('settings.tenants.kindDemo')}</Badge>}
                  </>
                }
                d={[
                  r.owner_email ? t('settings.tenants.owner', { email: r.owner_email }) : null,
                  t('settings.tenants.members', { n: r.members }),
                  r.expires_at ? t('settings.tenants.expires', { date: fmtDate(r.expires_at) }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              >
                {r.delete_requested_at ? (
                  <Badge tone="amber">{t('settings.tenants.deleting')}</Badge>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setLicensing(r)}>{t('licensing.operator.license')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => download(r)}>{t('settings.tenants.export')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setDel(r)}>{t('settings.tenants.delete')}</Button>
                  </>
                )}
              </SRow>
            ))}
          </div>
        )}
      </div>
      <TenantLicenseDialog tenant={licensing} onClose={() => setLicensing(null)} />
      <ConfirmDialog
        open={!!del}
        onOpenChange={o => !o && setDel(null)}
        title={t('settings.tenants.delete')}
        description={del ? t('settings.tenants.confirmDelete', { name: del.name }) : ''}
        confirmLabel={t('settings.tenants.delete')}
        cancelLabel={t('settings.tenants.cancel')}
        danger
        onConfirm={async () => {
          if (del) {
            try {
              await call(ws, 'DELETE', `/admin/tenants/${del.id}`);
              toast(t('settings.tenants.deleteQueued'));
              void qc.invalidateQueries({ queryKey });
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
