/* Период «с … по …» одной строкой: две DateInput с взаимными ограничениями min/max.
   Подпись периода (например «Созданы») ставится снаружи — компонент её не знает. */
import { useT } from '@/i18n';
import { DateInput } from './date-picker';

export function PeriodInput({
  from,
  to,
  onChange,
  size,
  'aria-label': ariaLabel,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  size?: 'sm' | 'md';
  'aria-label'?: string;
}) {
  const t = useT();
  return (
    <div className="row" role="group" aria-label={ariaLabel} style={{ gap: 6, alignItems: 'center', flexWrap: 'nowrap', fontSize: 13 }}>
      <span className="faint">{t('common.period.from')}</span>
      <DateInput size={size} aria-label={t('common.period.fromLabel')} value={from} max={to} onChange={v => v && onChange(v, to)} required style={{ width: 150 }} />
      <span className="faint">{t('common.period.to')}</span>
      <DateInput size={size} aria-label={t('common.period.toLabel')} value={to} min={from} onChange={v => v && onChange(from, v)} required style={{ width: 150 }} />
    </div>
  );
}
