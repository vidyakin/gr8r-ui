import type { CasePriority, CaseStatus } from '@erp/shared';
import { Badge, type Tone } from '@/components/ui';
import { useT } from '@/i18n';

const STATUS_TONE: Record<CaseStatus, Tone> = { new: 'accent', in_progress: 'amber', waiting: 'violet', resolved: 'green', closed: 'gray' };
const PRIORITY_TONE: Record<CasePriority, Tone> = { low: 'gray', normal: 'neutral', high: 'amber', urgent: 'red' };

export function CaseStatusBadge({ status }: { status: CaseStatus }) {
  const t = useT();
  return <Badge tone={STATUS_TONE[status]} dot>{t(`cases.status.${status}`)}</Badge>;
}

export function CasePriorityBadge({ priority }: { priority: CasePriority }) {
  const t = useT();
  return <Badge tone={PRIORITY_TONE[priority]}>{t(`cases.priority.${priority}`)}</Badge>;
}
