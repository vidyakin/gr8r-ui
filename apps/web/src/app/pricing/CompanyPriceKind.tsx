/* Вид цен контрагента (задача 1178): подставляется в документы с ним, если нет вида в шапке и договоре. Поле карточки компании в CRM. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Select, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';
import { useCanWrite } from '../meta/custom-fields';
import { pricingKey, usePriceKinds } from './data';

export function CompanyPriceKind({ companyId }: { companyId: string }) {
  const tt = useT();
  const ws = useWsId();
  const qc = useQueryClient();
  const canWrite = useCanWrite();
  const kinds = usePriceKinds();
  const company = useQuery({ queryKey: pricingKey(ws, 'company-kind', companyId), queryFn: () => call<{ priceKindId: string | null }>(ws, 'GET', `/companies/${companyId}`) });
  const save = async (v: string) => {
    try {
      await call(ws, 'PATCH', `/companies/${companyId}`, { priceKindId: v || null });
      await qc.invalidateQueries({ queryKey: ['ws', ws, 'docs'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Select
      aria-label={tt('pricing.doc.kind')}
      disabled={!canWrite}
      placeholder={tt('pricing.doc.auto')}
      value={company.data?.priceKindId ?? ''}
      onValueChange={v => void save(v)}
      options={[{ value: '', label: tt('pricing.doc.auto') }, ...(kinds.data ?? []).map(k => ({ value: k.id, label: k.name }))]}
    />
  );
}
