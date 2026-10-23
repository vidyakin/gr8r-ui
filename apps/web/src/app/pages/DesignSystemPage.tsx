import * as React from 'react';
import {
  Archive,
  Copy,
  FolderKanban,
  Inbox,
  LayoutGrid,
  Link,
  List,
  Moon,
  Plus,
  Search,
  Settings,
  Star,
  Sun,
  SunMoon,
  Trash2,
  User,
} from 'lucide-react';
import {
  Alert,
  Avatar,
  AvatarStack,
  Badge,
  Button,
  Checkbox,
  Chip,
  Choice,
  ConfirmDialog,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  EmptyState,
  Field,
  IconButton,
  Input,
  Kbd,
  Label,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
  Radio,
  Segmented,
  Select,
  Skeleton,
  StackBar,
  Switch,
  Tab,
  Tabs,
  TabsContent,
  TabsList,
  Textarea,
  toast,
  usePrefs,
  type Accent,
} from '@/components/ui';
import { Calendar } from '@/components/shadcn/calendar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/shadcn/card';
import { PRIORITIES, PriorityIcon, priorityName, STATUSES, StatusIcon, TaskCard, type Task } from '@/components/gr8r/task';
import { fmtDateTimeIntl } from '@/i18n';

const d = (n: number) => new Date(Date.now() + n * 864e5);
const TASKS: Task[] = [
  { id: '1', key: 'WEB-12', title: 'Собрать дизайн-систему на React', status: 'progress', priority: 8, assignee: 'Анна Смирнова', due: d(1), labels: [{ name: 'Design', color: 'var(--violet)' }], subtasks: { done: 3, total: 5 }, comments: 4 },
  { id: '2', key: 'WEB-14', title: 'Подключить shadcn/ui и проверить темы', status: 'todo', priority: 5, assignee: 'Игорь Петров', due: d(4), labels: [{ name: 'Frontend', color: 'var(--blue)' }], attachments: 2 },
  { id: '3', key: 'WEB-9', title: 'Исправить контраст в тёмной теме', status: 'todo', priority: 10, due: d(-2), labels: [{ name: 'Bug', color: 'var(--red)' }] },
  { id: '4', key: 'WEB-7', title: 'Описать токены в README', status: 'done', priority: 3, assignee: 'Мария Ким', due: d(-1), subtasks: { done: 2, total: 2 } },
];

const ACCENTS: { id: Accent; c: string }[] = [
  { id: 'indigo', c: '#4b5bd6' },
  { id: 'blue', c: '#2f6cd4' },
  { id: 'violet', c: '#7348cc' },
  { id: 'teal', c: '#1a7f7a' },
  { id: 'rose', c: '#b93d68' },
  { id: 'graphite', c: '#34332f' },
];

