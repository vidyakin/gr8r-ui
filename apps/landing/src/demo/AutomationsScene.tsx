/* Запись «Автоматизации»: в редакторе к триггеру «Изменено поле» добавляется «Создать задачу», узлы связываются,
   в параметрах печатается название с подстановкой, сценарий публикуется, а на вкладке «Запуски» виден успешный запуск.
   Разметка — классы редактора apps/web (.ae-*, .fn, .runs, .step…); холст и связи нарисованы вручную, без @xyflow. */
import * as React from 'react';
import { ArrowLeft, Bell, ChevronDown, CircleCheck, CirclePlus, Clock, Globe, ListPlus, PencilLine, Save, SquarePen, Timer, Trash2, Upload, GitCompareArrows } from 'lucide-react';
import { DemoShell } from './shell';
import type { Scene } from './player';
import type { Locale } from '../i18n';
import { AUTOMATIONS_DICT, type AutoCat as Cat, type AutomationsDict, type PaletteGroup } from './i18n/automations';

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

const initial: S = { tab: 'editor', nodes: 1, sel: 't', edge: 0, hot: null, project: false, title: '', titleFocus: false, published: false, toast: false, run: 0 };
const final = (locale: Locale): S => ({ ...initial, tab: 'runs', nodes: 2, sel: 'a', edge: 2, project: true, title: AUTOMATIONS_DICT[locale].typedTitle, published: true, run: 2 });

const issueCount = (s: S) => (s.nodes === 1 ? 0 : (s.edge === 2 ? 0 : 1) + (s.project ? 0 : 1));

const COLOR: Record<Cat, string> = { trigger: 'var(--violet)', flow: 'var(--teal)', action: 'var(--blue)' };
const PALETTE_ICON: Record<PaletteGroup['items'][number]['icon'], React.ElementType> = {
  create: CirclePlus,
  field: PencilLine,
  cron: Clock,
  if: GitCompareArrows,
  wait: Timer,
  update: SquarePen,
  task: ListPlus,
  notify: Bell,
  http: Globe,
};

const Ico = ({ c, I, size = 13 }: { c: string; I: React.ElementType; size?: number }) => (
  <span className="fn-ico" style={{ '--fn-c': c } as React.CSSProperties}>
    <I size={size} />
  </span>
);

/** Холст вписывается в доступную ширину, как fitView у React Flow */
function Canvas({ s, dict }: { s: S; dict: AutomationsDict }) {
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
            <span className="fn-t trunc">{dict.triggerNodeTitle}</span>
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
              <span className="fn-t trunc">{dict.actionNodeTitle}</span>
            </div>
            <div className="fn-s">
              {s.project && <div className="trunc">projectId: {dict.projectId}</div>}
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

function Panel({ s, compact, dict }: { s: S; compact: boolean; dict: AutomationsDict }) {
  if (s.sel === 't') {
    return (
      <div className="ae-p">
        <div className="ae-ph" style={{ '--fn-c': COLOR.trigger } as React.CSSProperties}>
          <Ico c={COLOR.trigger} I={PencilLine} size={14} />
          <div>
            <h2>{dict.triggerNodeTitle}</h2>
            {!compact && <p className="faint">{dict.triggerDesc}</p>}
          </div>
        </div>
        <div className="pform">
          <Field label={dict.entityLabel}><Sel>{dict.entityVal}</Sel></Field>
          <Field label={dict.fieldLabel}><Sel>{dict.fieldVal}</Sel></Field>
          {!compact && <Field label={dict.fromLabel}><Sel ph={dict.fromPh} /></Field>}
          <Field label={dict.toLabel}><Sel>{dict.toVal}</Sel></Field>
        </div>
        {!compact && <div className="faint ae-nid">{dict.stepIdHint}</div>}
      </div>
    );
  }
  return (
    <div className="ae-p">
      <div className="ae-ph" style={{ '--fn-c': COLOR.action } as React.CSSProperties}>
        <Ico c={COLOR.action} I={ListPlus} size={14} />
        <div>
          <h2>{dict.actionNodeTitle}</h2>
          {!compact && <p className="faint">{dict.actionDesc}</p>}
        </div>
      </div>
      <div className="pform">
        <Field label={dict.projectLabel}>
          <Sel ph={dict.projectPh} demo="f-project">
            {s.project ? <span className="d-flash">{dict.projectName}</span> : undefined}
          </Sel>
          {!s.project && s.nodes === 2 && <span className="err">{dict.requiredErr}</span>}
        </Field>
        <Field label={dict.titleLabel}>
          <span className={'input d-input' + (s.titleFocus ? ' d-focus' : '')} data-demo="f-title" style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', whiteSpace: 'nowrap' }}>
            <span className="trunc">{s.title}</span>
            {s.titleFocus && <i className="caret" />}
          </span>
          {!compact && <span className="hint">{dict.titleHint}</span>}
        </Field>
        <Field label={dict.assigneeLabel}><Sel ph={dict.assigneePh} /></Field>
        {!compact && <Field label={dict.statusLabel}><span className="input d-sel">todo</span></Field>}
      </div>
      {!compact && (
        <span className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}>
          <Trash2 size={13} />
          {dict.deleteStep}
        </span>
      )}
    </div>
  );
}

