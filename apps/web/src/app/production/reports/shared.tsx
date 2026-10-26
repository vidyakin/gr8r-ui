/* Общие помощники вкладок отчётов: отбор, состояния загрузки и ошибки. */
import * as React from 'react';
import { CircleAlert, FileSearch } from 'lucide-react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Button, EmptyState, Skeleton } from '@/components/ui';
import { errorMessage } from '../../data/api';
import { fmtNumber, useT } from '@/i18n';
import type { ReportFilter } from './reports-data';

/** Что нужно вкладке от общих отборов */
export type FilterKey = 'period' | 'center' | 'item';

export interface TabProps {
  filter: ReportFilter;
}

export const num = (v: string) => fmtNumber(v);

/** Состояния ответа: ошибка, загрузка, пусто — иначе содержимое */
export function ReportState<T>({ q, isEmpty, children }: { q: UseQueryResult<T>; isEmpty: (d: T) => boolean; children: (d: T) => React.ReactNode }) {
  const tt = useT();
  if (q.isError) {
    return (
      <EmptyState icon={<CircleAlert size={20} />} error title={tt('production.reports.loadFailed')} action={<Button size="sm" onClick={() => q.refetch()}>{tt('production.common.retry')}</Button>}>
        {errorMessage(q.error)}
      </EmptyState>
    );
  }
  if (q.isPending) {
    return (
      <div style={{ padding: 16 }}>
        <Skeleton w="100%" h={36} />
      </div>
    );
  }
  if (isEmpty(q.data)) {
    return (
      <EmptyState icon={<FileSearch size={20} />} title={tt('production.reports.empty')}>
        {tt('production.reports.emptyHint')}
      </EmptyState>
    );
  }
  return <>{children(q.data)}</>;
}

/** Блок над таблицей: график с заголовком */
export function ChartPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel plain" style={{ margin: '0 var(--gutter) 16px' }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>{title}</h3>
      {children}
    </section>
  );
}
