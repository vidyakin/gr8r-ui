import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';
import { IC_CONFLICT_POLICIES, IC_SOURCES, icChannelCreate, type IcChannelCreate, type IcSyncIssue } from '@erp/shared';
import { NumberField } from '@/components/erp/number-field';
import { Alert, Badge, Button, Checkbox, Choice, ConfirmDialog, Field, Input, Select, Skeleton, toast } from '@/components/ui';
import { hasKey, useT } from '@/i18n';
import { fmtDateTime, fmtNumber } from '@/i18n/format';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';
import { IcReportTable, type IcApi } from './enterprise-data-upload';

type Channels = InferResponseType<IcApi['channels']['$get'], 200>;
type Channel = Channels[number];
type Runs = InferResponseType<IcApi['channels'][':id']['runs']['$get'], 200>;
const channelsPath = '/integrations/1c/channels';
const queryKeyOf = (ws: string) => ['ws', ws, 'ic-sync'] as const;

export function Sync1c({ secretsAvailable }: { secretsAvailable: boolean }) {
  const ws = useWsId();
  return <ChannelsSection key={ws} ws={ws} secretsAvailable={secretsAvailable} />;
}

function ChannelsSection({ ws, secretsAvailable }: { ws: string; secretsAvailable: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const queryKey = queryKeyOf(ws);
  const channels = useQuery({ queryKey, queryFn: () => call<Channels>(ws, 'GET', channelsPath) });
  const [editor, setEditor] = useState<Channel | 'new' | null>(null);
  const [journal, setJournal] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Channel | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const action = useMutation({
    mutationFn: async ({ kind, id }: { kind: 'sync' | 'delete'; id: string }) => {
      if (kind === 'sync') return call<{ queued: boolean }>(ws, 'POST', `${channelsPath}/${id}/sync`);
      await call(ws, 'DELETE', `${channelsPath}/${id}`);
      return null;
    },
    onSuccess: (result, { id, kind }) => {
      if (kind === 'sync') {
        setJournal(id);
        toast(t(result?.queued ? 'icSync.queued' : 'icSync.alreadyQueued'));
      } else {
        if (journal === id) setJournal(null);
        if (editor && editor !== 'new' && editor.id === id) setEditor(null);
        setDeleteTarget(null);
      }
      void refresh();
    },
    onError: error => toast.error(errorMessage(error)),
  });
  const availableSources = IC_SOURCES.filter(source => !channels.data?.some(channel => channel.source === source));
  const selected = channels.data?.find(channel => channel.id === journal);
  return (
    <section className="sblock">
      <div className="row flex-wrap justify-between gap-2">
        <h2>{t('icSync.title')}</h2>
        <Button size="sm" variant="secondary" disabled={!secretsAvailable || !availableSources.length || !channels.data}
          onClick={() => setEditor('new')}>{t('icSync.add')}</Button>
      </div>
      {!secretsAvailable && <Alert tone="warn">{t('secrets.unavailable')}</Alert>}
      {channels.isPending && <Skeleton w="100%" h={60} />}
      {channels.isError && <Alert tone="warn">{errorMessage(channels.error)}</Alert>}
      {channels.data?.length === 0 && !editor && <p className="muted">{t('icSync.empty')}</p>}
      {channels.data?.map(channel => (
        <div key={channel.id} className="srow flex-wrap gap-3">
          <div className="min-w-0">
            <div className="row flex-wrap gap-2">
              <strong>{t(`icLinks.sources.${channel.source}`)} · {channel.nodeName}</strong>
              <Badge tone={channel.enabled ? 'green' : 'neutral'}>{t(channel.enabled ? 'icSync.enabled' : 'icSync.disabled')}</Badge>
            </div>
            <div className="muted break-all">{channel.endpointUrl}</div>
            <div className="muted">{t('icSync.counters', {
              sent: fmtNumber(channel.lastSentMessageNo), received: fmtNumber(channel.lastReceivedMessageNo),
              acked: fmtNumber(channel.ackedSentMessageNo),
            })}</div>
            {channel.lastSyncAt && <div className="muted">{t('icSync.lastRun', { date: fmtDateTime(channel.lastSyncAt) })}</div>}
            {channel.pendingBlocked && <Alert tone="warn">{t('icSync.pendingBlocked')}</Alert>}
          </div>
          <div className="row flex-wrap gap-2">
            <Button size="sm" variant="primary" disabled={action.isPending}
              onClick={() => action.mutate({ kind: 'sync', id: channel.id })}>{t('icSync.syncNow')}</Button>
            <Button size="sm" variant="ghost" aria-expanded={journal === channel.id}
              onClick={() => setJournal(journal === channel.id ? null : channel.id)}>{t('icSync.journal')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditor(channel)}>{t('icSync.edit')}</Button>
            <Button size="sm" variant="ghost" disabled={action.isPending} onClick={() => setDeleteTarget(channel)}>{t('icSync.delete')}</Button>
          </div>
        </div>
      ))}
      {editor && <ChannelForm key={editor === 'new' ? 'new' : editor.id} ws={ws}
        current={editor === 'new' ? undefined : editor} sources={availableSources} secretsAvailable={secretsAvailable}
        onCancel={() => setEditor(null)} onSaved={() => { setEditor(null); void refresh(); }} />}
      {selected && <ChannelJournal key={selected.id} ws={ws} channel={selected} />}
      <ConfirmDialog open={!!deleteTarget} onOpenChange={open => { if (!open && !action.isPending) setDeleteTarget(null); }}
        title={t('icSync.delete')} description={t('icSync.confirmDelete', { name: deleteTarget?.nodeName ?? '' })}
        confirmLabel={t('icSync.delete')} cancelLabel={t('icSync.cancel')} danger
        onConfirm={async () => { if (deleteTarget) await action.mutateAsync({ kind: 'delete', id: deleteTarget.id }).catch(() => {}); }} />
    </section>
  );
}

function ChannelForm({ ws, current, sources, secretsAvailable, onCancel, onSaved }: {
  ws: string;
  current?: Channel;
  sources: readonly IcChannelCreate['source'][];
  secretsAvailable: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [form, setForm] = useState<IcChannelCreate>(() => ({
    source: current?.source ?? sources[0] ?? 'buh3',
    endpointUrl: current?.endpointUrl ?? '', nodeName: current?.nodeName ?? '', localNodeName: current?.localNodeName ?? 'ERP',
    authType: current?.authType ?? 'basic', username: current?.username ?? '', secret: '',
    intervalMinutes: current?.intervalMinutes ?? 60, enabled: current?.enabled ?? false,
    conflictPolicy: current?.conflictPolicy ?? '1c_wins', version: current?.version ?? '1.17',
  }));
  const set = <K extends keyof IcChannelCreate,>(key: K, value: IcChannelCreate[K]) => setForm(previous => ({ ...previous, [key]: value }));
  const save = useMutation({
    mutationFn: (value: IcChannelCreate) => {
      if (!current) return call<Channel>(ws, 'POST', channelsPath, value);
      const { source, secret, ...patch } = value;
      return call<Channel>(ws, 'PATCH', `${channelsPath}/${current.id}`, { ...patch, ...(form.secret ? { secret } : {}) });
    },
    onSuccess: onSaved,
  });
  const [submitted, setSubmitted] = useState(false);
  const needsSecret = !current?.hasSecret || current.authType !== form.authType;
  const validation = icChannelCreate.safeParse({
    ...form, username: form.authType === 'basic' ? form.username : null,
    secret: form.secret || (needsSecret ? '' : 'existing'),
  });
  const lockedNodes = !!(current?.lastSentMessageNo || current?.lastReceivedMessageNo);
  const pendingPacket = !!current && current.lastSentMessageNo > current.ackedSentMessageNo;
  const formError = (key: 'endpointUrl' | 'nodeName' | 'localNodeName' | 'username' | 'secret' | 'intervalMinutes') => submitted && !validation.success && validation.error.issues.some(issue => issue.path[0] === key)
    ? t(`icSync.validation.${key}`) : undefined;
  return (
    <form className="stack gap-3 border-t pt-3" onSubmit={event => {
      event.preventDefault();
      setSubmitted(true);
      if (validation.success) save.mutate(validation.data);
    }}>
      <h3>{t(current ? 'icSync.edit' : 'icSync.add')}</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t('icLinks.source')}>{p => <Select id={p.id} value={form.source} disabled={!!current || save.isPending}
          options={(current ? [current.source] : sources).map(value => ({ value, label: t(`icLinks.sources.${value}`) }))}
          onValueChange={value => set('source', value as IcChannelCreate['source'])} />}</Field>
        <Field label={t('icSync.endpoint')} error={formError('endpointUrl')}>{p => <Input {...p} type="url" autoComplete="off"
          disabled={save.isPending || pendingPacket} value={form.endpointUrl} onChange={event => set('endpointUrl', event.target.value)} />}</Field>
        <Field label={t('icSync.node')} error={formError('nodeName')}>{p => <Input {...p} maxLength={100}
          disabled={save.isPending || lockedNodes} value={form.nodeName} onChange={event => set('nodeName', event.target.value)} />}</Field>
        <Field label={t('icSync.localNode')} error={formError('localNodeName')}>{p => <Input {...p} maxLength={100}
          disabled={save.isPending || lockedNodes} value={form.localNodeName} onChange={event => set('localNodeName', event.target.value)} />}</Field>
        <Field label={t('icSync.auth')}>{p => <Select id={p.id} value={form.authType} disabled={save.isPending}
          options={[{ value: 'basic', label: 'Basic' }, { value: 'bearer', label: 'Bearer' }]}
          onValueChange={value => set('authType', value as IcChannelCreate['authType'])} />}</Field>
        {form.authType === 'basic' && <Field label={t('icSync.user')} error={formError('username')}>
          {p => <Input {...p} value={form.username ?? ''} autoComplete="off" maxLength={255}
            disabled={save.isPending} onChange={event => set('username', event.target.value)} />}
        </Field>}
        <Field label={t(form.authType === 'basic' ? 'icSync.password' : 'icSync.token')}
          hint={!needsSecret ? t('icSync.savedSecret') : undefined} error={formError('secret')}>
          {p => <Input {...p} value={form.secret} type="password" maxLength={8192} autoComplete="new-password"
            disabled={!secretsAvailable || save.isPending} onChange={event => set('secret', event.target.value)} />}
        </Field>
        <Field label={t('icSync.policy')}>{p => <Select id={p.id} value={form.conflictPolicy} disabled={save.isPending}
          options={IC_CONFLICT_POLICIES.map(value => ({ value, label: t(`icSync.policies.${value}`) }))}
          onValueChange={value => set('conflictPolicy', value as IcChannelCreate['conflictPolicy'])} />}</Field>
        <Field label={t('icSync.interval')} error={formError('intervalMinutes')}>{p => <NumberField id={p.id} value={form.intervalMinutes}
          min={1} max={1440} disabled={save.isPending} onChange={value => set('intervalMinutes', value)} />}</Field>
        <Field label={t('icExport.version')}>{p => <Select id={p.id} value={form.version} disabled={save.isPending}
          options={[{ value: '1.17', label: '1.17' }, { value: '1.15', label: '1.15' }]}
          onValueChange={value => set('version', value as IcChannelCreate['version'])} />}</Field>
      </div>
      <Choice><Checkbox checked={form.enabled} disabled={save.isPending} onChange={event => set('enabled', event.target.checked)} />
        {t('icSync.enableSchedule')}</Choice>
      {save.isError && <Alert tone="warn">{errorMessage(save.error)}</Alert>}
      <div className="row gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={save.isPending || (needsSecret && !secretsAvailable)}>{t('icSync.save')}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={save.isPending} onClick={onCancel}>{t('icSync.cancel')}</Button>
      </div>
    </form>
  );
}

function ChannelJournal({ ws, channel }: { ws: string; channel: Channel }) {
  const t = useT();
  const journal = useQuery({
    queryKey: [...queryKeyOf(ws), 'runs', channel.id],
    queryFn: () => call<Runs>(ws, 'GET', `${channelsPath}/${channel.id}/runs`),
    refetchInterval: 15_000,
  });
  const count = (value: number | null) => value === null ? '—' : fmtNumber(value);
  return (
    <div className="stack gap-2 border-t pt-3">
      <h3>{t('icSync.journalFor', { name: channel.nodeName })}</h3>
      {journal.isPending && <Skeleton w="100%" h={60} />}
      {journal.isError && <Alert tone="warn">{errorMessage(journal.error)}</Alert>}
      {journal.data && <IcReportTable rows={journal.data}
        headings={[t('icSync.started'), t('icSync.result'), t('icSync.sent'), t('icSync.received'), t('icSync.conflicts'), t('icSync.details')]}
        cells={run => [
          fmtDateTime(run.startedAt),
          <div className="stack gap-1"><Badge tone={!run.finishedAt ? 'neutral' : run.status === 'ok' ? 'green' : run.status === 'partial' ? 'amber' : 'red'}>
            {t(run.finishedAt ? `icSync.status.${run.status}` : 'icSync.running')}</Badge><small>{t(`icSync.direction.${run.direction}`)}</small></div>,
          <div>{count(run.objectsSent)} <small className="muted">{run.sentMessageNo !== null && t('icSync.packet', { number: count(run.sentMessageNo) })}</small></div>,
          <div>{count(run.objectsReceived)} <small className="muted">{run.receivedMessageNo !== null && t('icSync.packet', { number: count(run.receivedMessageNo) })}</small></div>,
          count(run.conflictsCount),
          run.errorsJson.length ? <details>
            <summary>{t('icSync.detailCount', { number: count(run.errorsJson.length) })}</summary>
            <ul className="stack gap-2 pl-4">
              {run.errorsJson.map((issue, index) => <li key={index}><IssueDetails issue={issue} /></li>)}
            </ul>
          </details> : '—',
        ]} />}
    </div>
  );
}

function IssueDetails({ issue }: { issue: IcSyncIssue }) {
  const t = useT();
  const reason = `errors.${issue.reason}`;
  const entity = `icLinks.types.${issue.type}`;
  return (
    <div className="stack gap-1 whitespace-normal break-words">
      <span>{t(`icSync.direction.${issue.stage}`)} · {t(`icSync.issues.${issue.code}`)}</span>
      {issue.policy && <small>{t(`icSync.policies.${issue.policy}`)}</small>}
      {issue.httpStatus && <small>HTTP {issue.httpStatus}</small>}
      {(issue.name || issue.type) && <small>{[issue.name, hasKey(entity) ? t(entity) : issue.type].filter(Boolean).join(' · ')}</small>}
      {issue.refUuid && <small>{t('icLinks.guid')} {issue.refUuid}</small>}
      {issue.entityId && <small>{t('icLinks.ourId')} {issue.entityId}</small>}
      {issue.reason && <small>{hasKey(reason) ? t(reason) : issue.reason}</small>}
    </div>
  );
}
