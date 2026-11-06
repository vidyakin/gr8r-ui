/* Бюджет объекта (задача 1270): вкладка карточки — бюджет, факт и остаток по категориям затрат,
   полоса заполнения и перерасход красным. Бюджет — согласованная смета и согласованные допработы,
   факт — проведённые документы и платежи объекта. Суммы видны только owner/admin (сервер отдаёт null). */
import { CircleAlert } from 'lucide-react';
import { dec, div, fmt, OBJECT_COST_CATEGORIES, type ObjectCostCategory } from '@gr8r/shared';
import { EmptyState, Progress, Skeleton } from '@/components/ui';
import { fmtAmount, useT, type TKey } from '@/i18n';
import { useObjectBudget } from './data';

const CATEGORY_LABEL: Record<ObjectCostCategory, TKey> = {
  material: 'objects.budget.category.material',
  labor: 'objects.budget.category.labor',
  subcontract: 'objects.budget.category.subcontract',
  // ключ словаря не 'other': объект с полем other тип принимает за форму множественного числа
  other: 'objects.budget.category.otherCosts',
};

/** Заполнение бюджета в процентах: деньги считаем десятичной арифметикой, ширина полосы — только показ */
const fill = (fact: string | null, budget: string | null): number => {
  if (!fact || !budget || dec(budget) <= 0n) return 0;
  return Number(fmt(div(dec(fact) * 100n, dec(budget)), 1));
};

export function BudgetTab({ objectId }: { objectId: string }) {
  const tt = useT();
  const budget = useObjectBudget(objectId);
  if (budget.isPending) return <Skeleton w="100%" h={120} />;
  if (budget.isError) return <EmptyState icon={<CircleAlert size={20} />} error title={tt('objects.common.error')} />;
  const b = budget.data;
  const rows = OBJECT_COST_CATEGORIES;
  return (
    <div className="stack" style={{ gap: 12 }}>
      {!b.hasEstimate && <p className="faint" style={{ fontSize: 12 }}>{tt('objects.budget.noEstimate')}</p>}
      {!b.canSeeCost && <p className="faint" style={{ fontSize: 12 }}>{tt('objects.budget.hidden')}</p>}
      <div className="table-wrap">
        <table className="dtbl" aria-label={tt('objects.budget.title')}>
          <thead>
            <tr>
              <th>{tt('objects.budget.column.category')}</th>
              <th style={{ width: 140 }} className="r">{tt('objects.budget.column.budget')}</th>
              <th style={{ width: 140 }} className="r">{tt('objects.budget.column.fact')}</th>
              <th style={{ width: 140 }} className="r">{tt('objects.budget.column.rest')}</th>
              <th style={{ width: 160 }}>{tt('objects.budget.column.fill')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(cat => {
              const c = b.categories[cat];
              return (
                <tr key={cat}>
                  <td>{tt(CATEGORY_LABEL[cat])}</td>
                  <td className="r num">{c.budget == null ? '—' : fmtAmount(c.budget)}</td>
                  <td className="r num">{c.fact == null ? '—' : fmtAmount(c.fact)}</td>
                  <td className={c.over ? 'r num neg' : 'r num'}>{c.rest == null ? '—' : fmtAmount(c.rest)}</td>
                  <td>
                    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <Progress value={fill(c.fact, c.budget)} tone={c.over ? 'red' : 'green'} aria-label={tt(CATEGORY_LABEL[cat])} />
                      {c.over && <span className="neg" style={{ fontSize: 11 }}>{tt('objects.budget.over')}</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td><b>{tt('objects.budget.total')}</b></td>
              <td className="r num"><b>{b.totals.budget == null ? '—' : fmtAmount(b.totals.budget)}</b></td>
              <td className="r num"><b>{b.totals.fact == null ? '—' : fmtAmount(b.totals.fact)}</b></td>
              <td className={b.totals.over ? 'r num neg' : 'r num'}><b>{b.totals.rest == null ? '—' : fmtAmount(b.totals.rest)}</b></td>
              <td>
                <Progress value={fill(b.totals.fact, b.totals.budget)} tone={b.totals.over ? 'red' : 'green'} aria-label={tt('objects.budget.total')} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="faint" style={{ fontSize: 11 }}>{tt('objects.budget.hint')}</p>
    </div>
  );
}
