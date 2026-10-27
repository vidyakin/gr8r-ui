/* Должности участника (задача 1172): бейджи и, для admin/owner, список флажков в поповере. */
import { BriefcaseBusiness } from 'lucide-react';
import { Badge, Button, Checkbox, Popover, PopoverContent, PopoverTrigger, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { useIsAdmin } from '../catalog/data';
import { usePositions, usePositionsApi } from './data';

export function MemberPositions({ memberId, compact }: { memberId: string; compact?: boolean }) {
  const t = useT();
  const isAdmin = useIsAdmin();
  const api = usePositionsApi();
  const positions = usePositions();
  const all = positions.data ?? [];
  const mine = all.filter(p => p.memberIds.includes(memberId));
  const set = async (ids: string[]) => {
    if (await api('PUT', `/positions/by-member/${memberId}`, { positionIds: ids })) toast(t('positions.member.saved'));
  };
  return (
    <span className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {!compact && <BriefcaseBusiness size={13} className="faint" aria-hidden />}
      {mine.length ? mine.map(p => <Badge key={p.id}>{p.name}</Badge>) : !compact && <span className="faint" style={{ fontSize: 12.5 }}>{t('positions.member.none')}</span>}
      {isAdmin && (
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="ghost" aria-label={t('positions.member.title')}>
              {compact ? t('positions.member.title') : t('positions.member.edit')}
            </Button>
          </PopoverTrigger>
          <PopoverContent style={{ minWidth: 220 }}>
            <div className="stack" style={{ gap: 8 }}>
              <strong style={{ fontSize: 13 }}>{t('positions.member.title')}</strong>
              {all.length ? (
                all.map(p => (
                  <label key={p.id} className="row" style={{ gap: 8, fontSize: 13 }}>
                    <Checkbox checked={mine.some(x => x.id === p.id)} aria-label={p.name} onChange={() => void set(mine.some(x => x.id === p.id) ? mine.filter(x => x.id !== p.id).map(x => x.id) : [...mine.map(x => x.id), p.id])} />
                    {p.name}
                  </label>
                ))
              ) : (
                <span className="faint" style={{ fontSize: 12.5 }}>{t('positions.member.empty')}</span>
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}
