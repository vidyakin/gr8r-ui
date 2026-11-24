/* Настройки → Интеграции → 1С (задача 1226): таблица соответствий наших объектов и объектов 1С.
   Сводка по типам, список связей (GUID, имя 1С, источник, как сопоставлено), ручное связывание
   выбором GUID, разрыв. Автопоиск применяется задачей 1228 при загрузке данных из 1С. */
import * as React from 'react';
import { IC_ENTITY_TYPES, IC_SOURCES } from '@erp/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2Off, RefreshCw, Unplug } from 'lucide-react';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, Field, Input, Select, Skeleton, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { fmtDateTime } from '@/i18n/format';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';

interface Link1c {
  id: string;
  source: (typeof IC_SOURCES)[number];
  entityType: (typeof IC_ENTITY_TYPES)[number];
  entityId: string;
  refUuid: string;
  refName: string;
  matchedBy: 'manual' | 'auto';
  matchedRule: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export function Links1c() {
  const t = useT();
  const ws = useWsId();
  const qc = useQueryClient();
  const [source, setSource] = React.useState<(typeof IC_SOURCES)[number]>('buh3');
  const [entityType, setEntityType] = React.useState<(typeof IC_ENTITY_TYPES)[number]>('company');
  const queryKey = ['ws', ws, 'ic-links', source, entityType] as const;
  const list = useQuery({
    queryKey,
    queryFn: () => call<Link1c[]>(ws, 'GET', `/integrations/1c/links?source=${source}&entityType=${entityType}`),
  });
  const [adding, setAdding] = React.useState(false);
  const [entityId, setEntityId] = React.useState('');
  const [refUuid, setRefUuid] = React.useState('');
  const [refName, setRefName] = React.useState('');
  const [unlink, setUnlink] = React.useState<Link1c | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['ws', ws, 'ic-links'] });

  const add = async () => {
    try {
      await call(ws, 'POST', '/integrations/1c/links', { source, entityType, entityId, refUuid, refName: refName || undefined });
      toast(t('icLinks.linked'));
      setAdding(false);
      setEntityId('');
      setRefUuid('');
      setRefName('');
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const items = list.data ?? [];
  return (
    <div className="sblock">
      <h2 style={{ margin: 0 }}>{t('icLinks.title')}</h2>
      <p className="muted">{t('icLinks.lead')}</p>
      <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Select value={source} onValueChange={v => setSource(v as (typeof IC_SOURCES)[number])} options={IC_SOURCES.map(s => ({ value: s, label: t(`icLinks.sources.${s}`) }))} aria-label={t('icLinks.source')} />
        <Select value={entityType} onValueChange={v => setEntityType(v as (typeof IC_ENTITY_TYPES)[number])} options={IC_ENTITY_TYPES.map(ty => ({ value: ty, label: t(`icLinks.types.${ty}`) }))} aria-label={t('icLinks.entityType')} />
        <span className="sp" style={{ flex: 1 }} />
        <Badge>{t('icLinks.count', { n: items.length })}</Badge>
        <Button size="sm" variant="ghost" onClick={refresh} aria-label={t('icLinks.refresh')}><RefreshCw size={13} /></Button>
        <Button size="sm" onClick={() => setAdding(a => !a)}>{t('icLinks.add')}</Button>
      </div>

      {adding && (
        <div className="srow" style={{ display: 'block', marginBottom: 12 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label={t('icLinks.ourId')}>{p => <Input {...p} value={entityId} onChange={e => setEntityId(e.target.value)} placeholder="uuid" />}</Field>
            <Field label={t('icLinks.guid')}>{p => <Input {...p} value={refUuid} onChange={e => setRefUuid(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />}</Field>
            <Field label={t('icLinks.name1c')}>{p => <Input {...p} value={refName} onChange={e => setRefName(e.target.value)} />}</Field>
            <Button size="sm" disabled={!entityId.trim() || !refUuid.trim()} onClick={() => void add()}>{t('icLinks.link')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>{t('common.cancel')}</Button>
          </div>
        </div>
      )}

      {list.isPending ? (
        <Skeleton w="100%" h={60} />
      ) : !items.length ? (
        <EmptyState icon={<Unplug size={20} />} title={t('icLinks.empty')}>{t('icLinks.emptyHint')}</EmptyState>
      ) : (
        <table className="dtbl">
          <thead>
            <tr>
              <th>{t('icLinks.name1c')}</th>
              <th style={{ width: 260 }}>GUID 1C</th>
              <th>{t('icLinks.ourId')}</th>
              <th style={{ width: 120 }}>{t('icLinks.matchedBy')}</th>
              <th>{t('icLinks.updated')}</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {items.map(l => (
              <tr key={l.id}>
                <td>{l.refName || <span className="muted">—</span>}</td>
                <td className="muted" style={{ fontFamily: 'var(--mono)' }}>{l.refUuid}</td>
                <td className="muted" style={{ fontFamily: 'var(--mono)' }}>{l.entityId}</td>
                <td>{l.matchedBy === 'manual' ? <Badge>{t('icLinks.manual')}</Badge> : <Badge tone="green" dot>{l.matchedRule === 'export' ? t('icLinks.generated') : t('icLinks.auto', { rule: l.matchedRule ?? '' })}</Badge>}</td>
                <td className="muted">{fmtDateTime(l.updatedAt)}</td>
                <td>
                  <Button size="sm" variant="ghost" onClick={() => setUnlink(l)} aria-label={t('icLinks.unlink')}>
                    <Link2Off size={14} />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!items.length && (
        <Alert tone="info" className="mt-2">{t('icLinks.autoHint')}</Alert>
      )}

      <ConfirmDialog
        open={!!unlink}
        onOpenChange={o => !o && setUnlink(null)}
        title={t('icLinks.unlink')}
        description={unlink ? t('icLinks.confirmUnlink', { name: unlink.refName || unlink.refUuid }) : ''}
        confirmLabel={t('icLinks.unlink')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={async () => {
          if (unlink) {
            try {
              await call(ws, 'DELETE', '/integrations/1c/links', { source: unlink.source, entityType: unlink.entityType, entityId: unlink.entityId });
              toast(t('icLinks.unlinked'));
              refresh();
            } catch (e) {
              toast.error(errorMessage(e));
            }
          }
          setUnlink(null);
        }}
      />
    </div>
  );
}
