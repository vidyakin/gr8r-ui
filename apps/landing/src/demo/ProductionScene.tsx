/* Запись «Производство»: рабочее место «Выпуск продукции» — мастер отмечает этапы заказа и выпускает,
   выпущенное и остаток пересчитываются. Разметка — как у ProductionWorkbenchPage.tsx */
import { PanelRightClose, Play, RefreshCw, CircleCheck } from 'lucide-react';
import { DemoShell } from './shell';
import type { Scene } from './player';

type StageId = 'cut' | 'build' | 'paint';
interface Row {
  id: string;
  name: string;
  kind?: string;
  qty: number;
  done: number;
}
interface Order {
  id: string;
  num: string;
  type: string;
  state: [string, string];
  who?: string;
  center: string;
  due: string;
  rows: Row[];
}
interface S {
  orders: Order[];
  /** Отмеченные этапы: «строка:этап» */
  checked: string[];
  toast: boolean;
  fresh: string | null;
}

const STAGES: [StageId, string][] = [
  ['cut', 'Раскрой'],
  ['build', 'Сборка'],
  ['paint', 'Покраска'],
];

const initial: S = {
  orders: [
    {
      id: 'o1',
      num: 'ЗК-000118',
      type: 'Заказ покупателя',
      state: ['В работе', 'accent'],
      who: 'ООО «Атлас Мебель»',
      center: 'Цех №1',
      due: '06.11.2026',
      rows: [
        { id: 'r1', name: 'Стол обеденный «Дуб» 160×90', qty: 2, done: 0 },
        { id: 'r2', name: 'Стул «Классик»', kind: 'дуб, лак', qty: 8, done: 0 },
      ],
    },
    {
      id: 'o2',
      num: 'ПР-000052',
      type: 'Заказ на производство',
      state: ['Запланирован', 'amber'],
      center: 'Цех №2',
      due: '12.11.2026',
      rows: [{ id: 'r3', name: 'Шкаф-купе «Лофт» 2400', qty: 3, done: 1 }],
    },
  ],
  checked: [],
  toast: false,
  fresh: null,
};

const keysOf = (o: Order) => o.rows.flatMap(r => STAGES.map(([st]) => `${r.id}:${st}`));
const release = (s: S): S => ({
  ...s,
  checked: [],
  toast: true,
  fresh: 'o1',
  orders: s.orders.map(o => (o.id === 'o1' ? { ...o, state: ['Выполнен', 'green'], rows: o.rows.map(r => ({ ...r, done: r.qty })) } : o)),
});
const final: S = { ...release(initial), toast: false, fresh: null };

export const productionScene: Scene<S> = {
  initial,
  final,
  height: [400, 380],
  script: async ({ set, wait, move, click }) => {
    // Сначала по одной галочке — этапы стола, потом «Отметить все» по заказу
    for (const st of ['cut', 'build', 'paint']) {
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
    set(release);
    await wait(2200);
    set(s => ({ ...s, toast: false }));
  },
  render: (s, { compact }) => {
    const marked = s.checked.length;
    return (
      <DemoShell compact={compact} active="release" crumbs={['Производство', 'Выпуск продукции']}>
        <div className="d-ph">
          <div>
            <h1>Выпуск продукции</h1>
            {!compact && <p>Заказы, ожидающие выпуска. Отметьте строки и этапы, выберите участок.</p>}
          </div>
          <span className="sp" />
          {!compact && (
            <span className="seg d-seg">
              <span data-state="on">Целиком</span>
              <span>По количеству</span>
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
            {marked ? `Выпустить (${marked})` : 'Выпустить'}
          </span>
        </div>
        <section className="panel d-wb">
          <table className="dtbl">
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <span className="faint">#</span>
                </th>
                <th>Продукция</th>
                <th className="r" style={{ width: 78 }}>
                  Заказано
                </th>
                <th className="r" style={{ width: 78 }}>
                  Выпущено
                </th>
                {!compact && (
                  <th className="r" style={{ width: 72 }}>
                    Остаток
                  </th>
                )}
                {STAGES.map(([id, n]) => (
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
                            {all ? 'Снять все' : 'Отметить все'}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>,
                  ...o.rows.map(r => {
                    const left = r.qty - r.done;
                    const rowChecked = STAGES.every(([st]) => s.checked.includes(`${r.id}:${st}`));
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
                        {STAGES.map(([st]) => (
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
            <span>Создан выпуск продукции ВП-000087 · Цех №1</span>
          </div>
        )}
      </DemoShell>
    );
  },
};
