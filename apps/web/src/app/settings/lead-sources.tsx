/* Settings → Lead sources (задача 1177): справочник источников привлечения — название, цвет, порядок, архив. Правят admin и owner. */
import * as React from 'react';
import { Archive, ArrowDown, ArrowUp, Megaphone, Plus, RotateCcw } from 'lucide-react';
import { LEAD_SOURCE_KINDS, LEAD_STATUS_COLORS, type LeadSourceKind } from '@gr8r/shared';
import { Alert, Button, EmptyState, Field, Input, Select, Skeleton } from '@/components/ui';
import { useT } from '@/i18n';
import { useIsAdmin } from '../catalog/data';
import { useAdApi, useLeadSources, type LeadSource } from '../crm/ad-data';
import { StatusBadge } from '../leads/StatusBadge';
import { SettingsHead, SRow } from './parts';

export function LeadSourcesSection({ title }: { title: string }) {
  const t = useT();
  const isAdmin = useIsAdmin();
  const api = useAdApi();
  const sources = useLeadSources();
  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState<string>('gray');
  const [kind, setKind] = React.useState<LeadSourceKind>('channel');
  const kindOpts = LEAD_SOURCE_KINDS.map(k => ({ value: k, label: t(`ads.kind.${k}`) }));
  const all = sources.data ?? [];
  const list = all.filter(s => !s.archivedAt);
  const archived = all.filter(s => s.archivedAt);

  // порядок — sortOrder соседей меняется местами
  const move = async (i: number, d: -1 | 1) => {
    const a = list[i];
    const b = list[i + d];
    if (!a || !b) return;
    await api('PATCH', `/lead-sources/${a.id}`, { sortOrder: b.sortOrder === a.sortOrder ? b.sortOrder + d : b.sortOrder });
    await api('PATCH', `/lead-sources/${b.id}`, { sortOrder: a.sortOrder });
  };
  const row = (s: LeadSource, i: number) => (
    <div key={s.id} className="srow" style={{ display: 'block' }}>
      <SRow t={<StatusBadge status={s} />} d={t(`ads.kind.${s.kind}`)}>
        {isAdmin && (
          <div className="row" style={{ gap: 4 }}>
            {s.archivedAt ? (
              <Button size="sm" variant="ghost" aria-label={t('ads.source.restore')} onClick={() => void api('POST', `/lead-sources/${s.id}/restore`)}><RotateCcw size={13} /></Button>
            ) : (
              <>
                <Input style={{ width: 180 }} defaultValue={s.name} aria-label={t('ads.source.name')} maxLength={200} onBlur={e => e.target.value.trim() && e.target.value.trim() !== s.name && void api('PATCH', `/lead-sources/${s.id}`, { name: e.target.value.trim() })} />
                <Select size="sm" value={s.kind} aria-label={t('ads.source.kind')} onValueChange={v => void api('PATCH', `/lead-sources/${s.id}`, { kind: v })} options={kindOpts} />
                <Select size="sm" value={s.color} aria-label={t('ads.source.color')} onValueChange={v => void api('PATCH', `/lead-sources/${s.id}`, { color: v })} options={LEAD_STATUS_COLORS.map(c => ({ value: c, label: t(`leads.color.${c}`) }))} />
                <Button size="sm" variant="ghost" aria-label={t('leads.settings.up')} disabled={i === 0} onClick={() => void move(i, -1)}><ArrowUp size={13} /></Button>
                <Button size="sm" variant="ghost" aria-label={t('leads.settings.down')} disabled={i === list.length - 1} onClick={() => void move(i, 1)}><ArrowDown size={13} /></Button>
                <Button size="sm" variant="ghost" aria-label={t('ads.source.archive')} onClick={() => void api('DELETE', `/lead-sources/${s.id}`)}><Archive size={13} /></Button>
              </>
            )}
          </div>
        )}
      </SRow>
    </div>
  );

  return (
    <>
      <SettingsHead title={title} lead={t('ads.source.lead')} />
      {!isAdmin && <Alert tone="info" className="mb-3">{t('ads.onlyAdmins')}</Alert>}
      <div className="sblock">
        {sources.isPending ? (
          <Skeleton w="100%" h={60} />
        ) : !list.length ? (
          <EmptyState icon={<Megaphone size={20} />} title={t('ads.source.empty')} />
        ) : (
          <div className="stack" style={{ gap: 8 }}>{list.map(row)}</div>
        )}
        {isAdmin && (
          <div className="row" style={{ gap: 8, marginTop: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field label={t('ads.source.name')}>{p => <Input {...p} maxLength={200} value={name} onChange={e => setName(e.target.value)} />}</Field>
            <Select value={kind} aria-label={t('ads.source.kind')} onValueChange={v => setKind(v as LeadSourceKind)} options={kindOpts} />
            <Select value={color} aria-label={t('ads.source.color')} onValueChange={setColor} options={LEAD_STATUS_COLORS.map(c => ({ value: c, label: t(`leads.color.${c}`) }))} />
            <Button
              size="sm"
              disabled={!name.trim()}
              onClick={async () => {
                if (await api('POST', '/lead-sources', { name: name.trim(), color, kind })) setName('');
              }}
            >
              <Plus size={13} />
              {t('ads.source.add')}
            </Button>
          </div>
        )}
        {archived.length > 0 && (
          <>
            <div className="faint" style={{ fontSize: 12, margin: '16px 0 8px' }}>{t('ads.source.archived')}</div>
            <div className="stack" style={{ gap: 8 }}>{archived.map(row)}</div>
          </>
        )}
      </div>
    </>
  );
}
