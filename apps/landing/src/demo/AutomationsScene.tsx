/* Запись «Автоматизации»: в редакторе к триггеру «Изменено поле» добавляется «Создать задачу», узлы связываются,
   в параметрах печатается название с подстановкой, сценарий публикуется, а на вкладке «Запуски» виден успешный запуск.
   Разметка — классы редактора apps/web (.ae-*, .fn, .runs, .step…); холст и связи нарисованы вручную, без @xyflow. */
import * as React from 'react';
import { ArrowLeft, Bell, ChevronDown, CircleCheck, CirclePlus, Clock, Globe, ListPlus, PencilLine, Save, SquarePen, Timer, Trash2, Upload, GitCompareArrows } from 'lucide-react';
import { DemoShell } from './shell';
import type { Scene } from './player';

interface S {
  tab: 'editor' | 'runs';
  nodes: 1 | 2;
  sel: 't' | 'a';
  /** 0 — связи нет, 1 — линия рисуется, 2 — связь готова */
  edge: 0 | 1 | 2;
  hot: string | null;
  project: boolean;
  title: string;
  titleFocus: boolean;
  published: boolean;
  toast: boolean;
  /** 0 — запусков нет, 1 — идёт, 2 — успешно завершён */
  run: 0 | 1 | 2;
}

const TITLE = 'Передать в работу: {{trigger.record.name}}';
const PROJECT = 'Заказы клиентов';
const PROJECT_ID = '0192f4a8-71c3-7e5b-9d20-3a1c5e8b';

const initial: S = { tab: 'editor', nodes: 1, sel: 't', edge: 0, hot: null, project: false, title: '', titleFocus: false, published: false, toast: false, run: 0 };
const final: S = { ...initial, tab: 'runs', nodes: 2, sel: 'a', edge: 2, project: true, title: TITLE, published: true, run: 2 };

const issueCount = (s: S) => (s.nodes === 1 ? 0 : (s.edge === 2 ? 0 : 1) + (s.project ? 0 : 1));

type Cat = 'trigger' | 'flow' | 'action';
const COLOR: Record<Cat, string> = { trigger: 'var(--violet)', flow: 'var(--teal)', action: 'var(--blue)' };
const PALETTE: { cat: Cat; name: string; items: [string, React.ElementType, string?][] }[] = [
  { cat: 'trigger', name: 'Триггер', items: [['Создана запись', CirclePlus], ['Изменено поле', PencilLine], ['По расписанию', Clock]] },
  { cat: 'flow', name: 'Логика', items: [['Условие', GitCompareArrows], ['Пауза', Timer]] },
  { cat: 'action', name: 'Действие', items: [['Изменить поле', SquarePen], ['Создать задачу', ListPlus, 'pal-task'], ['Уведомить участника', Bell], ['HTTP-запрос', Globe]] },
];

const Ico = ({ c, I, size = 13 }: { c: string; I: React.ElementType; size?: number }) => (
  <span className="fn-ico" style={{ '--fn-c': c } as React.CSSProperties}>
    <I size={size} />
  </span>
);

