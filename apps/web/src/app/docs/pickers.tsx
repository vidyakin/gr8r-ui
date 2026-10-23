/* Выбор из справочника с поиском на сервере: поле ввода + выпадающий список под ним (Popover в портале, фокус остаётся в поле).
   Клавиатура: набор текста ищет, ↑/↓ выбирают, Enter подтверждает, Esc закрывает; пока список закрыт, стрелки и Enter достаются
   вызывающему коду (навигация по ячейкам табличной части). */
import * as React from 'react';
import { Popover as P } from 'radix-ui';
import { Package, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import { useWsId } from '../meta/data';
import { searchProducts, money, type Product } from '../catalog/data';
import { searchCompanies, type CompanyHit } from './data';

export interface ComboProps<T> {
  /** Текст выбранного значения */
  value: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  'aria-label'?: string;
  className?: string;
  search: (q: string) => Promise<T[]>;
  itemKey: (t: T) => string;
  renderItem: (t: T) => React.ReactNode;
  onPick: (t: T) => void;
  /** Клавиши, которые список не забрал себе (закрыт): навигация по таблице */
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Открывать список при фокусе на пустом поле (подбор без набора) */
  openOnFocus?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  dataCell?: string;
}

export function Combo<T>({ value, placeholder, disabled, invalid, id, className, search, itemKey, renderItem, onPick, onKeyDown, openOnFocus = true, inputRef, dataCell, ...aria }: ComboProps<T>) {
  const [text, setText] = React.useState(value);
  const [editing, setEditing] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<T[]>([]);
  const [hl, setHl] = React.useState(0);
  const seq = React.useRef(0);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wrap = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);
  React.useEffect(() => () => clearTimeout(timer.current), []);

  const run = (q: string, delay: number) => {
    clearTimeout(timer.current);
    const my = ++seq.current;
    timer.current = setTimeout(async () => {
      try {
        const r = await search(q.trim());
        if (my !== seq.current) return;
        setItems(r);
        setHl(0);
        setOpen(true);
      } catch {
        if (my === seq.current) setOpen(false);
      }
    }, delay);
  };
  const close = () => {
    clearTimeout(timer.current);
    seq.current++;
    setOpen(false);
    setEditing(false);
  };
  const pick = (t: T) => {
    close();
    onPick(t);
  };

  return (
    <P.Root open={open && items.length > 0}>
      <P.Anchor asChild>
        <div ref={wrap} className={cn('combo', className)}>
          <input
            ref={inputRef}
            id={id}
            className={cn('input', invalid && 'is-error')}
            aria-invalid={invalid || undefined}
            aria-label={aria['aria-label']}
            role="combobox"
            aria-expanded={open && items.length > 0}
            aria-autocomplete="list"
            autoComplete="off"
            data-cell={dataCell}
            disabled={disabled}
            placeholder={placeholder}
            value={editing ? text : value}
            onFocus={e => {
              e.currentTarget.select();
              if (openOnFocus && !value) run('', 0);
            }}
            onChange={e => {
              setEditing(true);
              setText(e.target.value);
              run(e.target.value, 160);
            }}
            onBlur={() => close()}
            onKeyDown={e => {
              if (open && items.length) {
                if (e.key === 'ArrowDown') (e.preventDefault(), setHl(h => (h + 1) % items.length));
                else if (e.key === 'ArrowUp') (e.preventDefault(), setHl(h => (h - 1 + items.length) % items.length));
                else if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  pick(items[hl]!);
                } else if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), close());
                else if (e.key === 'Tab') close();
                return;
              }
              if (e.key === 'Escape' && editing) {
                e.stopPropagation();
                close();
                return;
              }
              onKeyDown?.(e);
            }}
          />
        </div>
      </P.Anchor>
      <P.Portal>
        <P.Content
          align="start"
          sideOffset={3}
          className="pop combo-pop"
          style={{ width: Math.max(wrap.current?.offsetWidth ?? 0, 300), maxWidth: 'min(520px, 92vw)' }}
          onOpenAutoFocus={e => e.preventDefault()}
          onCloseAutoFocus={e => e.preventDefault()}
          onPointerDownOutside={e => e.preventDefault()}
          onFocusOutside={e => e.preventDefault()}
        >
          <div role="listbox">
            {items.map((t, i) => (
              <button
                key={itemKey(t)}
                type="button"
                role="option"
                aria-selected={i === hl}
                tabIndex={-1}
                className={cn('mi combo-item', i === hl && 'hl')}
                onMouseDown={e => e.preventDefault()}
                onMouseEnter={() => setHl(i)}
                onClick={() => pick(t)}
              >
                {renderItem(t)}
              </button>
            ))}
          </div>
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

/* ---------------- контрагент ---------------- */

export function CounterpartyPicker({ value, onPick, disabled, invalid, id, placeholder }: { value: string; onPick: (c: CompanyHit) => void; disabled?: boolean; invalid?: boolean; id?: string; placeholder?: string }) {
  const ws = useWsId();
  const t = useT();
  return (
    <Combo<CompanyHit>
      id={id}
      value={value}
      disabled={disabled}
      invalid={invalid}
      placeholder={placeholder ?? t('docs.header.counterpartyPlaceholder')}
      search={q => searchCompanies(ws, q)}
      itemKey={c => c.id}
      onPick={onPick}
      renderItem={c => (
        <>
          <span className="trunc grow">{c.name}</span>
          <span className="faint num" style={{ fontSize: 11.5 }}>
            {c.inn || c.city}
          </span>
        </>
      )}
    />
  );
}

/* ---------------- товар из каталога ---------------- */

export function ProductPicker({ value, onPick, disabled, invalid, inputRef, onKeyDown, dataCell, price, placeholder }: { value: string; onPick: (p: Product) => void; disabled?: boolean; invalid?: boolean; inputRef?: React.Ref<HTMLInputElement>; onKeyDown?: ComboProps<Product>['onKeyDown']; dataCell?: string; price: 'price' | 'purchasePrice'; placeholder?: string }) {
  const ws = useWsId();
  const t = useT();
  return (
    <Combo<Product>
      aria-label={t('docs.pickers.productAria')}
      value={value}
      disabled={disabled}
      invalid={invalid}
      placeholder={placeholder ?? t('docs.pickers.productPlaceholder')}
      inputRef={inputRef}
      onKeyDown={onKeyDown}
      dataCell={dataCell}
      search={q => searchProducts(ws, q, undefined, 10)}
      itemKey={p => p.id}
      onPick={onPick}
      renderItem={p => (
        <>
          {p.kind === 'service' ? <Wrench size={13} className="faint" /> : <Package size={13} className="faint" />}
          <span className="trunc grow">{p.name}</span>
          {p.sku && <span className="mono faint" style={{ fontSize: 11 }}>{p.sku}</span>}
          <span className="num muted" style={{ fontSize: 12 }}>{money(p[price])}</span>
        </>
      )}
    />
  );
}
