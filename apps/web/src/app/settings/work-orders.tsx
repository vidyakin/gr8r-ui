/* Settings → Work order kinds. У каждого вида заказ-нарядов свой набор состояний; логика заказ-наряда привязана
   к категории состояния (в частности, продажа происходит при категории «done»), поэтому состояние удалить нельзя,
   если на нём есть заказ-наряды или оно последнее в своей категории. Меняет admin и выше. */
import * as React from 'react';
import { ClipboardList, Plus, Trash2 } from 'lucide-react';
import { WORK_ORDER_CATEGORY_LABELS, WORK_ORDER_STATE_CATEGORIES, type WorkOrderStateCategory } from '@gr8r/shared';
import { Alert, Badge, Button, EmptyState, IconButton, Input, Select, Skeleton, toast } from '@/components/ui';
import { useIsAdmin } from '../catalog/data';
import { useDocsApi, useDocumentStates, useWorkOrderKinds } from '../docs/data';
import { SettingsHead, SRow } from './parts';

export function WorkOrderKindsSection({ title }: { title: string }) {
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
      <SettingsHead title={title} lead="Kinds of work orders. Every kind keeps its own set of states; the logic follows the category of a state, not its name." />
      {!isAdmin && (
        <Alert tone="info" className="mb-3">
          Only admins can change kinds and states.
        </Alert>
      )}
      <div className="sblock">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Kinds</h2>
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
                    {k.name} {k.isDefault && <Badge tone="accent">Default</Badge>}
                  </>
                }
                d={`${(states.data ?? []).filter(s => s.kindId === k.id).length} states`}
              >
                {kind !== k.id && (
                  <Button size="sm" variant="ghost" onClick={() => setKindId(k.id)}>
                    States
                  </Button>
                )}
              </SRow>
            ))}
          </div>
        )}
        {isAdmin && (
          <div className="doc-add">
            <Input aria-label="Kind name" value={name} placeholder="Repair" onChange={e => setName(e.target.value)} />
            <Button
              size="sm"
              variant="ghost"
              disabled={!name.trim()}
              onClick={async () => {
                const r = await api('POST', '/work-order-kinds', { name: name.trim() });
                if (r) {
                  setName('');
                  toast(`Kind “${name.trim()}” created`);
                }
              }}
            >
              <Plus size={13} />
              Add kind
            </Button>
          </div>
        )}
      </div>

      <div className="sblock">
        <h2>States</h2>
        {kinds.isPending ? (
          <Skeleton w="100%" h={60} />
        ) : !own.length ? (
          <EmptyState icon={<ClipboardList size={20} />} title="No states yet">
            Add the states of this kind: at least one state per category.
          </EmptyState>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {own.map(s => (
              <SRow key={s.id} t={s.label} d={`${s.key} · ${WORK_ORDER_CATEGORY_LABELS[s.category]}`}>
                {isAdmin && (
                  <IconButton
                    size="xs"
                    label={`Delete ${s.label}`}
                    onClick={async () => {
                      const r = await api('DELETE', `/document-states/${s.id}`);
                      if (r) toast(`State “${s.label}” deleted`);
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
            <Input aria-label="State label" value={label} placeholder="Waiting for a part" onChange={e => setLabel(e.target.value)} />
            <Input aria-label="State key" value={key} placeholder="waiting_part" onChange={e => setKey(e.target.value)} />
            <Select
              value={category}
              aria-label="Category"
              onValueChange={v => setCategory(v as WorkOrderStateCategory)}
              options={WORK_ORDER_STATE_CATEGORIES.map(c => ({ value: c, label: WORK_ORDER_CATEGORY_LABELS[c] }))}
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
                  toast(`State “${label.trim()}” added`);
                }
              }}
            >
              <Plus size={13} />
              Add state
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