function Section({ id, title, children, note }: { id: string; title: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-b border-divider py-8">
      <h2 className="mb-1 text-base font-semibold">{title}</h2>
      {note && <p className="mb-4 max-w-2xl text-xs text-text-3">{note}</p>}
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}
const Row = ({ children }: { children: React.ReactNode }) => <div className="flex flex-wrap items-center gap-2">{children}</div>;

function PageHeader() {
  const { prefs, setPrefs } = usePrefs();
  return (
    <div className="ph items-center!">
      <div>
        <h1>Design system</h1>
        <p>Компоненты Gr8r UI на React + Radix. Тема, акцент и плотность применяются ко всему приложению.</p>
      </div>
      <div className="acts">
      <Segmented
        aria-label="Тема"
        value={prefs.theme}
        onValueChange={theme => setPrefs({ theme })}
        items={[
          { value: 'light', icon: <Sun size={13} />, 'aria-label': 'Светлая' },
          { value: 'system', icon: <SunMoon size={13} />, 'aria-label': 'Системная' },
          { value: 'dark', icon: <Moon size={13} />, 'aria-label': 'Тёмная' },
        ]}
      />
      <div className="hidden items-center gap-1 sm:flex" role="radiogroup" aria-label="Акцент">
        {ACCENTS.map(a => (
          <button
            key={a.id}
            role="radio"
            aria-checked={prefs.accent === a.id}
            aria-label={a.id}
            onClick={() => setPrefs({ accent: a.id })}
            className="size-[18px] rounded-full ring-offset-2 ring-offset-bg aria-checked:ring-2 aria-checked:ring-text-3"
            style={{ background: a.c }}
          />
        ))}
      </div>
      <Segmented
        aria-label="Плотность"
        value={prefs.density}
        onValueChange={density => setPrefs({ density })}
        items={[
          { value: 'comfortable', label: 'Обычно' },
          { value: 'compact', label: 'Плотно' },
        ]}
      />
      </div>
    </div>
  );
}

export function DesignSystemPage() {
  const [prio, setPrio] = React.useState('8');
  const [view, setView] = React.useState<'list' | 'board'>('board');
  const [confirm, setConfirm] = React.useState(false);
  const [showDone, setShowDone] = React.useState(true);
  const [tasks, setTasks] = React.useState(TASKS);
  const [loading, setLoading] = React.useState(false);
  const [day, setDay] = React.useState<Date | undefined>(new Date());

  const toggleDone = (t: Task) => setTasks(ts => ts.map(x => (x.id === t.id ? { ...x, status: x.status === 'done' ? 'todo' : 'done' } : x)));

  return (
    <div className="page">
      <PageHeader />
      <div>
        <Section id="buttons" title="Кнопки" note="Button: primary / secondary / ghost / danger / danger-ghost, размеры sm/md/lg, loading, asChild. IconButton всегда с подписью — она же тултип.">
          <Row>
            <Button variant="primary">
              <Plus size={14} />
              Новая задача
            </Button>
            <Button>Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Удалить</Button>
            <Button variant="danger-ghost">Danger ghost</Button>
            <Button variant="primary" loading={loading} onClick={() => (setLoading(true), setTimeout(() => setLoading(false), 1500))}>
              Сохранить
            </Button>
            <Button disabled>Disabled</Button>
          </Row>
          <Row>
            <Button size="sm" variant="primary">
              Small
            </Button>
            <Button size="lg" variant="primary">
              Large
            </Button>
            <Button asChild variant="ghost">
              <a href="#forms">
                <Link size={14} />
                Ссылка-кнопка
              </a>
            </Button>
            <IconButton label="Поиск" shortcut="/">
              <Search size={15} />
            </IconButton>
            <IconButton label="В избранное" active>
              <Star size={15} />
            </IconButton>
            <IconButton size="sm" label="Настройки">
              <Settings size={14} />
            </IconButton>
          </Row>
        </Section>

        <Section id="forms" title="Поля ввода" note="Input (иконка, kbd, ошибка), Textarea, Select на Radix, Field связывает label, hint и error через aria.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Название задачи" hint="Коротко и по делу">
              {p => <Input placeholder="Например, «Обновить онбординг»" {...p} />}
            </Field>
            <Field label="Email" error="Неверный формат адреса">
              {p => <Input defaultValue="anna@" {...p} />}
            </Field>
            <Field label="Приоритет">
              {p => (
                <Select
                  {...p}
                  value={prio}
                  onValueChange={setPrio}
                  options={PRIORITIES.map(x => ({ value: String(x), label: priorityName(x), icon: <PriorityIcon priority={x} /> }))}
                />
              )}
            </Field>
            <Field label="Поиск">{p => <Input icon={<Search size={14} />} kbd="/" placeholder="Искать задачи" {...p} />}</Field>
            <Field label="Описание" className="sm:col-span-2">
              {p => <Textarea placeholder="Добавьте детали…" {...p} />}
            </Field>
          </div>
          <Row>
            <Choice>
              <Checkbox defaultChecked /> Чекбокс
            </Choice>
            <Choice>
              <Checkbox indeterminate /> Частично
            </Choice>
            <Choice>
              <Checkbox round /> Круглый
            </Choice>
            <Choice>
              <Switch defaultChecked /> Уведомления
            </Choice>
            <Choice>
              <Radio name="r" defaultChecked /> Вариант A
            </Choice>
            <Choice>
              <Radio name="r" /> Вариант B
            </Choice>
          </Row>
        </Section>

        <Section id="nav" title="Табы и переключатели">
          <Tabs defaultValue="board">
            <TabsList>
              <Tab value="overview">Обзор</Tab>
              <Tab value="board" count={12}>
                Доска
              </Tab>
              <Tab value="list" count={12}>
                Список
              </Tab>
              <Tab value="files" count={3}>
                Файлы
              </Tab>
            </TabsList>
            <TabsContent value="overview" className="py-3 text-text-2">
              Содержимое вкладки «Обзор»
            </TabsContent>
            <TabsContent value="board" className="py-3 text-text-2">
              Содержимое вкладки «Доска»
            </TabsContent>
            <TabsContent value="list" className="py-3 text-text-2">
              Содержимое вкладки «Список»
            </TabsContent>
            <TabsContent value="files" className="py-3 text-text-2">
              Содержимое вкладки «Файлы»
            </TabsContent>
          </Tabs>
          <Row>
            <Segmented
              value={view}
              onValueChange={setView}
              items={[
                { value: 'list', label: 'Список', icon: <List size={13} /> },
                { value: 'board', label: 'Доска', icon: <LayoutGrid size={13} /> },
              ]}
            />
          </Row>
        </Section>

        <Section id="data" title="Бейджи, метки, аватары, прогресс">
          <Row>
            <Badge>Нейтральный</Badge>
            <Badge tone="accent" dot>
              Активен
            </Badge>
            <Badge tone="green" dot>
              Готово
            </Badge>
            <Badge tone="amber">На паузе</Badge>
            <Badge tone="red">Под угрозой</Badge>
            <Badge tone="violet">Ревью</Badge>
            <Label color="var(--violet)">Design</Label>
            <Label color="var(--blue)">Frontend</Label>
            <Label color="var(--teal)">Backend</Label>
            <Chip name="Статус:" onRemove={() => toast.info('Фильтр снят')}>
              В работе
            </Chip>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </Row>
          <Row>
            {STATUSES.map(s => (
              <span key={s.id} className="inline-flex items-center gap-1.5 text-sm">
                <StatusIcon status={s.id} />
                {s.name}
              </span>
            ))}
          </Row>
          <Row>
            <Avatar name="Анна Смирнова" size="sm" />
            <Avatar name="Игорь Петров" />
            <Avatar name="Мария Ким" size="md" online />
            <Avatar name="Олег Иванов" size="lg" />
            <Avatar name="Tanjim Islam" size="xl" />
            <Avatar />
            <AvatarStack people={['Анна Смирнова', 'Игорь Петров', 'Мария Ким', 'Олег Иванов', 'Нина Ли', 'Павел Орлов']} />
          </Row>
          <div className="grid max-w-md gap-3">
            <Progress value={62} aria-label="Прогресс проекта" />
            <Progress value={100} tone="green" />
            <Progress value={35} tone="amber" />
            <StackBar
              parts={[
                { value: 5, color: 'var(--st-done)', label: 'Готово' },
                { value: 3, color: 'var(--st-review)', label: 'Ревью' },
                { value: 4, color: 'var(--st-progress)', label: 'В работе' },
                { value: 6, color: 'var(--st-todo)', label: 'К работе' },
              ]}
            />
          </div>
        </Section>

        <Section id="overlays" title="Меню, поповер, диалоги, тосты" note="Всё поведение (фокус, клавиатура, позиционирование, закрытие по Esc/клику мимо) — Radix; вид — классы Gr8r. По правому клику на пунктирной области открывается контекстное меню.">
          <Row>
            <Menu>
              <MenuTrigger asChild>
                <Button>Меню действий</Button>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>Задача</MenuLabel>
                <MenuItem icon={<Copy size={15} />} shortcut="⌘D">
                  Дублировать
                </MenuItem>
                <MenuItem icon={<Link size={15} />}>Скопировать ссылку</MenuItem>
                <MenuItem icon={<Archive size={15} />}>В архив</MenuItem>
                <MenuSeparator />
                <MenuCheckboxItem checked={showDone} onCheckedChange={setShowDone}>
                  Показывать завершённые
                </MenuCheckboxItem>
                <MenuSeparator />
                <MenuItem danger icon={<Trash2 size={15} />} onSelect={() => setConfirm(true)}>
                  Удалить
                </MenuItem>
              </MenuContent>
            </Menu>
            <Popover>
              <PopoverTrigger asChild>
                <Button>
                  <User size={14} />
                  Исполнитель
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64">
                <div className="flex flex-col gap-2">
                  <Input size="sm" icon={<Search size={13} />} placeholder="Найти участника" autoFocus />
                  {['Анна Смирнова', 'Игорь Петров', 'Мария Ким'].map(n => (
                    <button key={n} className="mi" onClick={() => toast(`Назначено: ${n}`)}>
                      <Avatar name={n} size="sm" tooltip={false} />
                      {n}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="primary">Новый проект</Button>
              </DialogTrigger>
              <DialogContent
                title="Новый проект"
                description="Проект объединяет задачи, участников и файлы."
                footer={
                  <>
                    <span className="sp" />
                    <DialogClose asChild>
                      <Button variant="ghost">Отмена</Button>
                    </DialogClose>
                    <DialogClose asChild>
                      <Button variant="primary" onClick={() => toast('Проект создан')}>
                        Создать
                      </Button>
                    </DialogClose>
                  </>
                }
              >
                <Field label="Название">{p => <Input placeholder="Website Launch" autoFocus {...p} />}</Field>
                <Field label="Описание" hint="Необязательно">
                  {p => <Textarea {...p} />}
                </Field>
              </DialogContent>
            </Dialog>
            <Button variant="danger-ghost" onClick={() => setConfirm(true)}>
              Подтверждение
            </Button>
            <ConfirmDialog open={confirm} onOpenChange={setConfirm} danger title="Удалить задачу?" description="Это действие нельзя отменить." confirmLabel="Удалить" onConfirm={() => toast('Задача удалена', { action: { label: 'Отменить', onClick: () => toast.info('Восстановлено') } })} />
          </Row>
          <Row>
            <Button onClick={() => toast('Изменения сохранены')}>Тост: успех</Button>
            <Button onClick={() => toast.error('Не удалось сохранить. Нет сети.', { action: { label: 'Повторить', onClick: () => toast('Сохранено') } })}>Тост: ошибка</Button>
            <Button onClick={() => toast.info('Синхронизация запущена')}>Тост: инфо</Button>
          </Row>
          <ContextMenu>
            <ContextMenuTrigger className="grid h-20 place-items-center rounded-lg border border-dashed border-border-strong text-sm text-text-3">Правый клик здесь</ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem icon={<Copy size={15} />} shortcut="⌘C">
                Копировать
              </ContextMenuItem>
              <ContextMenuItem icon={<Star size={15} />}>В избранное</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem danger icon={<Trash2 size={15} />}>
                Удалить
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </Section>

        <Section id="states" title="Состояния">
          <Alert tone="info" title="Подсказка.">
            Нажмите <Kbd>⌘K</Kbd>, чтобы открыть палитру команд.
          </Alert>
          <Alert tone="ok">Все изменения синхронизированы.</Alert>
          <Alert tone="warn" title="Внимание.">
            Срок проекта истекает через 2 дня.
          </Alert>
          <Alert tone="danger" title="Ошибка." action={<Button size="sm">Повторить</Button>}>
            Не удалось загрузить файлы.
          </Alert>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg shadow-[var(--shadow-card)]">
              <EmptyState icon={<Inbox />} title="Входящие пусты" action={<Button size="sm">Обновить</Button>}>
                Здесь появятся упоминания и назначения.
              </EmptyState>
            </div>
            <div className="flex flex-col gap-3 rounded-lg p-4 shadow-[var(--shadow-card)]">
              <Skeleton w="40%" h={14} />
              <Skeleton w="90%" />
              <Skeleton w="75%" />
              <div className="flex items-center gap-2">
                <Skeleton w={22} h={22} className="rounded-full" />
                <Skeleton w="30%" />
              </div>
            </div>
          </div>
        </Section>

        <Section id="board" title="Доменные компоненты: доска" note="TaskCard, StatusIcon, PriorityIcon, DueDate — собраны из базовых компонентов. Наведите на карточку — появятся быстрые действия.">
          <div className="grid gap-3 sm:grid-cols-3">
            {(['todo', 'progress', 'done'] as const).map(st => {
              const col = tasks.filter(t => t.status === st && (showDone || st !== 'done'));
              return (
                <div key={st} className="flex flex-col gap-2 rounded-lg bg-surface-2 p-2">
                  <div className="flex items-center gap-2 px-1 py-1 text-sm font-medium">
                    <StatusIcon status={st} />
                    {STATUSES.find(s => s.id === st)!.name}
                    <span className="text-xs text-text-3">{col.length}</span>
                  </div>
                  {col.map(t => (
                    <TaskCard key={t.id} task={t} onOpen={x => toast.info(`Открыть ${x.key}`)} onToggleDone={toggleDone} />
                  ))}
                  {!col.length && (
                    <EmptyState size="sm" icon={<FolderKanban />} title="Пусто">
                      Перетащите задачу сюда
                    </EmptyState>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        <Section id="shadcn" title="Готовые компоненты shadcn — без правок" note="Card и Calendar скопированы из реестра shadcn как есть (так же, как их добавляет npx shadcn add). Цвета, радиусы, шрифт и тема пришли из токенов Gr8r.">
          <div className="flex flex-wrap items-start gap-4">
            <Calendar mode="single" selected={day} onSelect={setDay} className="rounded-lg border" />
            <Card className="w-72">
              <CardHeader>
                <CardTitle>Website Launch</CardTitle>
                <CardDescription>shadcn Card внутри Gr8r</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <span>Выбрана дата: {day ? fmtDateTimeIntl(day, { dateStyle: 'short' }) : '—'}</span>
                <Progress value={62} />
                <AvatarStack people={['Анна Смирнова', 'Игорь Петров', 'Мария Ким']} />
              </CardContent>
            </Card>
          </div>
        </Section>

        <Section id="tailwind" title="Совместимость с shadcn / Tailwind" note="Классы, которыми пользуются компоненты shadcn, привязаны к токенам Gr8r. Переключите тему и акцент наверху — эти блоки меняются вместе со всем остальным.">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-primary p-4 text-primary-foreground">bg-primary</div>
            <div className="rounded-lg border border-input bg-card p-4 text-card-foreground shadow-sm">bg-card + border-input</div>
            <div className="rounded-lg bg-muted p-4 text-muted-foreground">bg-muted</div>
            <div className="rounded-lg bg-accent p-4 text-accent-foreground">bg-accent (hover-фон)</div>
            <div className="rounded-lg bg-destructive p-4 text-white">bg-destructive</div>
            <button className="rounded-md border border-input bg-background px-3 py-2 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30">focus-visible:ring-ring</button>
          </div>
        </Section>
      </div>
    </div>
  );
}
