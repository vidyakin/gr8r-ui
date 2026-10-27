/* «Оплачено / к оплате» и кнопка «Оплатить» в документе расчётов: счёт, заказ, реализация, акт, заказ-наряд, поступление, возвраты */
import { useNavigate } from 'react-router';
import { Banknote, ChevronDown, Link2 } from 'lucide-react';
import { PAYABLE_TYPES } from '@gr8r/shared';
import { Badge, Button, Menu, MenuContent, MenuItem, MenuTrigger, toast } from '@/components/ui';
import { fmtAmount, useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';
import { useCanWrite } from '../meta/custom-fields';
import { usePaymentApi, usePaymentStatuses } from './data';

const TONE = { unpaid: 'gray', partial: 'amber', paid: 'green' } as const;

/** Значок оплаты документа: не оплачен / частично / оплачен / аванс (оплата до отгрузки). Данные — из списка или карточки, без запроса на документ */
export function PayBadge({ s, compact }: { s: { state: 'unpaid' | 'partial' | 'paid'; paid: string; obligation: string; prepaid?: boolean; mode?: string }; compact?: boolean }) {
  const tt = useT();
  const label = s.prepaid
    ? s.state === 'paid' || compact
      ? tt('money.status.prepaid')
      : tt('money.status.prepaidOf', { paid: fmtAmount(s.paid), total: fmtAmount(s.obligation) })
    : s.state === 'partial' && !compact
      ? tt('money.status.paidOf', { paid: fmtAmount(s.paid), total: fmtAmount(s.obligation) })
      : tt(`money.status.${s.state}`);
  return (
    <Badge tone={s.prepaid ? 'accent' : TONE[s.state]} dot>
      {label}
      {!compact && s.mode === 'by_counterparty' ? ` (${tt('money.status.byCounterparty')})` : ''}
    </Badge>
  );
}

export function PayControls({ docId, type, status }: { docId: string; type: string; status: string }) {
  const tt = useT();
  const canWrite = useCanWrite();
  const navigate = useNavigate();
  const api = usePaymentApi();
  const ws = useWsId();
  const payable = (PAYABLE_TYPES as string[]).includes(type) && status !== 'cancelled';
  const st = usePaymentStatuses(payable ? [docId] : []);
  const s = st.data?.[docId];
  if (!payable || !s) return null;
  const isReturn = type === 'customer_return' || type === 'supplier_return';
  const pay = async (account: 'cash' | 'bank') => {
    try {
      const d = await api.fromDocument(docId, account);
      await navigate(`/money/${d.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  // ссылка на онлайн-оплату (ЮКасса): сумма — остаток к оплате; ссылка копируется в буфер обмена
  const payLink = async () => {
    try {
      const r = await call<{ url: string }>(ws, 'POST', '/payment-links', { documentId: docId, returnUrl: window.location.href });
      try {
        await navigator.clipboard.writeText(r.url);
        toast(tt('money.status.payLinkCopied'));
      } catch {
        window.prompt(tt('money.status.payLink'), r.url);
      }
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <>
      {!isReturn && <PayBadge s={s} />}
      {canWrite && !isReturn && s.side === 'customer' && Number(s.remaining) > 0 && (
        <Button variant="ghost" onClick={() => void payLink()}>
          <Link2 size={14} />
          {tt('money.status.payLink')}
        </Button>
      )}
      {canWrite && (isReturn || Number(s.remaining) > 0) && (
        <Menu>
          <MenuTrigger asChild>
            <Button>
              <Banknote size={14} />
              {tt('money.status.pay')}
              <ChevronDown size={12} />
            </Button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem onSelect={() => void pay('bank')}>{tt('money.status.payBank')}</MenuItem>
            <MenuItem onSelect={() => void pay('cash')}>{tt('money.status.payCash')}</MenuItem>
          </MenuContent>
        </Menu>
      )}
    </>
  );
}
