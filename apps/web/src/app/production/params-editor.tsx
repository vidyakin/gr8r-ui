/* Редактор параметров спецификации: ключ, название, тип (число, вариант, флажок) и флажок «разрез склада» —
   комбинация таких параметров даёт вариант товара. Значения параметров вводятся в строках заказов. */
import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { paramKeyFromName, type SpecParamDef } from '@gr8r/shared';
import { Button, IconButton, Input, toast } from '@/components/ui';
import { useProductionMutations, type Item } from './data';
import { useT } from '@/i18n';

/** Пустой параметр: ключ из названия */
const emptyParam = (): SpecParamDef => ({ key: '', name: '', type: 'number', required: false, stockDimension: false, options: {} });

export function ParamEditor({ item, canWrite }: { item: Item; canWrite: boolean }) {
  const m = useProductionMutations();
  const tt = useT();
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
      <div className="bom-params" aria-label={tt('production.params.title')}>
        <span className="faint">{tt('production.params.noParamsHint')}</span>
        {canWrite && (
          <Button size="sm" variant="secondary" onClick={() => save([emptyParam()])}>
            <Plus size={14} />
            {tt('production.params.add')}
          </Button>
        )}
      </div>
    );

  return (
    <div className="bom-params" aria-label={tt('production.params.title')}>
      {rows.map((p, i) => (
        <React.Fragment key={i}>
          <label>
            <span className="label">{tt('production.field.name')}</span>
            <Input
              aria-label={tt('production.params.fields.name')}
              value={p.name}
              disabled={!canWrite}
              onChange={e => {
                const name = e.target.value;
                patch(i, { name, key: p.key || paramKeyFromName(name) });
              }}
            />
          </label>
          <label>
            <span className="label">{tt('production.params.fields.key')}</span>
            <Input aria-label={tt('production.params.fields.key')} value={p.key} disabled={!canWrite} onChange={e => patch(i, { key: e.target.value })} />
          </label>
          <label>
            <span className="label">{tt('production.params.fields.type')}</span>
            <select className="select" aria-label={tt('production.params.fields.type')} value={p.type} disabled={!canWrite} onChange={e => patch(i, { type: e.target.value as SpecParamDef['type'] })}>
              {(['number', 'select', 'boolean'] as const).map(v => (
                <option key={v} value={v}>
                  {tt(`productionEnums.paramType.${v}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">{tt('production.params.fields.required')}</span>
            <input type="checkbox" aria-label={tt('production.params.fields.required')} checked={!!p.required} disabled={!canWrite} onChange={e => patch(i, { required: e.target.checked })} />
          </label>
          <label>
            <span className="label">{tt('production.params.fields.stockDimension')}</span>
            <input type="checkbox" aria-label={tt('production.params.fields.stockDimension')} checked={!!p.stockDimension} disabled={!canWrite} onChange={e => patch(i, { stockDimension: e.target.checked })} />
          </label>
          {p.type === 'select' && (
            <label>
              <span className="label">{tt('production.params.fields.values')}</span>
              <Input
                aria-label={tt('production.params.fields.values')}
                placeholder={tt('production.params.fields.valuesPlaceholder')}
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
              label={tt('production.params.fields.remove')}
              onClick={() => {
                const next = rows.filter((_, n) => n !== i);
                save(next);
                toast(tt('production.params.deleted'));
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
          {tt('production.params.add')}
        </Button>
      )}
    </div>
  );
}