/** Холст вписывается в доступную ширину, как fitView у React Flow */
function Canvas({ s }: { s: S }) {
  const box = React.useRef<HTMLDivElement>(null);
  const [k, setK] = React.useState(1);
  React.useLayoutEffect(() => {
    const el = box.current!;
    const upd = () => setK(Math.min(1, (el.clientWidth - 16) / 530));
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const bad = s.nodes === 2 && issueCount(s) > 0;
  return (
    <div className="d-canvas ae-canvas" ref={box}>
      <div className="d-canvas-in" style={{ transform: `translate(8px, 10px) scale(${k})` }}>
        <svg className="d-edges" aria-hidden>
          <defs>
            <marker id="d-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
              <path d="M1 1 9 5 1 9z" fill="var(--text-4)" />
            </marker>
          </defs>
          {s.edge > 0 && <path className={'d-edge' + (s.edge === 1 ? ' draw' : '')} pathLength={1} d="M212 91C256 91 256 161 300 161" markerEnd={s.edge === 2 ? 'url(#d-arrow)' : undefined} />}
        </svg>
        <div className={'fn' + (s.sel === 't' ? ' sel' : '')} style={{ left: 0, top: 50, '--fn-c': COLOR.trigger } as React.CSSProperties} data-demo="node-t">
          <div className="fn-h">
            <Ico c={COLOR.trigger} I={PencilLine} />
            <span className="fn-t trunc">Изменено поле</span>
          </div>
          <div className="fn-s">
            <div className="trunc">entity: deal</div>
            <div className="trunc">field: stageId</div>
          </div>
          <span className={'d-handle out' + (s.hot === 'out' ? ' hot' : '')} data-demo="h-out" />
        </div>
        {s.nodes === 2 && (
          <div className={'fn d-pop' + (s.sel === 'a' ? ' sel' : '') + (bad ? ' bad' : '')} style={{ left: 300, top: 120, '--fn-c': COLOR.action } as React.CSSProperties} data-demo="node-a">
            <div className="fn-h">
              <Ico c={COLOR.action} I={ListPlus} />
              <span className="fn-t trunc">Создать задачу</span>
            </div>
            <div className="fn-s">
              {s.project && <div className="trunc">projectId: {PROJECT_ID}</div>}
              {s.title && <div className="trunc">title: {s.title}</div>}
            </div>
            <span className={'d-handle in' + (s.hot === 'in' ? ' hot' : '')} data-demo="h-in" />
            <span className="d-handle out" />
          </div>
        )}
      </div>
    </div>
  );
}

const Sel = ({ children, ph, demo, hot }: { children?: React.ReactNode; ph?: string; demo?: string; hot?: boolean }) => (
  <span className={'input d-sel' + (hot ? ' d-focus' : '')} data-demo={demo}>
    {children ?? <span className="d-ph-text">{ph}</span>}
    <ChevronDown size={14} className="chev" />
  </span>
);
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="field">
    <span className="label">{label}</span>
    {children}
  </div>
);

function Panel({ s, compact }: { s: S; compact: boolean }) {
  if (s.sel === 't') {
    return (
      <div className="ae-p">
        <div className="ae-ph" style={{ '--fn-c': COLOR.trigger } as React.CSSProperties}>
          <Ico c={COLOR.trigger} I={PencilLine} size={14} />
          <div>
            <h2>Изменено поле</h2>
            {!compact && <p className="faint">Запускается, когда меняется поле записи — при желании только на определённое значение.</p>}
          </div>
        </div>
        <div className="pform">
          <Field label="Сущность"><Sel>Сделка</Sel></Field>
          <Field label="Поле"><Sel>Этап</Sel></Field>
          {!compact && <Field label="Было (необязательно)"><Sel ph="Любой этап" /></Field>}
          <Field label="Стало (необязательно)"><Sel>Выиграна</Sel></Field>
        </div>
        {!compact && <div className="faint ae-nid">Идентификатор шага: trigger — используйте {'{{steps.trigger.…}}'} в следующих шагах.</div>}
      </div>
    );
  }
  return (
    <div className="ae-p">
      <div className="ae-ph" style={{ '--fn-c': COLOR.action } as React.CSSProperties}>
        <Ico c={COLOR.action} I={ListPlus} size={14} />
        <div>
          <h2>Создать задачу</h2>
          {!compact && <p className="faint">Создаёт задачу в проекте.</p>}
        </div>
      </div>
      <div className="pform">
        <Field label="Проект">
          <Sel ph="Выберите проект" demo="f-project">
            {s.project ? <span className="d-flash">{PROJECT}</span> : undefined}
          </Sel>
          {!s.project && s.nodes === 2 && <span className="err">Обязательно</span>}
        </Field>
        <Field label="Название">
          <span className={'input d-input' + (s.titleFocus ? ' d-focus' : '')} data-demo="f-title" style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', whiteSpace: 'nowrap' }}>
            <span className="trunc">{s.title}</span>
            {s.titleFocus && <i className="caret" />}
          </span>
          {!compact && <span className="hint">Подстановки {'{{…}}'}: значения триггера и прошлых шагов</span>}
        </Field>
        <Field label="Исполнитель (необязательно)"><Sel ph="Участник" /></Field>
        {!compact && <Field label="Статус"><span className="input d-sel">todo</span></Field>}
      </div>
      {!compact && (
        <span className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}>
          <Trash2 size={13} />
          Удалить шаг
        </span>
      )}
    </div>
  );
}

