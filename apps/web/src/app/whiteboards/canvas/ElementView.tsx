// Отрисовка DOM-элементов доски (стикер, фигура, текст, секция, ERP-карточка) и inline-редактирование
import { useEffect, useRef, useState } from 'react';
import type { WbElement, WbErpCard, WbErpEntityType, WbSticky } from './types';

const ENTITY_LABELS: Record<WbErpEntityType, string> = {
  task: 'Задача',
  deal: 'Сделка',
  client: 'Клиент',
  contact: 'Контакт',
  lead: 'Лид',
};

interface ElementViewProps {
  element: WbElement;
  selected: boolean;
  readOnly?: boolean;
  onPointerDown: (e: React.PointerEvent, el: WbElement) => void;
  onUpdateText: (id: string, text: string) => void;
  onConvertStickyToTask?: (el: WbSticky) => void;
  onToggleTaskCard?: (el: WbErpCard) => void;
  onOpenErpCard?: (el: WbErpCard) => void;
}

export function ElementView({
  element,
  selected,
  readOnly,
  onPointerDown,
  onUpdateText,
  onConvertStickyToTask,
  onToggleTaskCard,
  onOpenErpCard,
}: ElementViewProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (element.type === 'arrow' || element.type === 'freehand') return null;

  const startEdit = (initial: string) => {
    if (readOnly) return;
    setDraft(initial);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    onUpdateText(element.id, draft);
  };

  const baseStyle: React.CSSProperties = {
    left: element.x,
    top: element.y,
    width: element.w,
    height: element.h,
    zIndex: element.z ?? 1,
  };

  if (element.type === 'section') {
    return (
      <div
        className={`wb-el wb-section${selected ? ' is-selected' : ''}`}
        style={{
          ...baseStyle,
          borderColor: element.color,
          background: `${element.color}14`,
        }}
        onPointerDown={(e) => onPointerDown(e, element)}
        onDoubleClick={(e) => {
          e.stopPropagation();
          startEdit(element.title);
        }}
      >
        <div className="wb-section-head" style={{ background: element.color }}>
          {editing ? (
            <input
              ref={(node) => { inputRef.current = node; }}
              className="wb-inline-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') commit();
              }}
            />
          ) : (
            <span>{element.title || 'Секция'}</span>
          )}
        </div>
      </div>
    );
  }

  if (element.type === 'sticky') {
    return (
      <div
        className={`wb-el wb-sticky${selected ? ' is-selected' : ''}`}
        style={{ ...baseStyle, background: element.color }}
        onPointerDown={(e) => onPointerDown(e, element)}
        onDoubleClick={(e) => {
          e.stopPropagation();
          startEdit(element.text);
        }}
      >
        {editing ? (
          <textarea
            ref={(node) => { inputRef.current = node; }}
            className="wb-inline-area"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') commit();
            }}
          />
        ) : (
          <div style={{ fontSize: 13.5, lineHeight: 1.38, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>
            {element.text || 'Двойной клик для текста'}
          </div>
        )}
        {!readOnly && onConvertStickyToTask && !editing && (
          <button
            type="button"
            className="wb-sticky-act"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onConvertStickyToTask(element);
            }}
          >
            В задачу →
          </button>
        )}
      </div>
    );
  }

  if (element.type === 'shape') {
    return (
      <div
        className={`wb-el wb-shape${selected ? ' is-selected' : ''}`}
        style={{
          ...baseStyle,
          background: element.fill,
          border: `1.5px solid ${element.stroke ?? '#94a3b8'}`,
          borderRadius: element.kind === 'ellipse' ? '999px' : '12px',
        }}
        onPointerDown={(e) => onPointerDown(e, element)}
        onDoubleClick={(e) => {
          e.stopPropagation();
          startEdit(element.text ?? '');
        }}
      >
        {editing ? (
          <textarea
            ref={(node) => { inputRef.current = node; }}
            className="wb-inline-area"
            style={{ textAlign: 'center' }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') commit();
            }}
          />
        ) : (
          <span style={{ fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{element.text}</span>
        )}
      </div>
    );
  }

  if (element.type === 'text') {
    return (
      <div
        className={`wb-el wb-text${selected ? ' is-selected' : ''}`}
        style={{ ...baseStyle, fontSize: element.fontSize ?? 18, color: element.color ?? 'var(--text)' }}
        onPointerDown={(e) => onPointerDown(e, element)}
        onDoubleClick={(e) => {
          e.stopPropagation();
          startEdit(element.text);
        }}
      >
        {editing ? (
          <textarea
            ref={(node) => { inputRef.current = node; }}
            className="wb-inline-area"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') commit();
            }}
          />
        ) : (
          element.text || 'Текст'
        )}
      </div>
    );
  }

  // Живая ERP-карточка
  return (
    <div
      className={`wb-el wb-erp-card${selected ? ' is-selected' : ''}`}
      style={{
        ...baseStyle,
        borderLeft: element.color ? `3px solid ${element.color}` : undefined,
      }}
      onPointerDown={(e) => onPointerDown(e, element)}
    >
      <div className="wb-erp-top">
        <span className="wb-erp-badge">{ENTITY_LABELS[element.entityType]}</span>
        {element.status && <span className="wb-erp-status">{element.status}</span>}
      </div>
      <div className="wb-erp-body">
        {element.entityType === 'task' && onToggleTaskCard && (
          <input
            type="checkbox"
            checked={Boolean(element.done)}
            disabled={readOnly}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={() => onToggleTaskCard(element)}
            style={{ marginTop: 3, cursor: 'pointer' }}
          />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className={`wb-erp-title${element.done ? ' is-done' : ''}`}>{element.title}</div>
          {element.subtitle && <div className="wb-erp-sub">{element.subtitle}</div>}
        </div>
      </div>
      {onOpenErpCard && (
        <button
          type="button"
          className="wb-erp-open"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onOpenErpCard(element);
          }}
        >
          Открыть →
        </button>
      )}
    </div>
  );
}
