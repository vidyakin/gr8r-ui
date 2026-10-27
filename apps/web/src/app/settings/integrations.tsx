/* Settings → Integrations (задача 1174а, docs/architecture/secrets.md): хранилище секретов воркспейса.
   Значение вводится один раз и больше не показывается; список — имя, дата, замена и удаление. Только admin и owner. */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus } from 'lucide-react';
import { SECRET_KEY_RE } from '@gr8r/shared';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, Field, Input, Skeleton, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { fmtDateTime } from '@/i18n/format';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';
import { useIsAdmin } from '../catalog/data';
import { BankConnections } from './bank-connections';
import { SettingsHead, SRow } from './parts';

interface SecretItem {
  key: string;
  updatedAt: string;
}

export function IntegrationsSection({ title }: { title: string }) {
  const t = useT();
  const ws = useWsId();
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  const queryKey = ['ws', ws, 'secrets'] as const;
  const list = useQuery({ queryKey, enabled: isAdmin, staleTime: Infinity, queryFn: () => call<{ available: boolean; items: SecretItem[] }>(ws, 'GET', '/secrets') });
  const [editing, setEditing] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState('');
  const [value, setValue] = React.useState('');
  const [del, setDel] = React.useState<SecretItem | null>(null);

  const run = async (method: string, path: string, body?: unknown) => {
    try {
      await call(ws, method, path, body);
      void qc.invalidateQueries({ queryKey });
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    }
  };
  const close = () => {
    setEditing(null);
    setAdding(false);
    setName('');
    setValue('');
  };
  const items = list.data?.items ?? [];
  const available = list.data?.available ?? true;

  const form = (key: string | null) => (
    <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
      {key === null && (
        <Field label={t('secrets.name')} hint={t('secrets.nameHint')}>
          {p => <Input {...p} maxLength={64} value={name} onChange={e => setName(e.target.value.toLowerCase())} />}
        </Field>
      )}
      <Field label={t('secrets.value')}>{p => <Input {...p} type="password" autoComplete="new-password" maxLength={8192} value={value} onChange={e => setValue(e.target.value)} />}</Field>
      <Button
        size="sm"
        disabled={!value || !available || (key === null && !SECRET_KEY_RE.test(name))}
        onClick={async () => {
          if (await run('PUT', `/secrets/${key ?? name}`, { value })) {
            toast(t('secrets.saved'));
            close();
          }
        }}
      >
        {t('secrets.save')}
      </Button>
      <Button size="sm" variant="ghost" onClick={close}>{t('secrets.cancel')}</Button>
    </div>
  );

  return (
    <>
      <SettingsHead title={title} lead={t('secrets.lead')} />
      {!isAdmin ? (
        <Alert tone="info" className="mb-3">{t('secrets.onlyAdmins')}</Alert>
      ) : (
        <>
        <BankConnections secretsAvailable={available} />
        <div className="sblock">
          {!available && <Alert tone="warn" className="mb-3">{t('secrets.unavailable')}</Alert>}
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>{title}</h2>
            <Button size="sm" variant="ghost" disabled={!available} onClick={() => { close(); setAdding(true); }}>
              <Plus size={13} />
              {t('secrets.add')}
            </Button>
          </div>
          {list.isPending ? (
            <Skeleton w="100%" h={60} />
          ) : !items.length && !adding ? (
            <EmptyState icon={<KeyRound size={20} />} title={t('secrets.empty')}>{t('secrets.emptyHint')}</EmptyState>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {adding && <div className="srow" style={{ display: 'block' }}>{form(null)}</div>}
              {items.map(s => (
                <div key={s.key} className="srow" style={{ display: 'block' }}>
                  <SRow t={<>{s.key} <Badge>{t('secrets.set')}</Badge></>} d={t('secrets.updated', { date: fmtDateTime(s.updatedAt) })}>
                    <Button size="sm" variant="ghost" onClick={() => { const open = editing === s.key; close(); if (!open) setEditing(s.key); }}>{t('secrets.replace')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setDel(s)}>{t('secrets.delete')}</Button>
                  </SRow>
                  {editing === s.key && form(s.key)}
                </div>
              ))}
            </div>
          )}
        </div>
        </>
      )}
      <ConfirmDialog
        open={!!del}
        onOpenChange={o => !o && setDel(null)}
        title={t('secrets.delete')}
        description={del ? t('secrets.confirmDelete', { key: del.key }) : ''}
        confirmLabel={t('secrets.delete')}
        cancelLabel={t('secrets.cancel')}
        danger
        onConfirm={async () => {
          if (del && (await run('DELETE', `/secrets/${del.key}`))) toast(t('secrets.deleted'));
          setDel(null);
        }}
      />
    </>
  );
}
