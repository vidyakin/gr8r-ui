import { Badge, type Tone } from '@/components/ui';
import type { LeadStatus } from './data';

const TONE: Record<string, Tone> = { gray: 'gray', blue: 'accent', amber: 'amber', violet: 'violet', green: 'green', red: 'red', teal: 'green', rose: 'red' };

export function StatusBadge({ status }: { status: LeadStatus | undefined }) {
  if (!status) return null;
  return (
    <Badge tone={TONE[status.color] ?? 'neutral'} dot>
      {status.name}
    </Badge>
  );
}
