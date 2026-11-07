/* Настройки → Доступ для агентов (задача 1285, docs/architecture/agent-tokens.md): токены доступа для агентов
   (MCP-клиенты, скрипты, ИИ) и служебные сотрудники. Токен работает от имени сотрудника и может только сузить
   его права: роль, должности и разделы остаются сотрудника. */
import * as React from 'react';
import { Copy, KeyRound, Plus, UserPlus } from 'lucide-react';
import { POSITION_SECTIONS, type PositionSection } from '@gr8r/shared';
import { Alert, Badge, Button, Checkbox, ConfirmDialog, Dialog, DialogClose, DialogContent, EmptyState, Field, Input, Select, Skeleton, Switch, toast } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/gr8r/data-table';
import { DateInput } from '@/components/gr8r/date-picker';
import { useT, fmtDateTime } from '@/i18n';
import { useIsAdmin } from '../catalog/data';
import { useSession } from '../data/session';
import { useWorkspace } from '../data/store';
import { usePositions } from '../positions/data';
import { SettingsHead } from './parts';
import { useApiTokens, useApiTokensApi, type ApiTokenCreated, type ApiTokenItem } from './agent-access-data';

const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

/** Статус токена: отозван, истёк по сроку или активен */
function tokenStatus(item: ApiTokenItem): 'active' | 'revoked' | 'expired' {
  if (item.revokedAt) return 'revoked';
  if (item.expiresAt && Date.parse(item.expiresAt) < Date.now()) return 'expired';
  return 'active';
}

/** Срок действия до конца выбранного дня (ISO) */
const endOfDay = (v: string) => `${v}T23:59:59.000Z`;

/* ---------- диалог выпуска токена ---------- */

