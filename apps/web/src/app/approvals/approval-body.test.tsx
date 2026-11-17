/* Рендер вкладки «Согласование» с данными (задача 1199): состояние, этапы, задачи, кнопки по правам, просрочка, предупреждение. */
import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import * as i18n from '@/i18n';
import type { ApprovalBodyProps } from './approval-body';
import type { ApprovalOfObject, ApprovalTaskView, ApprovalView } from './data';

// useT подписывается на язык через useSyncExternalStore без серверного снимка — для статического рендера подменяем хук на саму t()
mock.module('@/i18n', () => ({ ...i18n, useT: () => i18n.t }));
const { setLocale } = i18n;
// словари — отдельные чанки: setLocale переключает синхронно, только когда словарь уже загружен
await Promise.all([i18n.loadLocale('en'), i18n.loadLocale('ru')]);
const { ApprovalBody } = await import('./approval-body');

const task = (over: Partial<ApprovalTaskView>): ApprovalTaskView => ({
  id: 't1',
  stepIndex: 0,
  seq: 0,
  groupKey: '0:0',
  memberId: 'm-boss',
  memberName: 'Руководитель Иванов',
  positionName: null,
  state: 'pending',
  decision: null,
  comment: '',
  notes: [],
  decidedAt: null,
  dueAt: '2026-11-16T10:00:00Z',
  overdueHours: 0,
  ...over,
});

const process = (over: Partial<ApprovalView> = {}): ApprovalView => ({
  id: 'ap1',
  targetKind: 'document',
  documentId: 'd1',
  contractId: null,
  objectLabel: 'Заказ поставщику 7',
  documentType: 'supplier_order',
  routeName: 'Заказ поставщику от 100 000',
  round: 2,
  state: 'in_progress',
  currentStep: 0,
  currentStepName: 'Руководитель',
  snapshot: { steps: [{ name: 'Руководитель', mode: 'sequential', dueHours: 4 }, { name: 'Бухгалтерия', mode: 'parallel', dueHours: null }] },
  authorId: 'm-author',
  authorName: 'Автор Петров',
  startedAt: '2026-11-16T07:00:00Z',
  finishedAt: null,
  cancelReason: null,
  changedSinceSubmit: false,
  tasks: [task({ overdueHours: 3 }), task({ id: 't2', stepIndex: 1, memberId: 'm-acc', memberName: 'Бухгалтер Сидорова', positionName: 'Бухгалтер', state: 'waiting', dueAt: null })],
  ...over,
});

const info = (over: Partial<ApprovalOfObject> = {}): ApprovalOfObject => {
  const cur = process();
  return { enabled: true, gate: 'in_progress', route: { id: 'r1', name: cur.routeName, required: true }, canStart: false, current: cur, rounds: [cur], ...over };
};

const render = (props: Partial<ApprovalBodyProps> & { info: ApprovalOfObject }) =>
  renderToStaticMarkup(<ApprovalBody memberId={null} isAdmin={false} canWrite onStart={() => {}} onDecide={async () => true} onCancel={async () => true} onPrint={() => {}} {...props} />);

describe('ApprovalBody', () => {
  setLocale('ru');

  test('идущий процесс: состояние, маршрут, этапы, участники и красная просрочка', () => {
    const html = render({ info: info() });
    expect(html).toContain('На согласовании');
    expect(html).toContain('Маршрут: Заказ поставщику от 100 000');
    expect(html).toContain('Круг 2');
    expect(html).toContain('Руководитель Иванов');
    expect(html).toContain('Бухгалтер Сидорова');
    expect(html).toContain('Просрочено на 3 ч');
    expect(html).toContain('var(--red)');
    expect(html).toContain('Печать листа');
    // чужой наблюдатель кнопок решения не видит
    expect(html).not.toContain('>Согласовать<');
  });

  test('моя задача: «Согласовать», «Отклонить», «Комментарий»', () => {
    const html = render({ info: info(), memberId: 'm-boss' });
    expect(html).toContain('>Согласовать<');
    expect(html).toContain('>Отклонить<');
    expect(html).toContain('>Комментарий<');
    // задача бухгалтера ждёт очереди: кнопок у неё нет (по одному набору на мою задачу)
    expect(html.match(/>Отклонить</g)).toHaveLength(1);
  });

  test('«Отозвать» видят автор и admin, остальные — нет', () => {
    expect(render({ info: info(), memberId: 'm-author' })).toContain('Отозвать');
    expect(render({ info: info(), isAdmin: true })).toContain('Отозвать');
    expect(render({ info: info(), memberId: 'm-boss' })).not.toContain('Отозвать');
  });

  test('документ изменён после отправки — предупреждение', () => {
    const cur = process({ changedSinceSubmit: true });
    expect(render({ info: info({ current: cur, rounds: [cur] }) })).toContain('Документ изменён после отправки на согласование');
  });

  test('нет процесса, маршрут подходит: кнопка «Отправить на согласование» и пометка об обязательности', () => {
    const html = render({ info: { enabled: true, gate: 'required', route: { id: 'r1', name: 'Маршрут', required: true }, canStart: true, current: null, rounds: [] } });
    expect(html).toContain('Отправить на согласование');
    expect(html).toContain('Требуется согласование');
    expect(html).toContain('Обязательное');
    expect(html).not.toContain('Печать листа');
  });

  test('заявка на расход при идущем процессе: пояснение вместо ручных кнопок', () => {
    expect(render({ info: info(), paymentRequest: true })).toContain('Заявка согласуется по маршруту');
  });

  test('история кругов: отклонённый круг и причина отзыва', () => {
    const rejected = process({
      id: 'ap0',
      round: 1,
      state: 'rejected',
      finishedAt: '2026-11-15T12:00:00Z',
      tasks: [task({ id: 'x', state: 'done', decision: 'reject', comment: 'Дорого', decidedAt: '2026-11-15T12:00:00Z' })],
    });
    const html = render({ info: info({ current: null, gate: 'required', canStart: true, rounds: [rejected] }) });
    expect(html).toContain('Отклонено');
    expect(html).toContain('Дорого');
    expect(html).toContain('Круг 1');
  });

  test('английский язык: те же данные, ключи словаря en', () => {
    setLocale('en');
    const html = render({ info: info(), memberId: 'm-boss' });
    setLocale('ru');
    expect(html).toContain('Overdue by 3 h');
    expect(html).toContain('>Approve<');
  });
});
