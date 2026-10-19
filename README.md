# Gr8r UI

Приложение [Gr8r Studio](https://github.com/gr8rstudio/gr8r-studio) (бесплатный шаблон Setproduct), перенесённая на React.
Внешний вид, токены и CSS взяты из оригинала. Поведение, которое в оригинале было написано вручную (меню, выпадающие списки,
диалоги, тултипы, табы, фокус и клавиатура), теперь берут на себя примитивы [Radix](https://www.radix-ui.com).
Проект совместим с [shadcn/ui](https://ui.shadcn.com): компоненты, добавленные через `npx shadcn add …`, сразу выглядят как Gr8r.

![Home](docs/preview-home.png)

## Запуск

```bash
npm install
npm run dev        # приложение: http://localhost:5173, витрина компонентов — #/design-system
npm run build      # проверка типов + production-сборка
```

Стек: React 19, TypeScript, Vite, Tailwind CSS v4, Radix UI, lucide-react, sonner (тосты).

## Структура

```
src/
  styles/
    tokens.css          токены Gr8r без изменений: цвета, отступы, радиусы, шрифты, тёмная тема, акценты, плотность
    shadcn-bridge.css   привязка классов Tailwind/shadcn (bg-primary, border-input…) к токенам Gr8r
    base.css            базовые стили (из оригинала)
    components.css      кнопки, поля, чекбоксы, табы, бейджи, аватары, прогресс (из оригинала)
    overlays.css        модалка, поповер, меню, select, тултип, тост (анимации переведены на data-state Radix)
    states.css          alert, empty state, skeleton (из оригинала)
    domain.css          карточка задачи, срок
  components/
    ui/                 базовые компоненты Gr8r, импорт из '@/components/ui'
    gr8r/               прикладные компоненты: TaskCard, StatusIcon, PriorityIcon, DueDate
    shadcn/             сюда CLI shadcn кладёт добавленные компоненты (сейчас для примера: button, card, calendar)
  lib/utils.ts          cn(): clsx + tailwind-merge
  app/                  приложение Gr8r Studio на этих компонентах
    data/               типы, демо-данные (seed), функции-выборки, хранилище (reducer + context)
    lib/dates.ts        форматирование дат
    components/         компоненты, знающие о данных: аватар участника, строка задачи, лента активности, иконка проекта
    layout/             AppShell, Sidebar, Topbar, UserMenu
    pages/              страницы: HomePage, DesignSystemPage (витрина), PlaceholderPage (заглушка)
    routes.ts           список разделов: из него строятся меню, крошки и заголовок вкладки
    router.tsx          маршруты (react-router, hash-режим, как в оригинале)
```

## Приложение

Перенос из gr8r-studio идёт по странице за раз. Готово: оболочка (сайдбар со сворачиванием по `[`, топбар,
мобильная навигация), **Home**, **Inbox**, **My Tasks** (список и календарь), **Favorites**, **Notifications**. Остальные разделы открывают заглушку; чтобы перенести раздел, замените
`PlaceholderPage` на его компонент в `src/app/router.tsx`.

Чем устройство отличается от оригинала:

- **Данные меняются только через `dispatch(action)`** в `app/data/store.tsx`; компоненты читают их через `useWorkspace()`.
  В оригинале любой модуль мог напрямую менять глобальный объект `S`.
- **Выборки — чистые функции** (`app/data/selectors.ts`): их можно тестировать без браузера.
- **Нет ручного восстановления фокуса и прокрутки**: React обновляет только изменившиеся узлы.
- **Состояние экрана живёт в компоненте** (вкладка «My tasks», свёрнутость сайдбара), а не в общем `S.ui`.

Пока не перенесено: карточка задачи (drawer), создание задач и проектов, поиск и палитра команд.
Соответствующие кнопки показывают уведомление «пока не перенесено».

## Компоненты

| Компонент | Основа | Что умеет |
| --- | --- | --- |
| `Button` | `<button>` / Radix Slot | `variant`: primary, secondary, ghost, danger, danger-ghost; `size`: sm, md, lg; `loading`; `block`; `asChild` |
| `IconButton` | `<button>` + Tooltip | подпись `label` обязательна (уходит в aria-label и тултип), `shortcut`, `active`, `size`: xs, sm, md |
| `Input`, `Textarea` | нативные | `icon`, `kbd`, `invalid`, `size` |
| `Field` | — | связывает label, hint и error с полем через `id` и `aria-describedby` |
| `Select` | Radix Select | список `options` с иконками, `placeholder`, `invalid` |
| `Checkbox`, `Switch`, `Radio`, `Choice` | нативные | `indeterminate`, `round` |
| `Segmented` | Radix ToggleGroup | сегментированный переключатель |
| `Tabs`, `TabsList`, `Tab`, `TabsContent` | Radix Tabs | счётчик `count` |
| `Menu*`, `ContextMenu*` | Radix DropdownMenu / ContextMenu | заголовки, разделители, `shortcut`, `danger`, пункты с галочкой и радио |
| `Popover*` | Radix Popover | произвольное содержимое в той же «таблетке» |
| `Dialog`, `DialogContent`, `ConfirmDialog` | Radix Dialog | `title`, `description`, `footer`, `size`: sm, md, lg |
| `Tooltip` | Radix Tooltip | `shortcut`, `side` |
| `Badge`, `Label`, `Chip`, `Kbd` | — | тона, цветная точка, снимаемый фильтр |
| `Avatar`, `AvatarStack` | — | инициалы, цвет выбирается по имени, `online`, размеры sm–xl |
| `Progress`, `StackBar` | — | тона green, amber, red |
| `Alert`, `EmptyState`, `Skeleton` | — | |
| `toast`, `Toaster` | sonner | `toast()`, `toast.error()`, `toast.info()`, кнопка действия |
| `Gr8rProvider`, `usePrefs` | — | тема (system/light/dark), акцент (6 вариантов), плотность; сохраняются в localStorage |

```tsx
import { Button, Field, Input, toast } from '@/components/ui';

<Field label="Название" error={err}>
  {p => <Input {...p} />}
</Field>
<Button variant="primary" onClick={() => toast('Сохранено')}>Сохранить</Button>
```

## Как добавлять готовые компоненты shadcn

```bash
npx shadcn@latest add calendar      # или dialog, command, sheet, data-table, chart, sidebar…
```

`components.json` уже настроен: файлы попадут в `src/components/shadcn/`, а `cn` подключится из `@/lib/utils`.
Отдельная настройка темы не нужна: классы, на которые опираются компоненты shadcn, привязаны к токенам в `shadcn-bridge.css`.

| Класс shadcn | Токен Gr8r |
| --- | --- |
| `bg-background`, `text-foreground` | `--bg`, `--text` |
| `bg-card`, `bg-popover` | `--surface` |
| `bg-primary`, `text-primary-foreground`, `ring-ring` | `--accent`, `--on-accent` (переключаемый акцент) |
| `bg-secondary`, `bg-muted`, `bg-accent` | `--surface-2` (в shadcn «accent» означает фон при наведении) |
| `text-muted-foreground` | `--text-3` |
| `border-border`, `border-input` | `--border`, `--border-strong` |
| `bg-destructive` | `--red` |
| `rounded-md`, `rounded-lg` | `--r-sm`, `--r` |

**Не запускайте `npx shadcn init`**: эта команда перезапишет `src/styles/index.css` своей палитрой.
Если CLI спросит, можно ли менять CSS, откажитесь.

Палитра Gr8r тоже доступна как обычные цвета Tailwind: `bg-surface-2`, `text-text-3`, `border-border-strong`, `text-st-done`,
`bg-brand-soft` и т. д. Шкалы `--s-*` и `--h-*` используются через произвольные значения: `h-[var(--h-md)]`, `px-[var(--gutter)]`.

## Как написать свой компонент

1. Если нужно поведение (открытие, фокус, клавиатура), возьмите примитив Radix или компонент shadcn.
2. Стилизуйте его токенами: либо утилитами Tailwind (`bg-surface text-text-2 rounded-lg`), либо классом в `src/styles/*.css`
   внутри `@layer components`, как сделаны базовые компоненты.
3. Принимайте `className` и склеивайте его через `cn()`: утилиты Tailwind перекрывают классы компонента.

Пример прикладного компонента, собранного из базовых: `src/components/gr8r/task.tsx`.

## Тема

Тема, акцент и плотность задаются атрибутами на `<html>`, как в оригинале: `data-theme="dark"`, `data-accent="teal"`,
`data-density="compact"`. Их выставляет `Gr8rProvider`. Вариант `dark:` в Tailwind настроен на эти же атрибуты.
Новый акцент добавляется одним блоком в `tokens.css`:

```css
:root[data-accent='orange'] { --acc-l: #c0612b; --acc-d: #e3925f; }
```
