/* Запись «Производство»: рабочее место «Выпуск продукции» — мастер отмечает этапы заказа и выпускает,
   выпущенное и остаток пересчитываются. Разметка — как у ProductionWorkbenchPage.tsx */
import { PanelRightClose, Play, RefreshCw, CircleCheck } from 'lucide-react';
import type { Locale } from '../i18n';
import { DemoShell } from './shell';
import type { Scene } from './player';
import { PRODUCTION_DICT, type ProdOrder as Order, type StageId } from './i18n/production';

interface S {
  orders: Order[];
  /** Отмеченные этапы: «строка:этап» */
  checked: string[];
  toast: boolean;
  fresh: string | null;
}

const STAGE_IDS: StageId[] = ['cut', 'build', 'paint'];

const initial = (locale: Locale): S => ({
  orders: PRODUCTION_DICT[locale].initialOrders,
  checked: [],
  toast: false,
  fresh: null,
});

const keysOf = (o: Order) => o.rows.flatMap(r => STAGE_IDS.map(st => `${r.id}:${st}`));
const release = (doneState: string) => (s: S): S => ({
  ...s,
  checked: [],
  toast: true,
  fresh: 'o1',
  orders: s.orders.map(o => (o.id === 'o1' ? { ...o, state: [doneState, 'green'], rows: o.rows.map(r => ({ ...r, done: r.qty })) } : o)),
});
const final = (locale: Locale): S => ({
  ...release(PRODUCTION_DICT[locale].doneState)(initial(locale)),
  toast: false,
  fresh: null,
});

export const productionScene: Scene<S> = {
  initial,
  final,
  height: [400, 380],
  script: async ({ set, wait, move, click }, locale) => {
    const d = PRODUCTION_DICT[locale];
    // Сначала по одной галочке — этапы стола, потом «Отметить все» по заказу
    for (const st of STAGE_IDS) {
      await move(`chk-r1:${st}`);
      await click();
      set(s => ({ ...s, checked: [...s.checked, `r1:${st}`] }));
      await wait(180);
    }
    await wait(300);
    await move('all-o1');
    await click();
    set(s => ({ ...s, checked: keysOf(s.orders[0]!) }));
    await wait(700);
    await move('btn-release');
    await click();
    set(release(d.doneState));
    await wait(2200);
    set(s => ({ ...s, toast: false }));
  },
  render: (s, { compact, locale }) => {
    const d = PRODUCTION_DICT[locale];
    const marked = s.checked.length;
    return (
      <DemoShell compact={compact} active="release" crumbs={d.crumbs} locale={locale}>
        <div className="d-ph">
          <div>
            <h1>{d.title}</h1>
            {!compact && <p>{d.subtitle}</p>}
          </div>
          <span className="sp" />
          {!compact && (
            <span className="seg d-seg">
              <span data-state="on">{d.seg[0]}</span>
              <span>{d.seg[1]}</span>
            </span>
          )}
          <span className="btn btn-secondary">
            <RefreshCw size={14} />
          </span>
          {!compact && (
            <span className="ibtn">
              <PanelRightClose size={14} />
            </span>
          )}
          <span className={'btn btn-primary' + (marked ? '' : ' d-off')} data-demo="btn-release">
            <Play size={14} />
            {marked ? d.releaseBtnCount(marked) : d.releaseBtn}
          </span>
        </div>
        <section className="panel d-wb">
          <table className="dtbl">
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <span className="faint">#</span>
                </th>
                <th>{d.cols.product}</th>
                <th className="r" style={{ width: 78 }}>
                  {d.cols.ordered}
                </th>
                <th className="r" style={{ width: 78 }}>
                  {d.cols.released}
                </th>
                {!compact && (
                  <th className="r" style={{ width: 72 }}>
                    {d.cols.remaining}
                  </th>
                )}
                {d.stages.map(([id, n]) => (
                  <th key={id} style={{ width: compact ? 74 : 96 }}>
                    {n}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.orders.map(o => {
                const all = keysOf(o).every(k => s.checked.includes(k));
                return [
                  <tr key={o.id}>
                    <td colSpan={compact ? 7 : 8} className="d-wb-group">
                      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                        <strong style={{ fontWeight: 550 }}>{o.num}</strong>
                        {!compact && <span className="faint">{o.type}</span>}
                        <span className={`badge ${o.state[1]}` + (s.fresh === o.id ? ' d-flash' : '')} key={o.state[0]}>
                          {o.state[0]}
                        </span>
                        {o.who && <span className="muted trunc">{o.who}</span>}
                        {!compact && (
                          <span className="faint">
                            · {o.center} · {o.due}
                          </span>
                        )}
                        {o.rows.some(r => r.done < r.qty) && (
                          <span className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} data-demo={`all-${o.id}`}>
                            {all ? d.uncheckAll : d.checkAll}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>,
                  ...o.rows.map(r => {
                    const left = r.qty - r.done;
                    const rowChecked = STAGE_IDS.every(st => s.checked.includes(`${r.id}:${st}`));
                    return (
                      <tr key={r.id} className={s.fresh === o.id ? 'd-row-hot' : undefined}>
                        <td>{left > 0 ? <input type="checkbox" className="check" checked={rowChecked} readOnly tabIndex={-1} /> : <CircleCheck size={15} className="d-ok" />}</td>
                        <td>
                          <span className="trunc">{r.name}</span>
                          {r.kind && !compact && (
                            <span className="faint" style={{ marginLeft: 6 }}>
                              {r.kind}
                            </span>
                          )}
                        </td>
                        <td className="r num">{r.qty}</td>
                        <td className="r num muted">{r.done}</td>
                        {!compact && <td className="r num">{left}</td>}
                        {STAGE_IDS.map(st => (
                          <td key={st}>
                            {left > 0 ? (
                              <div className="row" style={{ gap: 6 }}>
                                <input type="checkbox" className="check" checked={s.checked.includes(`${r.id}:${st}`)} readOnly tabIndex={-1} data-demo={`chk-${r.id}:${st}`} />
                                <span className="num faint">{left}</span>
                              </div>
                            ) : (
                              <span className="faint">—</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  }),
                ];
              })}
            </tbody>
          </table>
        </section>
        {s.toast && (
          <div className="toast d-toast">
            <CircleCheck size={15} />
            <span>{d.toast}</span>
          </div>
        )}
      </DemoShell>
    );
  },
};
