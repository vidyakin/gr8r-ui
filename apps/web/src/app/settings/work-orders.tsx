/* Settings → Work order kinds. У каждого вида заказ-нарядов свой набор состояний; логика заказ-наряда привязана
   к категории состояния (в частности, продажа происходит при категории «done»), поэтому состояние удалить нельзя,
   если на нём есть заказ-наряды или оно последнее в своей категории. Меняет admin и выше. */
import * as React from 'react';
import { ClipboardList, Plus, Trash2 } from 'lucide-react';
import { WORK_ORDER_STATE_CATEGORIES, type WorkOrderStateCategory } from '@gr8r/shared';
import { Alert, Badge, Button, EmptyState, IconButton, Input, Select, Skeleton, toast } from '@/components/ui';
import { useIsAdmin } from '../catalog/data';
import { useDocsApi, useDocumentStates, useWorkOrderKinds } from '../docs/data';
import { SettingsHead, SRow } from './parts';
import { t as tFn, hasKey, useT, type TKey } from '@/i18n';

/** Подпись категории состояния из settings.enums.workOrderStateCategory.* с fallback */
function categoryLabel(value: WorkOrderStateCategory): string {
  const key = `settings.enums.workOrderStateCategory.${value}`;
  return hasKey(key) ? tFn(key as TKey) : value;
}

export function WorkOrderKindsSection({ title }: { title: string }) {
  const t = useT();
  const isAdmin = useIsAdmin();
  const api = useDocsApi();
  const kinds = useWorkOrderKinds();
  const states = useDocumentStates();
  const [name, setName] = React.useState('');
  const [kindId, setKindId] = React.useState<string | null>(null);
  const [label, setLabel] = React.useState('');
  const [key, setKey] = React.useState('');
  const [category, setCategory] = React.useState<WorkOrderStateCategory>('new');

  const kind = kindId ?? kinds.data?.find(k => k.isDefault)?.id ?? kinds.data?.[0]?.id ?? null;
  const own = (states.data ?? []).filter(s => s.kindId === kind);

  return (
    <>
      <SettingsHead title={title} lead={t('settings.workOrders.lead')} />
      {!isAdmin && (
        <Alert tone="info" className="mb-3">
          {t('settings.workOrders.onlyAdmins')}
        </Alert>
      )}
      <div className="sblock">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{t('settings.workOrders.kinds.title')}</h2>
        </div>
        {kinds.isPending ? (
          <Skeleton w="100%" h={60} />
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {(kinds.data ?? []).map(k => (
              <SRow
                key={k.id}
                t={
                  <>
                    {k.name} {k.isDefault && <Badge tone="accent">{t('settings.workOrders.kinds.default')}</Badge>}
                  </>
                }
                d={t('settings.workOrders.kinds.statesCount', { count: (states.data ?? []).filter(s => s.kindId === k.id).length })}
              >
                {kind !== k.id && (
                  <Button size="sm" variant="ghost" onClick={() => setKindId(k.id)}>
                    {t('settings.workOrders.kinds.statesBtn')}
                  </Button>
                )}
              </SRow>
            ))}
          </div>
        )}
        {isAdmin && (
          <div className="doc-add">
            <Input aria-label={t('settings.workOrders.kinds.nameAria')} value={name} placeholder={t('settings.workOrders.kinds.namePlaceholder')} onChange={e => setName(e.target.value)} />
            <Button
              size="sm"
              variant="ghost"
              disabled={!name.trim()}
              onClick={async () => {
                const r = await api('POST', '/work-order-kinds', { name: name.trim() });
                if (r) {
                  setName('');
                  toast(t('settings.workOrders.kinds.created', { name: name.trim() }));
                }
              }}
            >
              <Plus size={13} />
              {t('settings.workOrders.kinds.add')}
            </Button>
          </div>
        )}
      </div>

      <div className="sblock">
        <h2>{t('settings.workOrders.states.title')}</h2>
        {kinds.isPending ? (
          <Skeleton w="100%" h={60} />
        ) : !own.length ? (
          <EmptyState icon={<ClipboardList size={20} />} title={t('settings.workOrders.states.empty.title')}>
            {t('settings.workOrders.states.empty.hint')}
          </EmptyState>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {own.map(s => (
              <SRow key={s.id} t={s.label} d={`${s.key} · ${categoryLabel(s.category)}`}>
                {isAdmin && (
                  <IconButton
                    size="xs"
                    label={t('settings.workOrders.states.delete', { label: s.label })}
                    onClick={async () => {
                      const r = await api('DELETE', `/document-states/${s.id}`);
                      if (r) toast(t('settings.workOrders.states.deleted', { label: s.label }));
                    }}
                  >
                    <Trash2 size={14} />
                  </IconButton>
                )}
              </SRow>
            ))}
          </div>
        )}
        {isAdmin && kind && (
          <div className="doc-add">
            <Input aria-label={t('settings.workOrders.states.labelAria')} value={label} placeholder={t('settings.workOrders.states.labelPlaceholder')} onChange={e => setLabel(e.target.value)} />
            <Input aria-label={t('settings.workOrders.states.keyAria')} value={key} placeholder={t('settings.workOrders.states.keyPlaceholder')} onChange={e => setKey(e.target.value)} />
            <Select
              value={category}
              aria-label={t('settings.workOrders.states.category')}
              onValueChange={v => setCategory(v as WorkOrderStateCategory)}
              options={WORK_ORDER_STATE_CATEGORIES.map(c => ({ value: c, label: categoryLabel(c) }))}
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={!label.trim() || !key.trim()}
              onClick={async () => {
                const r = await api('POST', '/document-states', { kindId: kind, label: label.trim(), key: key.trim().toLowerCase(), category });
                if (r) {
                  setLabel('');
                  setKey('');
                  toast(t('settings.workOrders.states.added', { label: label.trim() }));
                }
              }}
            >
              <Plus size={13} />
              {t('settings.workOrders.states.add')}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
