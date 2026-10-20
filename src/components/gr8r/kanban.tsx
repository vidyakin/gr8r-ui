/* Kanban<T> — обобщённая доска: колонки, карточки, перетаскивание с линией вставки, сворачивание колонок, кнопка «+».
   Разметка и CSS-классы (.board, .bcol, .kcard…) те же, что у доски задач (app/components/board-view.tsx),
   но компонент ничего не знает о задачах: карточку рисует renderCard, порядок и этап меняет onMove. */
import * as React from 'react';
import { FoldHorizontal, Plus } from 'lucide-react';
import { Tooltip } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface KanbanColumn {
  id: string;
  /** Подпись колонки; для aria-label берётся name (или title, если это строка) */
  title: React.ReactNode;
  name?: string;
  /** Значок слева от названия */
  icon?: React.ReactNode;
  /** Строка под названием (например, сумма колонки) */
  subtitle?: React.ReactNode;
  /** Итог внизу колонки */
  footer?: React.ReactNode;
}

export interface KanbanProps<T> {
  columns: KanbanColumn[];
  /** Карточки уже отсортированы так, как их нужно показать внутри колонки */
  items: T[];
  getId: (item: T) => string;
  getColumn: (item: T) => string;
  renderCard: (item: T) => React.ReactNode;
  /** Карточку бросили в колонку; beforeId — карточка, перед которой встаём (null — в конец) */
  onMove?: (item: T, column: string, beforeId: string | null) => void;
  /** Кнопка «+» в шапке колонки и внизу; без неё кнопок нет */
  onAdd?: (column: string) => void;
  /** В каких колонках показывать «+» (по умолчанию во всех) */
  canAdd?: (column: string) => boolean;
  addLabel?: string;
  /** Текст в пустой колонке */
  emptyText?: string;
  className?: string;
  'aria-label'?: string;
}

const colName = (c: KanbanColumn) => c.name ?? (typeof c.title === 'string' ? c.title : c.id);

export function Kanban<T>({ columns, items, getId, getColumn, renderCard, onMove, onAdd, canAdd, addLabel = 'Add item', emptyText = 'Nothing here', className, ...rest }: KanbanProps<T>) {
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
  const [dragId, setDragId] = React.useState<string | null>(null);
  // Куда упадёт карточка: колонка и карточка, перед которой вставляем (null — в конец)
  const [drop, setDrop] = React.useState<{ col: string; before: string | null } | null>(null);

  const clearDrag = () => {
    setDragId(null);
    setDrop(null);
  };

  const onDragOver = (e: React.DragEvent<HTMLElement>, col: string) => {
    if (!dragId || !onMove) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('.kb-item:not(.dragging)')];
    const after = cards.find(c => {
      const r = c.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    const before = after?.dataset.card ?? null;
    setDrop(d => (d && d.col === col && d.before === before ? d : { col, before }));
  };

  const onDrop = (e: React.DragEvent) => {
    if (!dragId || !drop || !onMove) return;
    e.preventDefault();
    const item = items.find(x => getId(x) === dragId);
    const { col, before } = drop;
    clearDrag();
    if (item) onMove(item, col, before);
  };

  return (
    <div className={cn('board', className)} {...rest}>
      {columns.map(c => {
        const col = items.filter(x => getColumn(x) === c.id);
        const over = drop?.col === c.id;
        const name = colName(c);
        const add = onAdd && (!canAdd || canAdd(c.id)) ? onAdd : undefined;
        if (collapsed[c.id])
          return (
            <div
              key={c.id}
              className={cn('bcol collapsed', over && 'over')}
              role="button"
              tabIndex={0}
              aria-label={`Expand ${name}`}
              title="Expand"
              onClick={() => setCollapsed(s => ({ ...s, [c.id]: false }))}
              onKeyDown={e => e.key === 'Enter' && setCollapsed(s => ({ ...s, [c.id]: false }))}
              onDragOver={e => onDragOver(e, c.id)}
              onDrop={onDrop}
            >
              {c.icon}
              <span className="vname">
                {c.title}
                <span className="faint">{col.length}</span>
              </span>
            </div>
          );
        const line = <div className="drop-line" />;
        return (
          <section
            key={c.id}
            className={cn('bcol', over && 'over')}
            aria-label={name}
            onDragOver={e => onDragOver(e, c.id)}
            onDragLeave={e => !e.currentTarget.contains(e.relatedTarget as Node) && setDrop(null)}
            onDrop={onDrop}
          >
            <div className="bcol-h">
              {c.icon}
              <span>{c.title}</span>
              <span className="cnt">{col.length}</span>
              <span className="acts">
                {add && (
                  <Tooltip content={addLabel}>
                    <button className="ibtn ibtn-xs" aria-label={`${addLabel} in ${name}`} onClick={() => add(c.id)}>
                      <Plus size={14} />
                    </button>
                  </Tooltip>
                )}
                <Tooltip content="Collapse column">
                  <button className="ibtn ibtn-xs" aria-label={`Collapse ${name}`} onClick={() => setCollapsed(s => ({ ...s, [c.id]: true }))}>
                    <FoldHorizontal size={14} />
                  </button>
                </Tooltip>
              </span>
            </div>
            {c.subtitle && <div className="bcol-sub">{c.subtitle}</div>}
            <div className="bcol-b">
              {col.map(x => {
                const id = getId(x);
                return (
                  <React.Fragment key={id}>
                    {over && drop?.before === id && line}
                    <div
                      className={cn('kb-item', dragId === id && 'dragging')}
                      data-card={id}
                      draggable={!!onMove}
                      onDragStart={e => {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', id);
                        // Класс .dragging ставим после старта, иначе браузер снимет «призрак» уже полупрозрачным
                        setTimeout(() => setDragId(id), 0);
                      }}
                      onDragEnd={clearDrag}
                    >
                      {renderCard(x)}
                    </div>
                  </React.Fragment>
                );
              })}
              {over && drop?.before === null && line}
              {!col.length && !over && <div className="kb-empty">{emptyText}</div>}
              {add && (
                <button className="addcard" onClick={() => add(c.id)}>
                  <Plus size={14} />
                  {addLabel}
                </button>
              )}
            </div>
            {c.footer && <div className="bcol-f">{c.footer}</div>}
          </section>
        );
      })}
    </div>
  );
}
