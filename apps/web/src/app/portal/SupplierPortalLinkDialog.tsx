import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Link2 } from 'lucide-react';
import { Alert, Badge, Button, Dialog, DialogContent, DialogTrigger, Field, Input, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { useLicense } from '../licensing/data';
import { useCanWrite } from '../meta/custom-fields';
import { call, useWsId } from '../meta/data';

interface PortalLink {
  token: string;
  enabled: boolean;
  expiresAt: string | null;
}

export function SupplierPortalLinkButton({ companyId }: { companyId: string }) {
  const t = useT();
  const canWrite = useCanWrite();
  const module = useLicense().data?.states.trade.state;
  const [open, setOpen] = React.useState(false);
  if (!canWrite || !module || module === 'off') return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm"><Link2 size={14} aria-hidden />{t('supplierPortal.title')}</Button>
      </DialogTrigger>
      {open && <SupplierPortalLinkDialog companyId={companyId} canEdit={module === 'active'} />}
    </Dialog>
  );
}

function SupplierPortalLinkDialog({ companyId, canEdit }: { companyId: string; canEdit: boolean }) {
  const t = useT();
  const ws = useWsId();
  const client = useQueryClient();
  const [confirmRotation, setConfirmRotation] = React.useState(false);
  const [copyError, setCopyError] = React.useState(false);
  const key = ['ws', ws, 'supplier-portal', companyId] as const;
  const path = `/supplier-portal/companies/${companyId}/link`;
  const query = useQuery({
    queryKey: key,
    queryFn: () => call<{ link: PortalLink | null }>(ws, 'GET', path),
    gcTime: 0,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: (action: 'create' | 'enable' | 'disable' | 'rotate') => {
      if (action === 'rotate') return call<{ link: PortalLink }>(ws, 'POST', `${path}/rotate`);
      if (action === 'create') return call<{ link: PortalLink }>(ws, 'POST', path);
      return call<{ link: PortalLink }>(ws, 'PATCH', path, { enabled: action === 'enable' });
    },
    onSuccess: data => {
      client.setQueryData(key, data);
      setConfirmRotation(false);
      setCopyError(false);
    },
  });

  const link = query.data?.link;
  const expired = !!link?.expiresAt && new Date(link.expiresAt).getTime() <= Date.now();
  const url = link?.enabled && !expired ? `${window.location.origin}${import.meta.env.BASE_URL}#/s/${link.token}` : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopyError(false);
      toast(t('common.linkCopied'));
    } catch {
      setCopyError(true);
    }
  };

  return (
    <DialogContent title={t('supplierPortal.title')} description={t('supplierPortal.link.description')}>
      {query.isPending && <p role="status">{t('common.loading')}</p>}
      {query.isError && <Alert tone="danger" action={<Button size="sm" loading={query.isFetching} onClick={() => void query.refetch()}>{t('common.retry')}</Button>}>
        {errorMessage(query.error)}
      </Alert>}
      {query.isSuccess && <>
        <Badge tone={url ? 'green' : 'gray'} dot>
          {t(expired ? 'supplierPortal.link.expired' : url ? 'supplierPortal.link.enabled' : 'supplierPortal.link.disabled')}
        </Badge>
        {url && <Field label={t('supplierPortal.link.label')}>
          {props => <Input {...props} value={url} readOnly onFocus={e => e.target.select()} />}
        </Field>}
        {copyError && <Alert tone="warn">{t('supplierPortal.link.copyError')}</Alert>}
        {mutation.isError && <Alert tone="danger">{errorMessage(mutation.error)}</Alert>}
        {confirmRotation && <Alert tone="warn">{t('supplierPortal.link.rotateWarning')}</Alert>}
        <div className="flex flex-wrap gap-2">
          {confirmRotation ? (
            <>
              <Button type="button" variant="danger" loading={mutation.isPending} disabled={!canEdit} onClick={() => mutation.mutate('rotate')}>{t('supplierPortal.link.rotate')}</Button>
              <Button type="button" disabled={mutation.isPending} onClick={() => setConfirmRotation(false)}>{t('common.cancel')}</Button>
            </>
          ) : (
            <>
              {url && <Button type="button" variant="primary" disabled={mutation.isPending} onClick={() => void copy()}><Copy size={14} aria-hidden />{t('supplierPortal.link.copy')}</Button>}
              {canEdit && <Button type="button" loading={mutation.isPending} onClick={() => mutation.mutate(link ? link.enabled ? 'disable' : 'enable' : 'create')}>
                {t(link?.enabled ? 'supplierPortal.link.disable' : 'supplierPortal.link.enable')}
              </Button>}
              {canEdit && link && <Button type="button" variant="ghost" disabled={mutation.isPending} onClick={() => setConfirmRotation(true)}>{t('supplierPortal.link.rotate')}</Button>}
            </>
          )}
        </div>
      </>}
    </DialogContent>
  );
}