function Editor({ s, compact, dict }: { s: S; compact: boolean; dict: AutomationsDict }) {
  return (
    <div className="ae-body">
      <aside className="ae-palette">
        {dict.palette.map(g => (
          <section key={g.cat}>
            {!compact && <h3>{g.name}</h3>}
            {g.items
              .filter(item => !compact || g.cat !== 'trigger' || item.id === 'field')
              .map(item => {
                const I = PALETTE_ICON[item.icon];
                return (
                  <span key={item.id} className={'pal-item' + (item.demo && s.hot === 'pal' ? ' hot' : '')} data-demo={item.demo} style={{ '--fn-c': COLOR[g.cat] } as React.CSSProperties}>
                    <Ico c={COLOR[g.cat]} I={I} />
                    <span className="trunc">{item.label}</span>
                  </span>
                );
              })}
          </section>
        ))}
        {!compact && <p className="faint pal-help">{dict.paletteHelp}</p>}
      </aside>
      <Canvas s={s} dict={dict} />
      <aside className="ae-panel">
        <Panel s={s} compact={compact} dict={dict} />
      </aside>
    </div>
  );
}

const step2In = (dict: AutomationsDict) => `{
  "projectId": "${dict.projectId}",
  "title": "${dict.step2TitleSample}",
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

function Runs({ s, dict }: { s: S; dict: AutomationsDict }) {
  const done = s.run === 2;
  const badge = (ok: boolean) => (ok ? <span className="badge green"><span className="dot" />{dict.badgeOk}</span> : <span className="badge accent"><span className="dot" />{dict.badgeRunning}</span>);
  return (
    <div className="runs d-page-in">
      <div className="runs-list">
        <div className="runs-bar">
          <span className="d-seg">
            <span data-state="on">{dict.allRuns}</span>
            <span>{dict.errorsOnly}</span>
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
                <span className="faint">{dict.justNow}</span>
              </div>
              <div className="run-r2 faint">{dict.runSub(done)}</div>
            </div>
          </li>
        </ul>
      </div>
      <div className="runs-detail">
        <div className="run-detail">
          <div className="run-dh">
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <h2 className="sec">{dict.scenarioTitle}</h2>
              {badge(done)}
            </div>
            <div className="faint run-meta">{dict.runMeta(done)}</div>
          </div>
          <ol className="steps">
            <li className="step" data-demo="step-1">
              <div className="step-h">
                <span className="step-n">1</span>
                <span className="step-ico"><PencilLine size={13} /></span>
                <span className="step-t trunc">{dict.triggerNodeTitle}</span>
                <span className="faint mono trunc step-id">trigger</span>
                <span className="sp" />
                <span className="faint">{dict.ms12}</span>
                {badge(true)}
              </div>
            </li>
            <li className={'step d-pop' + (done ? '' : ' run')} data-demo="step-2">
              <div className="step-h">
                <span className="step-n">2</span>
                <span className="step-ico"><ListPlus size={13} /></span>
                <span className="step-t trunc">{dict.actionNodeTitle}</span>
                <span className="faint mono trunc step-id">action-1</span>
                <span className="sp" />
                <span className="faint">{done ? dict.s03 : '—'}</span>
                {badge(done)}
              </div>
              {done && (
                <div className="step-body">
                  <div>
                    <div className="label">{dict.inputLabel}</div>
                    <pre className="code">{step2In(dict)}</pre>
                  </div>
                  <div>
                    <div className="label">{dict.outputLabel}</div>
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

function Page({ s, compact, dict }: { s: S; compact: boolean; dict: AutomationsDict }) {
  const n = issueCount(s);
  return (
    <div className="d-ae">
      <div className="ae-bar">
        <span className="btn btn-ghost btn-sm">
          <ArrowLeft size={14} />
        </span>
        <span className="input ae-name">{dict.scenarioTitle}</span>
        {s.published ? (
          <span className="badge green"><span className="dot" />{dict.activeBadge}</span>
        ) : (
          <span className="badge gray">{dict.draftBadge}</span>
        )}
        <span className="sp" />
        <span className={'ae-valid ' + (n ? 'bad' : 'ok')}>
          <CircleCheck size={13} /> <span>{n ? dict.issuesCount(n) : dict.graphValid}</span>
        </span>
        <label className="row ae-sw">
          <input type="checkbox" role="switch" className="toggle" checked={s.published} readOnly />
          <span>{dict.enabled}</span>
        </label>
        <span className="btn btn-secondary btn-sm d-off">
          <Save size={13} />
          {compact ? '' : dict.saveDraft}
        </span>
        <span className={'btn btn-primary btn-sm' + (n || s.published ? ' d-off' : '')} data-demo="btn-publish">
          <Upload size={13} />
          {dict.publish}
        </span>
      </div>
      <div className="auto-tabs">
        <div className="tabs">
          <span className={'tab' + (s.tab === 'editor' ? ' on' : '')}>{dict.tabs[0]}</span>
          <span className={'tab' + (s.tab === 'runs' ? ' on' : '')} data-demo="tab-runs">{dict.tabs[1]}</span>
        </div>
      </div>
      {s.tab === 'editor' ? <Editor s={s} compact={compact} dict={dict} /> : <Runs s={s} dict={dict} />}
      {s.toast && (
        <div className="toast d-toast">
          <CircleCheck size={16} />
          {dict.toastPublished}
        </div>
      )}
    </div>
  );
}

export const automationsScene: Scene<S> = {
  initial,
  final,
  height: [600, 660],
  script: async ({ set, wait, move, click, type }, locale) => {
    const dict = AUTOMATIONS_DICT[locale];
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
    await type(dict.typedTitle, (s, v) => ({ ...s, title: v }), 45);
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
  render: (s, { compact, locale }) => {
    const dict = AUTOMATIONS_DICT[locale];
    return (
      <DemoShell compact={compact} active="automations" crumbs={dict.crumbs} locale={locale}>
        <Page s={s} compact={compact} dict={dict} />
      </DemoShell>
    );
  },
};
