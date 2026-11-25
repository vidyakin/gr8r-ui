import type { SupplierOrderStatus } from '@erp/shared';
import { Badge, type Tone } from '@/components/ui';
import { useT } from '@/i18n';

const tones: Record<SupplierOrderStatus, Tone> = {
  pending: 'amber',
  confirmed: 'green',
  shipped: 'accent',
  declined: 'red',
};

export function SupplierStatusBadge({ status, showLabel }: { status: SupplierOrderStatus; showLabel?: boolean }) {
  const t = useT();
  const label = t(`supplierPortal.status.${status}`);
  return <Badge tone={tones[status]} dot>{showLabel ? t('supplierPortal.statusLabel', { status: label }) : label}</Badge>;
}
