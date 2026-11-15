/* Универсальная «Форма документа» — единый каркас страниц-документов.
   Обёртка .page.doc-page — flex-колонка с зазором 14px между прямыми детьми тела,
   поэтому вложенные карточки в любом документе автоматически разделяются одинаковым
   промежутком; отступы от краёв и центрирование тоже берёт на себя обёртка.
   DocHeader — стандартная шапка документа (doc-bar: заголовок, подзаголовок, действия). */
import * as React from 'react';
import { cn } from '@/lib/utils';

export function DocForm({ header, children, className }: { header?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('page doc-page', className)}>
      {header}
      {children}
    </div>
  );
}

export function DocHeader({ title, subtitle, actions }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="doc-bar">
      <div className="doc-title">
        {typeof title === 'string' ? <h1>{title}</h1> : title}
        {subtitle != null && (typeof subtitle === 'string' ? <p>{subtitle}</p> : subtitle)}
      </div>
      {actions ? <div className="doc-actions">{actions}</div> : null}
    </div>
  );
}
