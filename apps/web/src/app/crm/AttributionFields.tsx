/* Поля «Источник» и «Кампания» записи (задача 1177): кампания задаёт источник, список кампаний — источника.
   AttributionFields — в формах (с подписями), RecordAttribution — строка карточки контрагента или сделки (сама читает и пишет запись). */
import { useQuery } from '@tanstack/react-query';
import { Field, Select } from '@/components/ui';
import { useT } from '@/i18n';
import { useCanWrite } from '../meta/custom-fields';
import { call, useWsId } from '../meta/data';
import { adKey, useAdApi, useAdCampaigns, useLeadSources, type Attribution } from './ad-data';

const NONE = '__none';

function useAttributionOptions(value: Attribution, onChange: (v: Attribution) => void) {
  const t = useT();
  const sources = useLeadSources().data ?? [];
  const campaigns = useAdCampaigns('include').data ?? [];
  // архивные показываются только как текущее значение
  const srcOpts = sources.filter(s => !s.archivedAt || s.id === value.sourceId);
  const campOpts = campaigns.filter(c => (!c.archivedAt || c.id === value.campaignId) && (!value.sourceId || c.sourceId === value.sourceId));
  return {
    source: {
      value: value.sourceId ?? NONE,
      onValueChange: (v: string) => {
        const sourceId = v === NONE ? null : v;
        const keep = campaigns.find(c => c.id === value.campaignId)?.sourceId === sourceId;
        onChange({ sourceId, campaignId: keep ? value.campaignId : null });
      },
      options: [{ value: NONE, label: t('ads.field.noSource') }, ...srcOpts.map(s => ({ value: s.id, label: s.name }))],
    },
    campaign: {
      value: value.campaignId ?? NONE,
      onValueChange: (v: string) => (v === NONE ? onChange({ ...value, campaignId: null }) : onChange({ sourceId: campaigns.find(c => c.id === v)?.sourceId ?? value.sourceId, campaignId: v })),
      options: [{ value: NONE, label: t('ads.field.noCampaign') }, ...campOpts.map(c => ({ value: c.id, label: c.name }))],
      empty: !campOpts.length,
    },
  };
}

export function AttributionFields({ value, onChange, disabled }: { value: Attribution; onChange: (v: Attribution) => void; disabled?: boolean }) {
  const t = useT();
  const o = useAttributionOptions(value, onChange);
  return (
    <>
      <Field label={t('ads.field.source')}>{p => <Select {...p} disabled={disabled} value={o.source.value} onValueChange={o.source.onValueChange} options={o.source.options} />}</Field>
      <Field label={t('ads.field.campaign')}>{p => <Select {...p} disabled={disabled || o.campaign.empty} value={o.campaign.value} onValueChange={o.campaign.onValueChange} options={o.campaign.options} />}</Field>
    </>
  );
}

/** Источник и кампания контрагента или сделки в карточке: читает запись API и сохраняет сразу */
export function RecordAttribution({ path }: { path: `/companies/${string}` | `/deals/${string}` }) {
  const t = useT();
  const ws = useWsId();
  const canWrite = useCanWrite();
  const api = useAdApi();
  const rec = useQuery({ queryKey: adKey(ws, 'record', path), queryFn: () => call<Attribution>(ws, 'GET', path) });
  const value: Attribution = { sourceId: rec.data?.sourceId ?? null, campaignId: rec.data?.campaignId ?? null };
  const o = useAttributionOptions(value, v => void api('PATCH', path, v));
  return (
    <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      <Select size="sm" aria-label={t('ads.field.source')} disabled={!canWrite || rec.isPending} value={o.source.value} onValueChange={o.source.onValueChange} options={o.source.options} />
      <Select size="sm" aria-label={t('ads.field.campaign')} disabled={!canWrite || rec.isPending || o.campaign.empty} value={o.campaign.value} onValueChange={o.campaign.onValueChange} options={o.campaign.options} />
    </span>
  );
}
