/* Panel и Stat — блоки дашбордов: панель с заголовком и плитка «показатель» (разметка как на странице Overview) */
import * as React from 'react';
import { cn } from '@/lib/utils';

export function Panel({ title, actions, children, className }: { title: string; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('panel', className)}>
      <div className="panel-h">
        <h2>{title}</h2>
        {actions && <div className="acts">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** note получает класс up / bad, когда тренд нужно подсветить */
export function Stat({ label, value, note, tone }: { label: string; value: React.ReactNode; note: React.ReactNode; tone?: 'up' | 'bad' }) {
  return (
    <div className="stat">
      <span className="k">{label}</span>
      <span className="v">{value}</span>
      <span className={cn('d', tone)}>{note}</span>
    </div>
  );
}
