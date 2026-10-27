/* Settings → Integrations: подключения банковских счетов к API банков и ЮКассе (задача 1174д, docs/architecture/payments.md).
   Ключи вводятся здесь же и уходят в хранилище секретов (`<префикс>.<часть>`); значения не показываются. Только admin и owner. */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Landmark, Plus } from 'lucide-react';
import { CONNECTION_PROVIDERS, PROVIDER_SECRETS, type ConnectionProvider } from '@gr8r/shared';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, Field, Input, Select, Skeleton, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { fmtDateTime } from '@/i18n/format';
import { errorMessage } from '../data/api';
import { useOrganizations } from '../docs/data';
import { call, useWsId } from '../meta/data';
import { useOrgBankAccounts } from '../money/data';
import { SRow } from './parts';

type PartKey = 'token' | 'client_id' | 'client_secret' | 'refresh_token' | 'tls_cert' | 'tls_key' | 'shop_id' | 'secret_key';

interface Connection {
  id: string;
  bankAccountId: string;
  provider: ConnectionProvider;
  enabled: boolean;
  secretPrefix: string;
  syncFrom: string | null;
  autoPost: boolean;
  lastSyncAt: string | null;
  lastStatus: 'ok' | 'error' | null;
  lastError: string | null;
  lastResult: Record<string, number | string> | null;
  account: string;
  bankName: string;
  organization: string | null;
  ready: boolean;
  secrets: { part: string; key: string; required: boolean; present: boolean }[];
}

