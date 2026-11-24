/* Диалог выбора живой карточки ERP/CRM (задача, сделка или контрагент) для размещения на доске */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, CheckSquare, Handshake, Search } from 'lucide-react';
import { Badge, Dialog, DialogContent, EmptyState, Input, Skeleton, Tab, Tabs, TabsList } from '@/components/ui';
import { fmtAmount, useT } from '@/i18n';
import { useWorkspace } from '../data/store';
import { call, useWsId } from '../meta/data';
import type { WbErpEntityType } from './canvas/types';

export interface ErpCardSelection {
  entityType: WbErpEntityType;
  entityId: string;
  title: string;
  subtitle?: string;
  status?: string;
  done?: boolean;
}

interface DealApiRow {
  id: string;
  name: string;
  amount: string | number;
  currency?: string;
  closeDate?: string | null;
}

interface CompanyApiRow {
  id: string;
  name: string;
  industry?: string;
  city?: string;
}

type PickerTab = 'tasks' | 'deals' | 'companies';

export function ErpCardPickerDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (card: ErpCardSelection) => void;
}) {
  const t = useT();
  const ws = useWsId();
  const { data } = useWorkspace();
  const [tab, setTab] = React.useState<PickerTab>('tasks');
  const [q, setQ] = React.useState('');

  React.useEffect(() => {
    if (open) setQ('');
  }, [open]);

  const dealsQuery = useQuery({
    queryKey: ['ws', ws, 'whiteboards', 'picker', 'deals'],
    queryFn: async () => (await call<{ items: DealApiRow[] }>(ws, 'GET', '/deals?limit=50')).items,
    enabled: open && tab === 'deals',
  });

  const companiesQuery = useQuery({
    queryKey: ['ws', ws, 'whiteboards', 'picker', 'companies'],
    queryFn: async () => (await call<{ items: CompanyApiRow[] }>(ws, 'GET', '/companies?limit=50')).items,
    enabled: open && tab === 'companies',
  });

  const needle = q.trim().toLowerCase();

  const items = React.useMemo<ErpCardSelection[]>(() => {
    if (tab === 'tasks') {
      const projectsById = new Map(data.projects.map(p => [p.id, p]));
      const statusesById = new Map(data.statuses.map(s => [s.id, s]));
      return data.tasks
        .filter(task => !task.archived)
        .map(task => ({
          entityType: 'task' as const,
          entityId: task.id,
          title: task.title,
          subtitle: projectsById.get(task.project)?.name || task.key,
          status: statusesById.get(task.status)?.name ?? task.status,
          done: task.status === 'done',
        }))
        .filter(item => !needle || item.title.toLowerCase().includes(needle) || (item.subtitle?.toLowerCase().includes(needle) ?? false));
    }

    if (tab === 'deals') {
      return (dealsQuery.data ?? [])
        .map(deal => ({
          entityType: 'deal' as const,
          entityId: deal.id,
          title: deal.name,
          subtitle: `${fmtAmount(deal.amount)}${deal.currency ? ` ${deal.currency}` : ''}`,
          status: deal.closeDate ?? undefined,
        }))
        .filter(item => !needle || item.title.toLowerCase().includes(needle));
    }

    return (companiesQuery.data ?? [])
      .map(company => ({
        entityType: 'client' as const,
        entityId: company.id,
        title: company.name,
        subtitle: [company.industry, company.city].filter(Boolean).join(' · ') || undefined,
      }))
      .filter(item => !needle || item.title.toLowerCase().includes(needle) || (item.subtitle?.toLowerCase().includes(needle) ?? false));
  }, [tab, needle, data.tasks, data.projects, data.statuses, dealsQuery.data, companiesQuery.data]);

  const loading = (tab === 'deals' && dealsQuery.isPending) || (tab === 'companies' && companiesQuery.isPending);

  const pick = (item: ErpCardSelection) => {
    onSelect(item);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('whiteboards.picker.title')} description={t('whiteboards.picker.description')} size="md">
        <div className="col" style={{ gap: 12 }}>
          <Tabs value={tab} onValueChange={v => setTab(v as PickerTab)}>
            <TabsList>
              <Tab value="tasks">
                <CheckSquare size={14} />
                {t('whiteboards.picker.tabs.tasks')}
              </Tab>
              <Tab value="deals">
                <Handshake size={14} />
                {t('whiteboards.picker.tabs.deals')}
              </Tab>
              <Tab value="companies">
                <Building2 size={14} />
                {t('whiteboards.picker.tabs.companies')}
              </Tab>
            </TabsList>
          </Tabs>

          <Input
            size="sm"
            icon={<Search size={14} />}
            placeholder={t('whiteboards.picker.search')}
            aria-label={t('whiteboards.picker.search')}
            value={q}
            onChange={e => setQ(e.target.value)}
            autoFocus
          />

          <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {loading ? (
              <>
                <Skeleton w="100%" h={44} />
                <Skeleton w="100%" h={44} />
                <Skeleton w="100%" h={44} />
              </>
            ) : items.length === 0 ? (
              <EmptyState size="sm" icon={<Search size={18} />} title={t('whiteboards.picker.empty')} />
            ) : (
              items.map(item => (
                <button
                  key={`${item.entityType}-${item.entityId}`}
                  type="button"
                  className="panel row"
                  style={{
                    padding: '10px 12px',
                    gap: 10,
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                  onClick={() => pick(item)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="trunc" style={{ fontWeight: 500, fontSize: 13.5, textDecoration: item.done ? 'line-through' : undefined }}>
                      {item.title}
                    </div>
                    {item.subtitle && (
                      <div className="trunc muted" style={{ fontSize: 12 }}>
                        {item.subtitle}
                      </div>
                    )}
                  </div>
                  {item.status && <Badge tone={item.done ? 'green' : 'neutral'}>{item.status}</Badge>}
                </button>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
