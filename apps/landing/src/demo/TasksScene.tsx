/* Запись «Задачи и проекты»: доска проекта — создание задачи в колонке и перенос карточки в «Готово». Разметка — как у board-view.tsx */
import { Calendar, Ellipsis, Plus } from 'lucide-react';
import { Av, DemoShell, Lbl, Prio, StatusIcon } from './shell';
import type { Scene } from './player';

type Col = 'backlog' | 'todo' | 'progress' | 'done';
interface Card {
  key: string;
  title: string;
  labels: [string, string][];
  prio: number;
  due?: string;
  late?: boolean;
  av: [string, string];
}
interface S {
  cols: Record<Col, Card[]>;
  /** Текст новой задачи, пока её набирают; null — формы нет */
  adding: string | null;
  drag: string | null;
  over: Col | null;
  fresh: string | null;
}

const COLS: [Col, string][] = [
  ['backlog', 'Бэклог'],
  ['todo', 'К выполнению'],
  ['progress', 'В работе'],
  ['done', 'Готово'],
];

const card = (key: string, title: string, labels: [string, string][], prio: number, av: [string, string], due?: string, late?: boolean): Card => ({ key, title, labels, prio, av, due, late });

const initial: S = {
  cols: {
    backlog: [card('WEB-131', 'Тексты для раздела «Доставка»', [['Контент', 'rose']], 3, ['ИВ', '#C48A1E'], '14 нояб.'), card('WEB-133', 'Настроить события аналитики', [['Бэкенд', 'teal']], 5, ['МЛ', '#8662C9'])],
    todo: [card('WEB-136', 'Проверить доступность шаблонов', [['QA', 'green']], 8, ['ЛФ', '#3D8E5F'], '11 нояб.'), card('WEB-138', 'Фото для карточек товаров', [['Контент', 'rose']], 4, ['ИВ', '#C48A1E'], '20 нояб.')],
    progress: [card('WEB-128', 'Перенести каталог', [['Бэкенд', 'teal']], 6, ['МЛ', '#8662C9'], 'Сегодня', true), card('WEB-129', 'Форма заявки на замер', [['Фронтенд', 'blue']], 5, ['АК', '#5A67D8'], '6 нояб.')],
    done: [card('WEB-120', 'Дизайн-токены сайта', [['Дизайн', 'violet']], 3, ['ЕС', '#23918A'], '28 окт.')],
  },
  adding: null,
  drag: null,
  over: null,
  fresh: null,
};

const NEW = card('WEB-142', 'Согласовать макет главной', [['Дизайн', 'violet']], 6, ['АК', '#5A67D8'], '8 нояб.');

const addNew = (s: S): S => ({ ...s, adding: null, fresh: NEW.key, cols: { ...s.cols, todo: [NEW, ...s.cols.todo] } });
const moveDone = (s: S): S => {
  const c = s.cols.progress.find(x => x.key === 'WEB-128')!;
  return { ...s, drag: null, over: null, fresh: c.key, cols: { ...s.cols, progress: s.cols.progress.filter(x => x !== c), done: [{ ...c, late: false }, ...s.cols.done] } };
};

const final: S = { ...moveDone(addNew(initial)), fresh: null };

function KCard({ c, done, dragging, fresh }: { c: Card; done?: boolean; dragging?: boolean; fresh?: boolean }) {
  return (
    <div className={'kcard' + (done ? ' done' : '') + (dragging ? ' dragging' : '') + (fresh ? ' d-fresh' : '')} data-demo={`card-${c.key}`}>
      <div className="labels">
        {c.labels.map(([n, col]) => (
          <Lbl key={n} c={col}>
            {n}
          </Lbl>
        ))}
      </div>
      <div className="top">
        {done && (
          <span className="done-ic">
            <StatusIcon st="done" />
          </span>
        )}
        <div className="title">{c.title}</div>
      </div>
      <div className="meta">
        <span className="key">{c.key}</span>
        <span className="m">
          <Prio n={c.prio} />
        </span>
        {c.due && (
          <span className="m">
            <span className={'due' + (c.late ? ' over' : '')}>
              <Calendar size={12} />
              {c.due}
            </span>
          </span>
        )}
        <span className="m">
          <Av i={c.av[0]} c={c.av[1]} />
        </span>
      </div>
    </div>
  );
}

export const tasksScene: Scene<S> = {
  initial,
  final,
  height: [520, 600],
  script: async ({ set, wait, move, click, type }) => {
    await move('add-todo');
    await click();
    set(s => ({ ...s, adding: '' }));
    await wait(250);
    await type(NEW.title, (s, v) => ({ ...s, adding: v }));
    await wait(450);
    set(addNew);
    await wait(1300);
    await move('card-WEB-128', { ay: 0.35 });
    await wait(150);
    set(s => ({ ...s, drag: 'WEB-128', fresh: null }));
    await wait(200);
    await move('drop-done', { ay: 0.12, dur: 950 });
    set(s => ({ ...s, over: 'done' }));
    await wait(450);
    set(moveDone);
    await wait(200);
  },
  render: (s, { compact, cursor }) => {
    const cols = compact ? COLS.slice(1) : COLS;
    const dragged = s.drag ? s.cols.progress.find(c => c.key === s.drag) : null;
    return (
      <DemoShell compact={compact} active="projects" crumbs={['Проекты', 'Сайт мебельной фабрики']}>
        <div className="d-ph">
          <h1>Сайт мебельной фабрики</h1>
          <span className="badge accent">
            <span className="dot" />
            В работе
          </span>
        </div>
        <div className="tabs d-tabs">
          <span className="tab">Обзор</span>
          <span className="tab on">Доска</span>
          <span className="tab">Список</span>
          <span className="tab">Таймлайн</span>
          {!compact && <span className="tab">Файлы</span>}
        </div>
        <div className="board">
          {cols.map(([id, name]) => {
            const list = s.cols[id];
            const over = s.over === id;
            return (
              <section key={id} className={'bcol' + (over ? ' over' : '')}>
                <div className="bcol-h">
                  <StatusIcon st={id} />
                  <span className="trunc">{name}</span>
                  <span className="cnt">{list.length}</span>
                  <span className="acts">
                    <span className="ibtn ibtn-xs">
                      <Plus size={14} />
                    </span>
                    <span className="ibtn ibtn-xs">
                      <Ellipsis size={14} />
                    </span>
                  </span>
                </div>
                <div className="bcol-b" data-demo={`drop-${id}`}>
                  <span className="addcard" data-demo={`add-${id}`}>
                    <Plus size={14} />
                    Добавить задачу
                  </span>
                  {id === 'todo' && s.adding !== null && (
                    <div className="kcard d-edit">
                      <div className="d-input">
                        {s.adding}
                        <span className="caret" />
                      </div>
                      <div className="d-hint">Enter — создать · Esc — отмена</div>
                    </div>
                  )}
                  {over && <div className="drop-line" />}
                  {list.map(c => (
                    <KCard key={c.key} c={c} done={id === 'done'} dragging={s.drag === c.key} fresh={s.fresh === c.key} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
        {dragged && (
          <div className="ghost" style={{ transform: `translate(${cursor.x - 60}px, ${cursor.y - 22}px) rotate(1.5deg)`, transitionDuration: `${cursor.dur}ms` }}>
            <KCard c={dragged} />
          </div>
        )}
      </DemoShell>
    );
  },
};