function Editor({ s, compact }: { s: S; compact: boolean }) {
  return (
    <div className="ae-body">
      <aside className="ae-palette">
        {PALETTE.map(g => (
          <section key={g.cat}>
            {!compact && <h3>{g.name}</h3>}
            {g.items
              .filter(([name]) => !compact || g.cat !== 'trigger' || name === 'Изменено поле')
              .map(([name, I, demo]) => (
                <span key={name} className={'pal-item' + (demo && s.hot === 'pal' ? ' hot' : '')} data-demo={demo} style={{ '--fn-c': COLOR[g.cat] } as React.CSSProperties}>
                  <Ico c={COLOR[g.cat]} I={I} />
                  <span className="trunc">{name}</span>
                </span>
              ))}
          </section>
        ))}
        {!compact && <p className="faint pal-help">Нажмите, чтобы добавить шаг после выбранного, или перетащите его на холст.</p>}
      </aside>
      <Canvas s={s} />
      <aside className="ae-panel">
        <Panel s={s} compact={compact} />
      </aside>
    </div>
  );
}

const STEP2_IN = `{
  "projectId": "${PROJECT_ID}",
  "title": "Передать в работу: Кухня, ЖК Северный",
  "description": "",
  "assigneeId": "",
  "priority": "",
  "status": "todo",
  "dueDate": ""
}`;
const STEP2_OUT = `{
  "taskId": "0192f4b1-0c6e-7a3d-8e12-94d0f7c2a1b5",
  "key": "ORD-48"
}`;

