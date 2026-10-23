/* EntityDrawer — боковая карточка записи: шапка с крошкой и кнопками, редактируемое название, поля «ключ — значение»,
   произвольные секции и вкладки. Устроена по образцу карточки задачи (app/overlays/task-drawer.tsx), но ничего не знает
   о задачах: Esc закрывает, фокус уходит в карточку и возвращается туда, откуда её открыли, в полноэкранном режиме Tab не выходит за её пределы. */
import * as React from 'react';
import { Ellipsis, Maximize2, Minimize2, X, type LucideIcon } from 'lucide-react';
import { IconButton, Menu, MenuContent, MenuTrigger, Tab, Tabs, TabsContent, TabsList } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';

export interface DrawerField {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
}

export interface DrawerTab {
  id: string;
  label: string;
  count?: number;
  content: React.ReactNode;
}

export interface EntityDrawerProps {
  /** Название для скринридера, например «Deal: Fleet analytics pilot» */
  label: string;
  /** Левая часть шапки: тип записи, ссылка на родителя, идентификатор */
  crumb?: React.ReactNode;
  /** Кнопки шапки перед «Full page» */
  actions?: React.ReactNode;
  /** Пункты меню «More» (MenuItem…); без них кнопки нет */
  menu?: React.ReactNode;
  title: string;
  /** Если задано, название редактируется на месте (Enter или потеря фокуса — сохранить) */
  onTitleChange?: (v: string) => void;
  /** Строка под названием */
  subtitle?: React.ReactNode;
  /** Плашка над названием (например, «Won» или «Overdue») */
  banner?: React.ReactNode;
  fields?: DrawerField[];
  /** Секции между полями и вкладками */
  children?: React.ReactNode;
  tabs?: DrawerTab[];
  onClose: () => void;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

/** Название-textarea, которая растёт по содержимому (как .ttl-edit в карточке задачи) */
function TitleInput({ value, onCommit, label }: { value: string; onCommit: (v: string) => void; label: string }) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  React.useLayoutEffect(fit, [value]);
  return (
    <textarea
      ref={ref}
      className="ttl-edit"
      rows={1}
      defaultValue={value}
      aria-label={label}
      onInput={fit}
      onBlur={e => {
        const v = e.currentTarget.value.trim();
        if (v && v !== value) onCommit(v);
        else e.currentTarget.value = value;
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function EntityDrawer({ label, crumb, actions, menu, title, onTitleChange, subtitle, banner, fields, children, tabs, onClose }: EntityDrawerProps) {
  const [full, setFull] = React.useState(false);
  const [enter, setEnter] = React.useState(true);
  const [tab, setTab] = React.useState<string | undefined>(tabs?.[0]?.id);
  const panel = React.useRef<HTMLElement>(null);
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;

  // Анимация входа проигрывается один раз
  React.useEffect(() => {
    const id = window.setTimeout(() => setEnter(false), 600);
    return () => clearTimeout(id);
  }, []);

  // Фокус: в карточку при открытии, назад — при закрытии
  React.useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus({ preventScroll: true });
    return () => {
      const a = document.activeElement;
      if ((!a || a === document.body) && opener?.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
    };
  }, []);

  // Esc закрывает; поповеры и диалоги Radix гасят событие сами (defaultPrevented)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target as HTMLElement;
      if (t.closest?.('input, textarea, [contenteditable="true"]')) t.blur();
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Tab в полноэкранном режиме не уходит за пределы карточки
  const onPanelKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !full) return;
    const f = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(x => x.offsetParent !== null);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && i <= 0) {
      e.preventDefault();
      f[f.length - 1].focus();
    } else if (!e.shiftKey && (i === f.length - 1 || i === -1)) {
      e.preventDefault();
      f[0].focus();
    }
  };

  return (
    <>
      {full && <div className="drawer-scrim full" onClick={onClose} />}
      <aside ref={panel} className={cn('drawer', full && 'full', enter && 'enter')} role="dialog" aria-modal={full} aria-label={label} tabIndex={-1} onKeyDown={onPanelKey}>
        <div className="drawer-h">
          {crumb}
          <span className="sp" />
          {actions}
          <IconButton size="sm" className="hide-m" label={full ? t('ui.sidePanel') : t('ui.fullPage')} aria-label={t('ui.toggleFullPage')} onClick={() => setFull(f => !f)}>
            {full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </IconButton>
          {menu && (
            <Menu>
              <MenuTrigger asChild>
                <IconButton size="sm" label={t('common.more')} tooltip={false}>
                  <Ellipsis size={15} />
                </IconButton>
              </MenuTrigger>
              <MenuContent align="end">{menu}</MenuContent>
            </Menu>
          )}
          <IconButton size="sm" label={t('ui.close')} shortcut="Esc" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="drawer-b">
          {banner && <div style={{ marginBottom: 12 }}>{banner}</div>}
          {onTitleChange ? (
            <TitleInput key={title} value={title} label={t('ui.title')} onCommit={onTitleChange} />
          ) : (
            <h2 className="ttl-edit" style={{ margin: 0 }}>
              {title}
            </h2>
          )}
          {subtitle && <div className="muted" style={{ marginTop: 2 }}>{subtitle}</div>}
          {fields && (
            <dl className="kv" style={{ marginTop: 12, ...(full ? { gridTemplateColumns: '112px minmax(0,1fr) 112px minmax(0,1fr)' } : null) }}>
              {fields.map(f => (
                <React.Fragment key={f.label}>
                  <dt>
                    <f.icon size={14} />
                    {f.label}
                  </dt>
                  <dd>{f.value}</dd>
                </React.Fragment>
              ))}
            </dl>
          )}
          {children}
          {tabs && tab && (
            <div className="dsec">
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList style={{ marginBottom: 6 }}>
                  {tabs.map(t => (
                    <Tab key={t.id} value={t.id} count={t.count}>
                      {t.label}
                    </Tab>
                  ))}
                </TabsList>
                {tabs.map(t => (
                  <TabsContent key={t.id} value={t.id}>
                    {t.content}
                  </TabsContent>
                ))}
              </Tabs>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

/** Секция карточки с заголовком, счётчиком и действиями (.dsec) */
export function DrawerSection({ title, count, actions, children }: { title: string; count?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="dsec">
      <div className="dsec-h">
        <h3>{title}</h3>
        {count != null && <span className="cnt num">{count}</span>}
        {actions && <div className="acts">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