function IssueTokenDialog({ open, onOpenChange, onIssued }: { open: boolean; onOpenChange: (o: boolean) => void; onIssued: (token: string) => void }) {
  const t = useT();
  const isAdmin = useIsAdmin();
  const session = useSession();
  const { data } = useWorkspace();
  const api = useApiTokensApi();
  const isGuest = session.active?.role === 'guest';
  const [name, setName] = React.useState('');
  const [memberId, setMemberId] = React.useState('');
  const [readOnly, setReadOnly] = React.useState(true);
  const [canPost, setCanPost] = React.useState(false);
  const [sections, setSections] = React.useState<PositionSection[]>([]);
  const [expiresAt, setExpiresAt] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const people = React.useMemo(() => (data.members ?? []).filter(m => m.status === 'active'), [data.members]);

  React.useEffect(() => {
    if (!open) return;
    setName('');
    setMemberId(data.me);
    setReadOnly(true);
    setCanPost(false);
    setSections([]);
    setExpiresAt('');
  }, [open, data.me]);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const body = {
      name: name.trim(),
      ...(isAdmin && memberId ? { memberId } : {}),
      readOnly,
      sections: sections.length ? sections : null,
      canPost: readOnly ? false : canPost,
      expiresAt: expiresAt ? endOfDay(expiresAt) : null,
    };
    const res = await api<ApiTokenCreated>('POST', '/api-tokens', body);
    setBusy(false);
    if (!res) return;
    onOpenChange(false);
    onIssued(res.token);
    toast(t('agentTokens.shown.title'));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('agentTokens.form.title')}
        description={t('agentTokens.form.lead')}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="ghost">{t('agentTokens.form.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={submit}>
              {t('agentTokens.form.create')}
            </Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <Field label={t('agentTokens.form.name')} hint={t('agentTokens.form.nameHint')}>
            {p => <Input {...p} maxLength={120} value={name} onChange={e => setName(e.target.value)} />}
          </Field>
          {isAdmin ? (
            <Field label={t('agentTokens.form.member')} hint={t('agentTokens.form.memberHint')}>
              {p => (
                <Select
                  id={p.id}
                  value={memberId || data.me}
                  onValueChange={setMemberId}
                  aria-label={t('agentTokens.form.member')}
                  options={people.map(m => ({ value: m.id, label: m.id === data.me ? t('agentTokens.form.memberSelf', { name: m.name }) : m.name }))}
                />
              )}
            </Field>
          ) : (
            <Alert tone="info">{t('agentTokens.onlySelf')}</Alert>
          )}
          <label className="row" style={{ gap: 8 }}>
            <Switch checked={readOnly} disabled={isGuest} onChange={e => setReadOnly(e.target.checked)} aria-label={t('agentTokens.form.readOnly')} />
            <span>
              {t('agentTokens.form.readOnly')}
              <span className="faint" style={{ display: 'block', fontSize: 12 }}>
                {t('agentTokens.form.readOnlyHint')}
              </span>
            </span>
          </label>
          <label className="row" style={{ gap: 8, opacity: readOnly ? 0.55 : 1 }}>
            <Switch checked={!readOnly && canPost} disabled={readOnly || isGuest} onChange={e => setCanPost(e.target.checked)} aria-label={t('agentTokens.form.canPost')} />
            <span>
              {t('agentTokens.form.canPost')}
              <span className="faint" style={{ display: 'block', fontSize: 12 }}>
                {t('agentTokens.form.canPostHint')}
              </span>
            </span>
          </label>
          {isGuest && <Alert tone="info">{t('agentTokens.guestReadOnly')}</Alert>}
          <div>
            <div className="label" style={{ marginBottom: 4 }}>
              {t('agentTokens.form.sections')}
            </div>
            <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
              {POSITION_SECTIONS.map(s => (
                <label key={s} className="row" style={{ gap: 6, fontSize: 13 }}>
                  <Checkbox checked={sections.includes(s)} onChange={() => setSections(toggle(sections, s))} aria-label={t(`positions.section.${s}`)} />
                  {t(`positions.section.${s}`)}
                </label>
              ))}
            </div>
            <p className="faint" style={{ fontSize: 12, margin: '4px 0 0' }}>
              {t('agentTokens.form.sectionsHint')}
            </p>
          </div>
          <Field label={t('agentTokens.form.expires')} hint={t('agentTokens.form.expiresHint')}>
            {p => <DateInput id={p.id} value={expiresAt} onChange={setExpiresAt} aria-label={t('agentTokens.form.expires')} aria-describedby={p['aria-describedby']} />}
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- окно с готовым токеном (показывается один раз) ---------- */

function IssuedTokenDialog({ token, onClose }: { token: string | null; onClose: () => void }) {
  const t = useT();
  const session = useSession();
  const wsId = session.active?.id ?? '';
  const copy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      toast(t('agentTokens.shown.copied'));
    } catch {
      toast.error(t('agentTokens.shown.copyFailed'));
    }
  };
  return (
    <Dialog open={!!token} onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={t('agentTokens.shown.title')}
        description={t('agentTokens.shown.lead')}
        footer={
          <>
            <Button variant="ghost" onClick={copy}>
              <Copy size={14} />
              {t('agentTokens.shown.copy')}
            </Button>
            <span className="sp" />
            <Button variant="primary" onClick={onClose}>
              {t('agentTokens.shown.close')}
            </Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <Alert tone="warn">{t('agentTokens.shown.warn')}</Alert>
          <Field label={t('agentTokens.shown.token')}>
            {p => <Input {...p} readOnly value={token ?? ''} onFocus={e => e.currentTarget.select()} />}
          </Field>
          <div>
            <div className="label" style={{ marginBottom: 4 }}>
              {t('agentTokens.shown.example')}
            </div>
            <pre className="code">{`Authorization: Bearer ${token ?? ''}\nX-Workspace-Id: ${wsId}`}</pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- служебный сотрудник ---------- */

function ServiceMemberDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const api = useApiTokensApi();
  const positions = usePositions();
  const [name, setName] = React.useState('');
  const [role, setRole] = React.useState<'member' | 'guest'>('member');
  const [positionIds, setPositionIds] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName('');
    setRole('member');
    setPositionIds([]);
  }, [open]);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const res = await api<{ memberId: string }>('POST', '/api-tokens/service-members', { name: name.trim(), role, positionIds });
    setBusy(false);
    if (!res) return;
    onOpenChange(false);
    toast(t('agentTokens.service.created'));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('agentTokens.service.title')}
        description={t('agentTokens.service.lead')}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="ghost">{t('agentTokens.form.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={submit}>
              {t('agentTokens.service.create')}
            </Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <Field label={t('agentTokens.service.name')} hint={t('agentTokens.service.nameHint')}>
            {p => <Input {...p} maxLength={120} value={name} onChange={e => setName(e.target.value)} />}
          </Field>
          <Field label={t('agentTokens.service.role')}>
            {p => (
              <Select
                id={p.id}
                value={role}
                onValueChange={v => setRole(v as 'member' | 'guest')}
                aria-label={t('agentTokens.service.role')}
                options={[
                  { value: 'member', label: t('agentTokens.service.roleMember') },
                  { value: 'guest', label: t('agentTokens.service.roleGuest') },
                ]}
              />
            )}
          </Field>
          <div>
            <div className="label" style={{ marginBottom: 4 }}>
              {t('agentTokens.service.positions')}
            </div>
            <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
              {(positions.data ?? []).map(p => (
                <label key={p.id} className="row" style={{ gap: 6, fontSize: 13 }}>
                  <Checkbox checked={positionIds.includes(p.id)} onChange={() => setPositionIds(toggle(positionIds, p.id))} aria-label={p.name} />
                  {p.name}
                </label>
              ))}
            </div>
            <p className="faint" style={{ fontSize: 12, margin: '4px 0 0' }}>
              {t('agentTokens.service.positionsHint')}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- экран ---------- */

export function AgentAccessSection({ title }: { title: string }) {
  const t = useT();
  const isAdmin = useIsAdmin();
  const tokens = useApiTokens();
  const api = useApiTokensApi();
  const [issueOpen, setIssueOpen] = React.useState(false);
  const [serviceOpen, setServiceOpen] = React.useState(false);
  const [issued, setIssued] = React.useState<string | null>(null);
  const [revoke, setRevoke] = React.useState<ApiTokenItem | null>(null);

  const rows = tokens.data ?? [];

  const columns = React.useMemo<Column<ApiTokenItem>[]>(
    () => [
      {
        id: 'name',
        header: t('agentTokens.col.name'),
        width: 200,
        value: r => r.name,
        cell: r => (
          <div className="trunc" title={r.name}>
            {r.name}
          </div>
        ),
      },
      { id: 'member', header: t('agentTokens.col.member'), width: 160, value: r => r.memberName, cell: r => r.memberName || '—' },
      {
        id: 'rights',
        header: t('agentTokens.col.rights'),
        width: 190,
        value: r => (r.readOnly ? 'ro' : r.canPost ? 'rwp' : 'rw'),
        cell: r => (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Badge tone={r.readOnly ? 'neutral' : 'green'}>{r.readOnly ? t('agentTokens.rights.readOnly') : t('agentTokens.rights.write')}</Badge>
            {!r.readOnly && r.canPost && <Badge tone="violet">{t('agentTokens.rights.canPost')}</Badge>}
          </div>
        ),
      },
      {
        id: 'sections',
        header: t('agentTokens.col.sections'),
        width: 200,
        value: r => (r.sections ?? []).join(','),
        cell: r => <span className="trunc">{r.sections?.length ? r.sections.map(s => t(`positions.section.${s}`)).join(', ') : t('agentTokens.sections.all')}</span>,
      },
      {
        id: 'expires',
        header: t('agentTokens.col.expires'),
        width: 160,
        value: r => r.expiresAt ?? '',
        cell: r => <span className="muted">{r.expiresAt ? fmtDateTime(r.expiresAt) : t('agentTokens.noExpiry')}</span>,
      },
      {
        id: 'lastUsed',
        header: t('agentTokens.col.lastUsed'),
        width: 170,
        value: r => r.lastUsedAt ?? '',
        cell: r => <span className="muted">{r.lastUsedAt ? fmtDateTime(r.lastUsedAt) : t('agentTokens.neverUsed')}</span>,
      },
      {
        id: 'status',
        header: t('agentTokens.col.status'),
        width: 110,
        value: r => tokenStatus(r),
        cell: r => {
          const s = tokenStatus(r);
          return <Badge tone={s === 'active' ? 'green' : s === 'revoked' ? 'red' : 'amber'}>{t(`agentTokens.status.${s}`)}</Badge>;
        },
      },
      {
        id: 'actions',
        header: t('agentTokens.col.actions'),
        width: 110,
        align: 'right',
        cell: r =>
          r.revokedAt ? null : (
            <Button size="sm" variant="ghost" onClick={() => setRevoke(r)}>
              {t('agentTokens.revoke')}
            </Button>
          ),
      },
    ],
    [t],
  );
  const table = useDataTable(columns);

  return (
    <>
      <SettingsHead title={title} lead={t('agentTokens.lead')} />
      <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Button variant="primary" onClick={() => setIssueOpen(true)}>
          <Plus size={14} />
          {t('agentTokens.issue')}
        </Button>
        {isAdmin && (
          <Button variant="secondary" onClick={() => setServiceOpen(true)}>
            <UserPlus size={14} />
            {t('agentTokens.service.add')}
          </Button>
        )}
      </div>
      {!isAdmin && <Alert tone="info" className="mb-3">{t('agentTokens.onlySelf')}</Alert>}
      {tokens.isPending ? (
        <Skeleton w="100%" h={60} />
      ) : tokens.isError ? (
        <EmptyState icon={<KeyRound size={20} />} error title={t('common.unknownError')} action={<Button size="sm" onClick={() => void tokens.refetch()}>{t('common.retry')}</Button>}>
          {(tokens.error as Error)?.message}
        </EmptyState>
      ) : (
        <DataTable
          aria-label={t('agentTokens.table')}
          columns={columns}
          rows={rows}
          table={table}
          getId={r => r.id}
          empty={
            <EmptyState icon={<KeyRound size={20} />} title={t('agentTokens.empty')}>
              {t('agentTokens.emptyHint')}
            </EmptyState>
          }
        />
      )}
      <IssueTokenDialog open={issueOpen} onOpenChange={setIssueOpen} onIssued={setIssued} />
      <IssuedTokenDialog token={issued} onClose={() => setIssued(null)} />
      <ServiceMemberDialog open={serviceOpen} onOpenChange={setServiceOpen} />
      <ConfirmDialog
        open={!!revoke}
        onOpenChange={o => !o && setRevoke(null)}
        title={t('agentTokens.revoke')}
        description={revoke ? t('agentTokens.revokeConfirm', { name: revoke.name }) : ''}
        confirmLabel={t('agentTokens.revoke')}
        cancelLabel={t('agentTokens.form.cancel')}
        danger
        onConfirm={async () => {
          if (revoke && (await api('DELETE', `/api-tokens/${revoke.id}`))) toast(t('agentTokens.revoked'));
          setRevoke(null);
        }}
      />
    </>
  );
}