function Runs({ s }: { s: S }) {
  const done = s.run === 2;
  const badge = (ok: boolean) => (ok ? <span className="badge green"><span className="dot" />Успешно</span> : <span className="badge accent"><span className="dot" />Выполняется</span>);
  return (
    <div className="runs d-page-in">
      <div className="runs-list">
        <div className="runs-bar">
          <span className="d-seg">
            <span data-state="on">Все запуски</span>
            <span>Ошибки</span>
          </span>
          <span className="sp" />
          <span className="faint">1</span>
        </div>
        <ul className="runs-rows">
          <li>
            <div className="run-row on">
              <div className="run-r1">
                {badge(done)}
                <span className="sp" />
                <span className="faint">только что</span>
              </div>
              <div className="run-r2 faint">Событие · v1 · {done ? '0.4 с' : '—'} · 2 шага</div>
            </div>
          </li>
        </ul>
      </div>
      <div className="runs-detail">
        <div className="run-detail">
          <div className="run-dh">
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <h2 className="sec">Сделка выиграна → задача в работу</h2>
              {badge(done)}
            </div>
            <div className="faint run-meta">Триггер: Событие · версия 1 · начало 29.10.2026, 14:32 · длительность {done ? '0.4 с' : '—'}</div>
          </div>
          <ol className="steps">
            <li className="step" data-demo="step-1">
              <div className="step-h">
                <span className="step-n">1</span>
                <span className="step-ico"><PencilLine size={13} /></span>
                <span className="step-t trunc">Изменено поле</span>
                <span className="faint mono trunc step-id">trigger</span>
                <span className="sp" />
                <span className="faint">12 мс</span>
                {badge(true)}
              </div>
            </li>
            <li className={'step d-pop' + (done ? '' : ' run')} data-demo="step-2">
              <div className="step-h">
                <span className="step-n">2</span>
                <span className="step-ico"><ListPlus size={13} /></span>
                <span className="step-t trunc">Создать задачу</span>
                <span className="faint mono trunc step-id">action-1</span>
                <span className="sp" />
                <span className="faint">{done ? '0.3 с' : '—'}</span>
                {badge(done)}
              </div>
              {done && (
                <div className="step-body">
                  <div>
                    <div className="label">Вход</div>
                    <pre className="code">{STEP2_IN}</pre>
                  </div>
                  <div>
                    <div className="label">Выход</div>
                    <pre className="code">{STEP2_OUT}</pre>
                  </div>
                </div>
              )}
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}

function Page({ s, compact }: { s: S; compact: boolean }) {
  const n = issueCount(s);
  return (
    <div className="d-ae">
      <div className="ae-bar">
        <span className="btn btn-ghost btn-sm">
          <ArrowLeft size={14} />
        </span>
        <span className="input ae-name">Сделка выиграна → задача в работу</span>
        {s.published ? (
          <span className="badge green"><span className="dot" />Действует · v1</span>
        ) : (
          <span className="badge gray">Черновик</span>
        )}
        <span className="sp" />
        <span className={'ae-valid ' + (n ? 'bad' : 'ok')}>
          <CircleCheck size={13} /> <span>{n ? `Замечаний: ${n}` : 'Граф корректен'}</span>
        </span>
        <label className="row ae-sw">
          <input type="checkbox" role="switch" className="toggle" checked={s.published} readOnly />
          <span>Включено</span>
        </label>
        <span className="btn btn-secondary btn-sm d-off">
          <Save size={13} />
          {compact ? '' : 'Сохранить черновик'}
        </span>
        <span className={'btn btn-primary btn-sm' + (n || s.published ? ' d-off' : '')} data-demo="btn-publish">
          <Upload size={13} />
          Опубликовать
        </span>
      </div>
      <div className="auto-tabs">
        <div className="tabs">
          <span className={'tab' + (s.tab === 'editor' ? ' on' : '')}>Редактор</span>
          <span className={'tab' + (s.tab === 'runs' ? ' on' : '')} data-demo="tab-runs">Запуски</span>
        </div>
      </div>
      {s.tab === 'editor' ? <Editor s={s} compact={compact} /> : <Runs s={s} />}
      {s.toast && (
        <div className="toast d-toast">
          <CircleCheck size={16} />
          Опубликована версия 1 — автоматизация включена
        </div>
      )}
    </div>
  );
}

export const automationsScene: Scene<S> = {
  initial,
  final,
  height: [600, 660],
  script: async ({ set, wait, move, click, type }) => {
    await wait(700);
    // Шаг из палитры
    await move('pal-task');
    set(s => ({ ...s, hot: 'pal' }));
    await click();
    set(s => ({ ...s, hot: null, nodes: 2, sel: 'a' }));
    await wait(900);
    // Связь: тянем от выхода триггера ко входу нового узла
    await move('h-out');
    set(s => ({ ...s, hot: 'out' }));
    await wait(250);
    set(s => ({ ...s, edge: 1 }));
    await move('h-in', { dur: 800 });
    set(s => ({ ...s, hot: 'in' }));
    await wait(150);
    set(s => ({ ...s, edge: 2, hot: null }));
    await wait(700);
    // Параметры шага: проект и название с подстановкой
    await move('f-project');
    await click();
    set(s => ({ ...s, project: true }));
    await wait(700);
    await move('f-title');
    await click();
    set(s => ({ ...s, title: '', titleFocus: true }));
    await type(TITLE, (s, v) => ({ ...s, title: v }), 45);
    set(s => ({ ...s, titleFocus: false }));
    await wait(700);
    // Публикация
    await move('btn-publish');
    await click();
    set(s => ({ ...s, published: true, toast: true }));
    await wait(1500);
    set(s => ({ ...s, toast: false }));
    // Журнал запусков
    await move('tab-runs');
    await click();
    set(s => ({ ...s, tab: 'runs', run: 1 }));
    await wait(1100);
    set(s => ({ ...s, run: 2 }));
    await wait(600);
    await move('step-2', { ax: 0.5, ay: 0.2 });
    await wait(500);
  },
  render: (s, { compact }) => (
    <DemoShell compact={compact} active="automations" crumbs={['Платформа', 'Автоматизации']}>
      <Page s={s} compact={compact} />
    </DemoShell>
  ),
};