export function BankConnections({ secretsAvailable }: { secretsAvailable: boolean }) {
  const t = useT();
  const ws = useWsId();
  const qc = useQueryClient();
  const queryKey = ['ws', ws, 'bank-connections'] as const;
  const list = useQuery({ queryKey, staleTime: 10_000, queryFn: () => call<{ items: Connection[] }>(ws, 'GET', '/bank-connections') });
  const [adding, setAdding] = React.useState(false);
  const [del, setDel] = React.useState<Connection | null>(null);
  const [editKey, setEditKey] = React.useState<string | null>(null);
  const [value, setValue] = React.useState('');
  const refresh = () => {
    void qc.invalidateQueries({ queryKey });
    void qc.invalidateQueries({ queryKey: ['ws', ws, 'secrets'] });
  };
  const run = async (method: string, path: string, body?: unknown) => {
    try {
      const r = await call<Record<string, unknown>>(ws, method, path, body);
      refresh();
      return r;
    } catch (e) {
      toast.error(errorMessage(e));
      return null;
    }
  };
  const items = list.data?.items ?? [];
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  return (
    <div className="sblock" style={{ marginBottom: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <h2 style={{ margin: 0 }}>{t('secrets.bank.title')}</h2>
        <Button size="sm" variant="ghost" onClick={() => setAdding(a => !a)}>
          <Plus size={13} />
          {t('secrets.bank.add')}
        </Button>
      </div>
      <p className="faint" style={{ margin: '0 0 8px' }}>{t('secrets.bank.lead')}</p>
      {adding && (
        <AddForm
          onDone={async body => {
            if (await run('PUT', '/bank-connections', body)) setAdding(false);
          }}
        />
      )}
      {list.isPending ? (
        <Skeleton w="100%" h={60} />
      ) : !items.length && !adding ? (
        <EmptyState icon={<Landmark size={20} />} title={t('secrets.bank.empty')}>{t('secrets.bank.emptyHint')}</EmptyState>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {items.map(c => (
            <div key={c.id} className="srow" style={{ display: 'block' }}>
              <SRow
                t={
                  <>
                    {t(`secrets.bank.providers.${c.provider}`)} · {c.bankName} · {c.account}{' '}
                    {c.ready ? <Badge tone="green">{t('secrets.bank.ready')}</Badge> : <Badge tone="amber">{t('secrets.bank.needKeys')}</Badge>}
                    {c.lastStatus === 'error' && <Badge tone="red">{t('secrets.bank.statusError')}</Badge>}
                  </>
                }
                d={
                  c.provider === 'yookassa'
                    ? t('secrets.bank.yookassaHint')
                    : c.lastSyncAt
                      ? `${t('secrets.bank.lastSync', { date: fmtDateTime(c.lastSyncAt) })}${c.lastResult ? ` · ${t('secrets.bank.result', { fetched: c.lastResult.fetched ?? 0, created: c.lastResult.created ?? 0, posted: c.lastResult.posted ?? 0, duplicates: c.lastResult.duplicates ?? 0, unmatched: c.lastResult.unmatched ?? 0, failed: c.lastResult.failed ?? 0 })}` : ''}`
                      : t('secrets.bank.never')
                }
              >
                {c.provider !== 'yookassa' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!c.ready}
                    onClick={async () => {
                      const r = await run('POST', `/bank-connections/${c.id}/sync`);
                      if (r) toast(r.queued ? t('secrets.bank.queued') : t('secrets.bank.alreadyQueued'));
                    }}
                  >
                    {t('secrets.bank.syncNow')}
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => void run('PUT', '/bank-connections', { bankAccountId: c.bankAccountId, provider: c.provider, enabled: !c.enabled, secretPrefix: c.secretPrefix })}>
                  {c.enabled ? t('secrets.bank.enable') + ' ✓' : t('secrets.bank.enable')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDel(c)}>{t('secrets.bank.remove')}</Button>
              </SRow>
              {c.lastStatus === 'error' && c.lastError && <Alert tone="warn" className="mb-2">{c.lastError}</Alert>}
              <div className="stack" style={{ gap: 4, marginTop: 4 }}>
                {c.secrets.map(s => (
                  <div key={s.key} className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ minWidth: 220 }}>
                      {t(`secrets.bank.parts.${s.part as PartKey}`)} {!s.required && <span className="faint">({t('secrets.bank.optional')})</span>}
                    </span>
                    <Badge tone={s.present ? 'green' : 'gray'}>{s.present ? t('secrets.set') : t('secrets.bank.missing')}</Badge>
                    {editKey === s.key ? (
                      <>
                        <Input type="password" autoComplete="new-password" maxLength={8192} value={value} onChange={e => setValue(e.target.value)} aria-label={t(`secrets.bank.parts.${s.part as PartKey}`)} />
                        <Button
                          size="sm"
                          disabled={!value || !secretsAvailable}
                          onClick={async () => {
                            if (await run('PUT', `/secrets/${s.key}`, { value })) {
                              toast(t('secrets.bank.saved'));
                              setEditKey(null);
                              setValue('');
                            }
                          }}
                        >
                          {t('secrets.save')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setEditKey(null); setValue(''); }}>{t('secrets.cancel')}</Button>
                      </>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={!secretsAvailable} onClick={() => { setEditKey(s.key); setValue(''); }}>
                        {s.present ? t('secrets.replace') : t('secrets.set')}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              {c.provider === 'yookassa' && (
                <p className="faint" style={{ margin: '8px 0 0' }}>
                  {t('secrets.bank.webhook')}: <code>{`${origin}/hooks/yookassa/${ws}`}</code>
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!del}
        onOpenChange={o => !o && setDel(null)}
        title={t('secrets.bank.remove')}
        description={t('secrets.bank.confirmRemove')}
        confirmLabel={t('secrets.bank.remove')}
        cancelLabel={t('secrets.cancel')}
        danger
        onConfirm={async () => {
          if (del && (await run('DELETE', `/bank-connections/${del.id}`))) toast(t('secrets.bank.removed'));
          setDel(null);
        }}
      />
    </div>
  );
}

function AddForm({ onDone }: { onDone: (body: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const orgs = useOrganizations();
  const [orgId, setOrgId] = React.useState('');
  const [accountId, setAccountId] = React.useState('');
  const [provider, setProvider] = React.useState<ConnectionProvider>('tbank');
  const [syncFrom, setSyncFrom] = React.useState('');
  const organization = orgId || orgs.data?.[0]?.id;
  const accounts = useOrgBankAccounts(organization);
  const account = accountId || accounts.data?.[0]?.id || '';
  const spec = PROVIDER_SECRETS[provider];
  return (
    <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 8 }}>
      <Field label={t('secrets.bank.organization')}>
        {p => <Select id={p.id} value={organization ?? ''} onValueChange={v => { setOrgId(v); setAccountId(''); }} options={(orgs.data ?? []).map(o => ({ value: o.id, label: o.name }))} aria-label={t('secrets.bank.organization')} />}
      </Field>
      <Field label={t('secrets.bank.account')}>
        {p => <Select id={p.id} value={account} onValueChange={setAccountId} options={(accounts.data ?? []).map(b => ({ value: b.id, label: `${b.bankName} · ${b.account}` }))} aria-label={t('secrets.bank.account')} />}
      </Field>
      <Field label={t('secrets.bank.provider')}>
        {p => <Select id={p.id} value={provider} onValueChange={v => setProvider(v as ConnectionProvider)} options={CONNECTION_PROVIDERS.map(v => ({ value: v, label: t(`secrets.bank.providers.${v}`) }))} aria-label={t('secrets.bank.provider')} />}
      </Field>
      {provider !== 'yookassa' && <Field label={t('secrets.bank.syncFrom')}>{p => <Input {...p} type="date" value={syncFrom} onChange={e => setSyncFrom(e.target.value)} />}</Field>}
      <Button size="sm" disabled={!account || !spec} onClick={() => void onDone({ bankAccountId: account, provider, ...(provider !== 'yookassa' && syncFrom ? { syncFrom } : {}) })}>
        {t('secrets.bank.create')}
      </Button>
    </div>
  );
}
