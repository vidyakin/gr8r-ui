/* Запись «Задачи и проекты»: доска проекта — создание задачи в колонке и перенос карточки в «Готово». Разметка — как у board-view.tsx */
import { Calendar, Ellipsis, Plus } from 'lucide-react';
import type { Locale } from '../i18n';
import { Av, DemoShell, Lbl, Prio, StatusIcon } from './shell';
import { TASKS_DICT, type TaskCardData, type TaskCol } from './i18n/tasks';
import type { Scene } from './player';

interface S {
  cols: Record<TaskCol, TaskCardData[]>;
  /** Текст новой задачи, пока её набирают; null — формы нет */
  adding: string | null;
  drag: string | null;
  over: TaskCol | null;
  fresh: string | null;
}

const makeInitial = (locale: Locale): S => ({
  cols: TASKS_DICT[locale].initial,
  adding: null,
  drag: null,
  over: null,
  fresh: null,
});

const addNew = (s: S, locale: Locale): S => {
  const card = TASKS_DICT[locale].newCard;
  return { ...s, adding: null, fresh: card.key, cols: { ...s.cols, todo: [card, ...s.cols.todo] } };
};

const moveDone = (s: S): S => {
  const c = s.cols.progress.find(x => x.key === 'WEB-128')!;
  return { ...s, drag: null, over: null, fresh: c.key, cols: { ...s.cols, progress: s.cols.progress.filter(x => x !== c), done: [{ ...c, late: false }, ...s.cols.done] } };
};

function KCard({ c, done, dragging, fresh }: { c: TaskCardData; done?: boolean; dragging?: boolean; fresh?: boolean }) {
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
  initial: makeInitial,
  final: locale => ({ ...moveDone(addNew(makeInitial(locale), locale)), fresh: null }),
  height: [520, 600],
  script: async ({ set, wait, move, click, type }, locale) => {
    await move('add-todo');
    await click();
    set(s => ({ ...s, adding: '' }));
    await wait(250);
    await type(TASKS_DICT[locale].newCard.title, (s, v) => ({ ...s, adding: v }));
    await wait(450);
    set(s => addNew(s, locale));
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
  render: (s, { compact, cursor, locale }) => {
    const d = TASKS_DICT[locale];
    const cols = compact ? d.cols.slice(1) : d.cols;
    const dragged = s.drag ? s.cols.progress.find(c => c.key === s.drag) : null;
    return (
      <DemoShell compact={compact} active="projects" crumbs={d.crumbs} locale={locale}>
        <div className="d-ph">
          <div className="d-ph-title">{d.projectTitle}</div>
          <span className="badge accent">
            <span className="dot" />
            {d.statusInProgress}
          </span>
        </div>
        <div className="tabs d-tabs">
          <span className="tab">{d.tabs[0]}</span>
          <span className="tab on">{d.tabs[1]}</span>
          <span className="tab">{d.tabs[2]}</span>
          <span className="tab">{d.tabs[3]}</span>
          {!compact && <span className="tab">{d.tabs[4]}</span>}
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
                    {d.addTask}
                  </span>
                  {id === 'todo' && s.adding !== null && (
                    <div className="kcard d-edit">
                      <div className="d-input">
                        {s.adding}
                        <span className="caret" />
                      </div>
                      <div className="d-hint">{d.inputHint}</div>
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
