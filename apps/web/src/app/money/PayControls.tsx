/* «Оплачено / к оплате» и кнопка «Оплатить» в документе расчётов: счёт, заказ, реализация, акт, заказ-наряд, поступление, возвраты */
import { useNavigate } from 'react-router';
import { Banknote, ChevronDown } from 'lucide-react';
import { PAYABLE_TYPES } from '@gr8r/shared';
import { Badge, Button, Menu, MenuContent, MenuItem, MenuTrigger, toast } from '@/components/ui';
import { fmtAmount, useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { useCanWrite } from '../meta/custom-fields';
import { usePaymentApi, usePaymentStatuses } from './data';

const TONE = { unpaid: 'gray', partial: 'amber', paid: 'green' } as const;

export function PayControls({ docId, type, status }: { docId: string; type: string; status: string }) {
  const tt = useT();
  const canWrite = useCanWrite();
  const navigate = useNavigate();
  const api = usePaymentApi();
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
  return (
    <>
      {!isReturn && (
        <Badge tone={TONE[s.state]} dot>
          {s.state === 'partial' ? tt('money.status.paidOf', { paid: fmtAmount(s.paid), total: fmtAmount(s.obligation) }) : tt(`money.status.${s.state}`)}
          {s.mode === 'by_counterparty' ? ` (${tt('money.status.byCounterparty')})` : ''}
        </Badge>
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
