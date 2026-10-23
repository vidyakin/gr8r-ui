/* Редактор параметров спецификации: ключ, название, тип (число, вариант, флажок) и флажок «разрез склада» —
   комбинация таких параметров даёт вариант товара. Значения параметров вводятся в строках заказов. */
import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { paramKeyFromName, type SpecParamDef } from '@gr8r/shared';
import { Button, IconButton, Input, toast } from '@/components/ui';
import { useProductionMutations, type Item } from './data';

const TYPE_LABEL: Record<string, string> = { number: 'Number', select: 'Select', boolean: 'Checkbox' };

/** Пустой параметр: ключ из названия */
const emptyParam = (): SpecParamDef => ({ key: '', name: '', type: 'number', required: false, stockDimension: false, options: {} });

export function ParamEditor({ item, canWrite }: { item: Item; canWrite: boolean }) {
  const m = useProductionMutations();
  const params = item.params ?? [];
  const [draft, setDraft] = React.useState<SpecParamDef[] | null>(null);
  const rows = draft ?? params;

  const save = (next: SpecParamDef[]) => {
    setDraft(next);
    m.updateItem.mutate(
      { id: item.id, patch: { params: next } },
      { onSettled: () => setDraft(null) },
    );
  };

  const patch = (i: number, p: Partial<SpecParamDef>) => save(rows.map((r, n) => (n === i ? { ...r, ...p } : r)));

  if (!rows.length)
    return (
      <div className="bom-params" aria-label="Specification parameters">
        <span className="faint">No parameters: the composition of the product is the same for every order.</span>
        {canWrite && (
          <Button size="sm" variant="secondary" onClick={() => save([emptyParam()])}>
            <Plus size={14} />
            Add parameter
          </Button>
        )}
      </div>
    );

  return (
    <div className="bom-params" aria-label="Specification parameters">
      {rows.map((p, i) => (
        <React.Fragment key={i}>
          <label>
            <span className="label">Name</span>
            <Input
              aria-label="Parameter name"
              value={p.name}
              disabled={!canWrite}
              onChange={e => {
                const name = e.target.value;
                patch(i, { name, key: p.key || paramKeyFromName(name) });
              }}
            />
          </label>
          <label>
            <span className="label">Key</span>
            <Input aria-label="Parameter key" value={p.key} disabled={!canWrite} onChange={e => patch(i, { key: e.target.value })} />
          </label>
          <label>
            <span className="label">Type</span>
            <select className="select" aria-label="Parameter type" value={p.type} disabled={!canWrite} onChange={e => patch(i, { type: e.target.value as SpecParamDef['type'] })}>
              {Object.entries(TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Required</span>
            <input type="checkbox" aria-label="Required" checked={!!p.required} disabled={!canWrite} onChange={e => patch(i, { required: e.target.checked })} />
          </label>
          <label>
            <span className="label">Stock dimension</span>
            <input type="checkbox" aria-label="Stock dimension" checked={!!p.stockDimension} disabled={!canWrite} onChange={e => patch(i, { stockDimension: e.target.checked })} />
          </label>
          {p.type === 'select' && (
            <label>
              <span className="label">Variants</span>
              <Input
                aria-label="Variants"
                placeholder="white, black"
                value={(p.options?.choices ?? []).map(c => c.value).join(', ')}
                disabled={!canWrite}
                onChange={e => {
                  const choices = e.target.value
                    .split(',')
                    .map(v => v.trim())
                    .filter(Boolean)
                    .map(v => ({ value: v, label: v, color: 'gray' }));
                  patch(i, { options: { ...p.options, choices } });
                }}
              />
            </label>
          )}
          {canWrite && (
            <IconButton
              label="Remove parameter"
              onClick={() => {
                const next = rows.filter((_, n) => n !== i);
                save(next);
                toast('Parameter removed');
              }}
            >
              <Trash2 size={15} />
            </IconButton>
          )}
        </React.Fragment>
      ))}
      {canWrite && (
        <Button size="sm" variant="secondary" onClick={() => save([...rows, emptyParam()])}>
          <Plus size={14} />
          Add parameter
        </Button>
      )}
    </div>
  );
}
