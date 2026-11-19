/* Метка срока обращения (docs/architecture/cases.md): красная — срок нарушен, жёлтая — осталось меньше 20 % времени, обратный отсчёт.
   Расчёт — `caseSlaState` из @erp/shared (одна функция для сервера и интерфейса). */
import { caseSlaState } from '@erp/shared';
import { Badge, type Tone } from '@/components/ui';
import { fmtDateTime } from '@/i18n/format';
import { useT } from '@/i18n';
import { useNow, type CaseRow } from './data';

/** Длительность в самых крупных двух единицах: «2 д 3 ч», «45 мин» */
export function useDuration() {
  const t = useT();
  return (ms: number) => {
    const m = Math.max(1, Math.round(Math.abs(ms) / 60_000));
    const d = Math.floor(m / 1440);
    const h = Math.floor((m % 1440) / 60);
    const mm = m % 60;
    if (d) return h ? `${t('cases.dur.d', { n: d })} ${t('cases.dur.h', { n: h })}` : t('cases.dur.d', { n: d });
    if (h) return mm ? `${t('cases.dur.h', { n: h })} ${t('cases.dur.m', { n: mm })}` : t('cases.dur.h', { n: h });
    return t('cases.dur.m', { n: mm });
  };
}

const TONE: Record<string, Tone> = { ok: 'green', warn: 'amber', breached: 'red' };

export function SlaBadge({ c }: { c: CaseRow }) {
  const t = useT();
  const now = useNow();
  const dur = useDuration();
  const s = caseSlaState({ ...c, createdAt: c.createdAt }, now);
  if (s.level === 'none' || !s.dueAt || !s.kind) return <span className="faint">{t('cases.sla.none')}</span>;
  const what = t(s.kind === 'first_response' ? 'cases.sla.firstResponse' : 'cases.sla.resolve');
  const diff = s.dueAt.getTime() - now.getTime();
  const text = s.level === 'breached' ? t('cases.sla.overdue', { what, time: dur(diff) }) : t('cases.sla.left', { what, time: dur(diff) });
  return (
    <Badge tone={TONE[s.level] ?? 'neutral'} dot title={t('cases.sla.due', { date: fmtDateTime(s.dueAt.toISOString()) })}>
      {text}
    </Badge>
  );
}
