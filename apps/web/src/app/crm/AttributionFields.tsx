/* Поля «Источник», «Кампания» и «Кто привёл» записи (задача 1177): кампания задаёт источник, список кампаний — источника;
   у источника-партнёра выбирается контрагент, у источника «контактное лицо» — контакт.
   AttributionFields — в формах (с подписями), RecordAttribution — строка карточки контрагента или сделки (сама читает и пишет запись). */
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { Button, Field, Select } from '@/components/ui';
import { useT } from '@/i18n';
import { Combo } from '../docs/pickers';
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
  const kind = sources.find(s => s.id === value.sourceId)?.kind ?? 'channel';
  return {
    kind,
    source: {
      value: value.sourceId ?? NONE,
      onValueChange: (v: string) => {
        const sourceId = v === NONE ? null : v;
        const keep = campaigns.find(c => c.id === value.campaignId)?.sourceId === sourceId;
        // смена источника снимает «кто привёл»: он зависит от типа источника
        onChange({ sourceId, campaignId: keep ? value.campaignId : null, referrerCompanyId: null, referrerContactId: null });
      },
      options: [{ value: NONE, label: t('ads.field.noSource') }, ...srcOpts.map(s => ({ value: s.id, label: s.name }))],
    },
    campaign: {
      value: value.campaignId ?? NONE,
      onValueChange: (v: string) => {
        if (v === NONE) return onChange({ ...value, campaignId: null });
        const sourceId = campaigns.find(c => c.id === v)?.sourceId ?? value.sourceId;
        onChange(sourceId === value.sourceId ? { ...value, campaignId: v } : { sourceId, campaignId: v, referrerCompanyId: null, referrerContactId: null });
      },
      options: [{ value: NONE, label: t('ads.field.noCampaign') }, ...campOpts.map(c => ({ value: c.id, label: c.name }))],
      empty: !campOpts.length,
    },
  };
}

/** Кто привёл: поиск контрагента или контакта, кнопка очистки */
function ReferrerPicker({ kind, value, onChange, disabled, id }: { kind: 'partner' | 'contact'; value: Attribution; onChange: (v: Attribution) => void; disabled?: boolean; id?: string }) {
  const t = useT();
  const ws = useWsId();
  const path = kind === 'partner' ? 'companies' : 'contacts';
  const refId = (kind === 'partner' ? value.referrerCompanyId : value.referrerContactId) ?? null;
  const name = useQuery({ queryKey: adKey(ws, 'ref-name', path, refId), enabled: !!refId, queryFn: () => call<{ name: string }>(ws, 'GET', `/${path}/${refId}`), staleTime: 60_000 });
  const set = (id: string | null) => onChange(kind === 'partner' ? { ...value, referrerCompanyId: id } : { ...value, referrerContactId: id });
  return (
    <span className="row" style={{ gap: 4 }}>
      <Combo<{ id: string; name: string }>
        id={id}
        aria-label={t('ads.field.referrer')}
        value={refId ? (name.data?.name ?? '…') : ''}
        disabled={disabled}
        placeholder={kind === 'partner' ? t('ads.field.referrerCompany') : t('ads.field.referrerContact')}
        search={async q => (await call<{ items: { id: string; name: string }[] }>(ws, 'GET', `/${path}?limit=8&sort=name${q ? `&q=${encodeURIComponent(q)}` : ''}`)).items}
        itemKey={x => x.id}
        renderItem={x => <span className="trunc grow">{x.name}</span>}
        onPick={x => set(x.id)}
      />
      {refId && !disabled && (
        <Button size="sm" variant="ghost" aria-label={t('ads.field.referrerClear')} onClick={() => set(null)}>
          <X size={13} />
        </Button>
      )}
    </span>
  );
}

/** noReferrer — без «кто привёл» (форма сайта: рекомендателя у заявки с сайта нет) */
export function AttributionFields({ value, onChange, disabled, noReferrer }: { value: Attribution; onChange: (v: Attribution) => void; disabled?: boolean; noReferrer?: boolean }) {
  const t = useT();
  const o = useAttributionOptions(value, onChange);
  return (
    <>
      <Field label={t('ads.field.source')}>{p => <Select {...p} disabled={disabled} value={o.source.value} onValueChange={o.source.onValueChange} options={o.source.options} />}</Field>
      <Field label={t('ads.field.campaign')}>{p => <Select {...p} disabled={disabled || o.campaign.empty} value={o.campaign.value} onValueChange={o.campaign.onValueChange} options={o.campaign.options} />}</Field>
      {o.kind !== 'channel' && !noReferrer && <Field label={t('ads.field.referrer')}>{p => <ReferrerPicker id={p.id} kind={o.kind as 'partner' | 'contact'} value={value} onChange={onChange} disabled={disabled} />}</Field>}
    </>
  );
}

/** Источник, кампания и кто привёл у контрагента или сделки в карточке: читает запись API и сохраняет сразу */
export function RecordAttribution({ path }: { path: `/companies/${string}` | `/deals/${string}` }) {
  const t = useT();
  const ws = useWsId();
  const canWrite = useCanWrite();
  const api = useAdApi();
  const rec = useQuery({ queryKey: adKey(ws, 'record', path), queryFn: () => call<Attribution>(ws, 'GET', path) });
  const value: Attribution = { sourceId: rec.data?.sourceId ?? null, campaignId: rec.data?.campaignId ?? null, referrerCompanyId: rec.data?.referrerCompanyId ?? null, referrerContactId: rec.data?.referrerContactId ?? null };
  const save = (v: Attribution) => void api('PATCH', path, v);
  const o = useAttributionOptions(value, save);
  const off = !canWrite || rec.isPending;
  return (
    <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      <Select size="sm" aria-label={t('ads.field.source')} disabled={off} value={o.source.value} onValueChange={o.source.onValueChange} options={o.source.options} />
      <Select size="sm" aria-label={t('ads.field.campaign')} disabled={off || o.campaign.empty} value={o.campaign.value} onValueChange={o.campaign.onValueChange} options={o.campaign.options} />
      {o.kind !== 'channel' && <ReferrerPicker kind={o.kind as 'partner' | 'contact'} value={value} onChange={save} disabled={off} />}
    </span>
  );
}
