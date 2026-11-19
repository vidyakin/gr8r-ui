/* Вкладка «Обращения» у контрагента и контакта (docs/architecture/cases.md): список обращений клиента и создание нового с подстановкой клиента */
import * as React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui';
import { fmtDateTime } from '@/i18n/format';
import { useT } from '@/i18n';
import { CasePriorityBadge, CaseStatusBadge } from './badges';
import { CaseCard } from './CaseCard';
import { useCases } from './data';
import { SlaBadge } from './sla';

export function ClientCases({ companyId, contactId, defaultCompanyId }: { companyId?: string; contactId?: string; defaultCompanyId?: string }) {
  const t = useT();
  const list = useCases({ ...(companyId ? { companyId } : {}), ...(contactId ? { contactId } : {}) });
  const [open, setOpen] = React.useState<string | 'new' | null>(null);
  const rows = list.data ?? [];
  return (
    <div className="stack" style={{ gap: 8, padding: '12px 0' }}>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button size="sm" onClick={() => setOpen('new')}>
          <Plus size={13} />
          {t('cases.client.add')}
        </Button>
      </div>
      {!rows.length ? (
        <p className="faint" style={{ fontSize: 13 }}>{t('cases.client.empty')}</p>
      ) : (
        rows.map(c => (
          <button key={c.id} className="row" style={{ gap: 10, minHeight: 34, fontSize: 13, textAlign: 'left', width: '100%' }} onClick={() => setOpen(c.id)}>
            <span className="num muted">{c.number}</span>
            <span className="trunc" style={{ flex: 1 }}>{c.subject}</span>
            <CaseStatusBadge status={c.status} />
            <CasePriorityBadge priority={c.priority} />
            <span className="hide-m"><SlaBadge c={c} /></span>
            <span className="muted num hide-m">{fmtDateTime(c.createdAt)}</span>
          </button>
        ))
      )}
      {open && <CaseCard caseId={open === 'new' ? null : open} onClose={() => setOpen(null)} defaults={{ ...((companyId ?? defaultCompanyId) ? { companyId: (companyId ?? defaultCompanyId)! } : {}), ...(contactId ? { contactId } : {}) }} />}
    </div>
  );
}
