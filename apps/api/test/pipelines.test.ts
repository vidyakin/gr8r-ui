/* Задача 1176: воронки продаж — воронка и этапы нового воркспейса, переход сделки (категории, закрытие, причина проигрыша,
   обязательные поля), перенос в другую воронку, история этапов, инварианты воронки, права и изоляция арендаторов,
   просрочка норматива, триггеры и действие автоматизаций, отчёт-воронка. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { runDealOverdueOnce } from '../../worker/src/deal-overdue';
import { defaultOptions, processEventsOnce, processJobsOnce } from '../../worker/src/worker';
import { admin, Client, ddl, sql, stageId } from './helpers';

const opts = () => defaultOptions({ log: () => {}, concurrency: 10, ddl });
async function drain(max = 60) {
  const o = opts();
  for (let i = 0; i < max; i++) if (!((await processEventsOnce(sql, o)) + (await processJobsOnce(sql, o)))) return;
  throw new Error('worker did not settle');
}

let owner: Client;
let member: Client;
let other: Client;
let ws: string;
let reasonId: string;
let pipelines: any[];
let stages: any[];

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const history = async (id: string) => (await owner.get(`/deals/${id}/stage-history`)).body.items as any[];

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Воронки WS' });
  ws = owner.workspaceId!;
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${ws}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = ws;
  other = new Client();
  await other.signup({ workspaceName: 'Чужие воронки WS' });
  pipelines = (await owner.get('/deal-pipelines')).body.items;
  stages = (await owner.get(`/deal-stages?pipelineId=${pipelines[0].id}&sort=sortOrder`)).body.items;
  reasonId = (await owner.get('/deal-lost-reasons')).body.items[0].id;
});

describe('воронка и этапы нового воркспейса', () => {
  test('основная воронка с шестью этапами и справочником причин', () => {
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0]).toMatchObject({ isDefault: true });
    expect(stages.map(s => s.category)).toEqual(['in_progress', 'in_progress', 'in_progress', 'in_progress', 'won', 'lost']);
    expect(stages.map(s => s.probability)).toEqual([10, 25, 50, 75, 100, 0]);
    expect(reasonId).toBeTruthy();
  });

  test('сделка без этапа попадает в основную воронку на первый этап; пишется история', async () => {
    const d = await mk(owner, '/deals', { name: 'Новая' });
    expect(d.pipelineId).toBe(pipelines[0].id);
    expect(d.stageId).toBe(stages[0].id);
    const h = await history(d.id);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ fromStageId: null, toStageId: stages[0].id });
  });

  test('участник читает, но не настраивает воронки', async () => {
    expect((await member.get('/deal-pipelines')).status).toBe(200);
    expect((await member.post('/deal-pipelines', { name: 'X' })).status).toBe(403);
    expect((await member.post('/deal-stages', { pipelineId: pipelines[0].id, name: 'X' })).status).toBe(403);
    expect((await member.post('/deal-lost-reasons', { name: 'X' })).status).toBe(403);
  });
});

describe('переход сделки', () => {
  test('выиграна: дата закрытия; возврат на открытый этап сбрасывает её; история и заметки', async () => {
    const d = await mk(owner, '/deals', { name: 'К победе', amount: '500' });
    const won = await owner.patch(`/deals/${d.id}`, { stageId: await stageId(owner, 'won') });
    expect(won.body.closedAt).toBe(new Date().toISOString().slice(0, 10));
    const back = await owner.patch(`/deals/${d.id}`, { stageId: await stageId(owner, 'negotiation') });
    expect(back.body.closedAt).toBeNull();
    const h = await history(d.id);
    expect(h.map(x => x.toStageId)).toEqual([await stageId(owner, 'negotiation'), await stageId(owner, 'won'), stages[0].id]);
    const notes = (await owner.get(`/crm-activities?dealId=${d.id}`)).body.items.filter((a: any) => a.system);
    expect(notes).toHaveLength(2);
  });

  test('проигрыш требует причину из справочника', async () => {
    const d = await mk(owner, '/deals', { name: 'К проигрышу' });
    const lostId = await stageId(owner, 'lost');
    const no = await owner.patch(`/deals/${d.id}`, { stageId: lostId });
    expect(no.status).toBe(422);
    expect(no.body.error.code).toBe('deal_lost_reason_required');
    const ok = await owner.patch(`/deals/${d.id}`, { stageId: lostId, lostReasonId: reasonId, lostReason: 'клиент ушёл' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ lostReasonId: reasonId, lostReason: 'клиент ушёл', closedAt: new Date().toISOString().slice(0, 10) });
    // возврат в работу очищает причину
    const back = await owner.patch(`/deals/${d.id}`, { stageId: stages[1].id });
    expect(back.body).toMatchObject({ lostReasonId: null, lostReason: null, closedAt: null });
    // эта сделка остаётся проигранной: причина занята ею (см. тест удаления причин)
    const kept = await mk(owner, '/deals', { name: 'Остаётся проигранной' });
    expect((await owner.patch(`/deals/${kept.id}`, { stageId: lostId, lostReasonId: reasonId })).status).toBe(200);
    // создание сразу на этапе «проиграна» тоже требует причину
    expect((await owner.post('/deals', { name: 'Сразу проиграна', stageId: lostId })).status).toBe(422);
  });

  test('обязательные поля этапа проверяются на сервере по значениям после изменения', async () => {
    const proposal = await stageId(owner, 'proposal');
    expect((await owner.patch(`/deal-stages/${proposal}`, { requiredFields: ['amount', 'contact', 'closeDate', 'source'] })).status).toBe(200);
    const co = await mk(owner, '/companies', { name: 'Обяз Co' });
    const ct = await mk(owner, '/contacts', { name: 'Иван', companyId: co.id });
    const d = await mk(owner, '/deals', { name: 'Обязательные' });
    const bad = await owner.patch(`/deals/${d.id}`, { stageId: proposal });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('deal_stage_required_fields');
    expect(bad.body.error.details.fields.sort()).toEqual(['amount', 'closeDate', 'contact', 'source']);
    const src = await mk(owner, '/lead-sources', { name: 'Сайт обяз' });
    // поля приходят в том же запросе, что и переход
    const ok = await owner.patch(`/deals/${d.id}`, { stageId: proposal, amount: '1000', closeDate: '2030-01-01', contactIds: [ct.id], sourceId: src.id });
    expect(ok.status).toBe(200);
    expect(ok.body.stageId).toBe(proposal);
    // поле конструктора
    await owner.patch(`/deal-stages/${proposal}`, { requiredFields: ['custom:region'] });
    const d2 = await mk(owner, '/deals', { name: 'Регион' });
    expect((await owner.patch(`/deals/${d2.id}`, { stageId: proposal })).body.error.details.fields).toEqual(['custom:region']);
    expect((await owner.patch(`/deal-stages/${proposal}`, { requiredFields: ['bogus'] })).status).toBe(400);
    await owner.patch(`/deal-stages/${proposal}`, { requiredFields: [] });
  });

  test('перенос в другую воронку: на её первый этап или выбранный; чужой этап отвергается', async () => {
    const svc = await mk(owner, '/deal-pipelines', { name: 'Сервис WS', template: 'service' });
    const svcStages = (await owner.get(`/deal-stages?pipelineId=${svc.id}&sort=sortOrder`)).body.items as any[];
    expect(svcStages).toHaveLength(6);
    const d = await mk(owner, '/deals', { name: 'Переезд' });
    const moved = await owner.patch(`/deals/${d.id}`, { pipelineId: svc.id });
    expect(moved.body).toMatchObject({ pipelineId: svc.id, stageId: svcStages[0].id });
    const chosen = await owner.patch(`/deals/${d.id}`, { pipelineId: pipelines[0].id, stageId: stages[2].id });
    expect(chosen.body).toMatchObject({ pipelineId: pipelines[0].id, stageId: stages[2].id });
    const mismatch = await owner.patch(`/deals/${d.id}`, { pipelineId: svc.id, stageId: stages[3].id });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.code).toBe('deal_stage_pipeline_mismatch');
    // составной внешний ключ не даёт записать этап чужой воронки мимо сервиса
    let fkError = '';
    try {
      await admin`update deals set stage_id = ${svcStages[1].id} where id = ${d.id}`;
    } catch (e) {
      fkError = String(e);
    }
    expect(fkError).toContain('deals_stage_fk');
    // сделки всех воронок видны всем участникам
    const seen = (await member.get(`/deals?pipelineId=${svc.id}`)).body;
    expect(seen.items.length).toBe(0);
    await owner.patch(`/deals/${d.id}`, { pipelineId: svc.id });
    expect((await member.get(`/deals?pipelineId=${svc.id}`)).body.total).toBe(1);
    expect((await member.get('/deals?limit=200')).body.items.some((x: any) => x.id === d.id)).toBe(true);
    // воронку со сделками удалить нельзя, этап со сделками — тоже
    expect((await owner.del(`/deal-pipelines/${svc.id}`)).status).toBe(409);
    expect((await owner.del(`/deal-stages/${svcStages[0].id}`)).status).toBe(409);
    await owner.patch(`/deals/${d.id}`, { pipelineId: pipelines[0].id });
    expect((await owner.del(`/deal-pipelines/${svc.id}`)).status).toBe(200);
  });
});

describe('инварианты воронки', () => {
  test('ровно один «выиграна» и хотя бы один «проиграна»', async () => {
    const won = await stageId(owner, 'won');
    const lost = await stageId(owner, 'lost');
    expect((await owner.del(`/deal-stages/${won}`)).status).toBe(422);
    // последний «проиграна» воронки без сделок удалить нельзя
    const solo = await mk(owner, '/deal-pipelines', { name: 'Одна проигранная', template: 'repeat' });
    const soloStages = (await owner.get(`/deal-stages?pipelineId=${solo.id}`)).body.items as any[];
    expect((await owner.del(`/deal-stages/${soloStages.find(s => s.category === 'lost').id}`)).status).toBe(422);
    expect((await owner.del(`/deal-stages/${lost}`)).status).toBe(409); // а в основной на нём сделки
    expect((await owner.patch(`/deal-stages/${won}`, { category: 'in_progress' })).status).toBe(422);
    const second = await owner.post('/deal-stages', { pipelineId: pipelines[0].id, name: 'Ещё выиграна', category: 'won' });
    expect(second.status).toBeGreaterThanOrEqual(400);
    // второй «проиграна» можно, и тогда первый удаляется
    const extra = await mk(owner, '/deal-stages', { pipelineId: pipelines[0].id, name: 'Отказ клиента', category: 'lost' });
    expect((await owner.del(`/deal-stages/${extra.id}`)).status).toBe(200);
    // основную воронку не удалить
    expect((await owner.del(`/deal-pipelines/${pipelines[0].id}`)).status).toBe(422);
    // шаблон без «проиграна» не создаётся
    const bad = await owner.post('/deal-pipelines', { name: 'Кривая', stages: [{ name: 'A' }, { name: 'B', category: 'won' }, { name: 'C' }] });
    expect(bad.status).toBe(422);
  });

  test('причину проигрыша нельзя удалить, пока она используется', async () => {
    expect((await owner.del(`/deal-lost-reasons/${reasonId}`)).status).toBe(409);
    const fresh = await mk(owner, '/deal-lost-reasons', { name: 'Временная причина' });
    expect((await owner.del(`/deal-lost-reasons/${fresh.id}`)).status).toBe(200);
  });

  test('порядок этапов меняется перетаскиванием', async () => {
    const svc = await mk(owner, '/deal-pipelines', { name: 'Порядок WS', template: 'repeat' });
    const list = (await owner.get(`/deal-stages?pipelineId=${svc.id}&sort=sortOrder`)).body.items as any[];
    const ids = list.map(s => s.id).reverse();
    expect((await owner.post('/deal-stages/reorder', { pipelineId: svc.id, ids })).status).toBe(200);
    expect(((await owner.get(`/deal-stages?pipelineId=${svc.id}&sort=sortOrder`)).body.items as any[]).map(s => s.id)).toEqual(ids);
  });
});

describe('изоляция арендаторов', () => {
  test('чужой воркспейс не видит воронки и не ссылается на чужие этапы', async () => {
    const theirs = (await other.get('/deal-pipelines')).body.items as any[];
    expect(theirs).toHaveLength(1);
    expect(theirs[0].id).not.toBe(pipelines[0].id);
    expect((await other.get(`/deal-stages/${stages[0].id}`)).status).toBe(404);
    const r = await other.post('/deals', { name: 'Чужая', stageId: stages[0].id });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect((await other.get('/deal-funnel?from=2020-01-01&to=2030-01-01')).body.totals.deals).toBe(0);
  });
});

describe('просрочка норматива', () => {
  test('событие объявляется один раз за вход в этап; фильтр overdue; триггер автоматизации', async () => {
    const stage = stages[1].id;
    await owner.patch(`/deal-stages/${stage}`, { slaDays: 1 });
    const d = await mk(owner, '/deals', { name: 'Застряла', stageId: stage });
    const fresh = await mk(owner, '/deals', { name: 'Свежая', stageId: stage });
    await admin`update deals set stage_entered_at = now() - interval '3 days' where id = ${d.id}`;
    expect((await owner.get('/deals?overdue=true&limit=200')).body.items.map((x: any) => x.id)).toEqual([d.id]);
    const flow = await mk(owner, '/flows', {
      name: 'Просрочка',
      graph: {
        nodes: [
          { id: 't', type: 'trigger.deal_stage_overdue', position: { x: 0, y: 0 }, params: { stageId: stage } },
          { id: 'n', type: 'action.add_comment', position: { x: 200, y: 0 }, params: { entity: 'deal', recordId: '{{trigger.recordId}}', body: 'Просрочен норматив' } },
        ],
        edges: [{ id: 't-n', source: 't', target: 'n', sourceHandle: null }],
      },
    });
    expect((await owner.post(`/flows/${flow.id}/publish`, { enable: true })).status).toBe(200);
    expect(await runDealOverdueOnce(sql)).toBeGreaterThanOrEqual(1);
    expect(await runDealOverdueOnce(sql)).toBe(0); // повторный проход ничего не объявляет
    await drain();
    const runs = (await owner.get(`/flow-runs?flowId=${flow.id}`)).body.items as any[];
    expect(runs.map(r => r.status)).toEqual(['succeeded']);
    // повторный вход в этап снова разрешает объявление
    await owner.patch(`/deals/${d.id}`, { stageId: stages[2].id });
    await owner.patch(`/deals/${d.id}`, { stageId: stage });
    await admin`update deals set stage_entered_at = now() - interval '3 days' where id = ${d.id}`;
    expect(await runDealOverdueOnce(sql)).toBeGreaterThanOrEqual(1);
    await owner.patch(`/deals/${fresh.id}`, { stageId: stages[0].id });
    await owner.patch(`/deal-stages/${stage}`, { slaDays: null });
    await admin`update flows set enabled = false where id = ${flow.id}`;
  });
});

describe('автоматизации', () => {
  test('триггер «перешла на этап» и действие «перевести сделку»', async () => {
    const proposal = stages[2].id;
    const negotiation = stages[3].id;
    const flow = await mk(owner, '/flows', {
      name: 'Авто-перевод',
      graph: {
        nodes: [
          { id: 't', type: 'trigger.deal_stage_changed', position: { x: 0, y: 0 }, params: { stageId: proposal } },
          { id: 'm', type: 'action.move_deal', position: { x: 200, y: 0 }, params: { dealId: '{{trigger.recordId}}', stageId: negotiation } },
        ],
        edges: [{ id: 't-m', source: 't', target: 'm', sourceHandle: null }],
      },
    });
    expect((await owner.post(`/flows/${flow.id}/publish`, { enable: true })).status).toBe(200);
    const d = await mk(owner, '/deals', { name: 'Автомат', amount: '10' });
    await owner.patch(`/deals/${d.id}`, { stageId: proposal });
    await drain();
    expect((await owner.get(`/deals/${d.id}`)).body.stageId).toBe(negotiation);
    // действие проверяет обязательные поля как API: ошибка шага, сделка остаётся на месте
    await owner.patch(`/deal-stages/${negotiation}`, { requiredFields: ['contact'] });
    const d2 = await mk(owner, '/deals', { name: 'Автомат 2' });
    await owner.patch(`/deals/${d2.id}`, { stageId: proposal });
    await drain();
    expect((await owner.get(`/deals/${d2.id}`)).body.stageId).toBe(proposal);
    const failed = ((await owner.get(`/flow-runs?flowId=${flow.id}&limit=50`)).body.items as any[]).filter(r => r.status === 'failed');
    expect(failed.length).toBe(1);
    await owner.patch(`/deal-stages/${negotiation}`, { requiredFields: [] });
    await admin`update flows set enabled = false where id = ${flow.id}`;
  });

  test('триггеры «сделка выиграна» и «сделка проиграна» смотрят на категорию этапа', async () => {
    const mkFlow = async (type: string) => {
      const f = await mk(owner, '/flows', {
        name: type,
        graph: {
          nodes: [
            { id: 't', type, position: { x: 0, y: 0 }, params: {} },
            { id: 'c', type: 'action.add_comment', position: { x: 200, y: 0 }, params: { entity: 'deal', recordId: '{{trigger.recordId}}', body: type } },
          ],
          edges: [{ id: 't-c', source: 't', target: 'c', sourceHandle: null }],
        },
      });
      expect((await owner.post(`/flows/${f.id}/publish`, { enable: true })).status).toBe(200);
      return f.id as string;
    };
    const wonFlow = await mkFlow('trigger.deal_won');
    const lostFlow = await mkFlow('trigger.deal_lost');
    const w = await mk(owner, '/deals', { name: 'Победа' });
    await owner.patch(`/deals/${w.id}`, { stageId: await stageId(owner, 'won') });
    const l = await mk(owner, '/deals', { name: 'Поражение' });
    await owner.patch(`/deals/${l.id}`, { stageId: await stageId(owner, 'lost'), lostReasonId: reasonId });
    await drain();
    const count = async (id: string) => ((await owner.get(`/flow-runs?flowId=${id}&limit=50`)).body.items as any[]).filter(r => r.status === 'succeeded').length;
    expect(await count(wonFlow)).toBe(1);
    expect(await count(lostFlow)).toBe(1);
    await admin`update flows set enabled = false where id = ${wonFlow}`;
    await admin`update flows set enabled = false where id = ${lostFlow}`;
  });
});

describe('отчёт-воронка', () => {
  test('сделки и суммы по этапам, конверсия, прогноз по вероятности, время на этапе', async () => {
    const f = new Client();
    await f.signup({ workspaceName: 'Воронка-отчёт WS' });
    const st = (await f.get('/deal-stages?sort=sortOrder')).body.items as any[];
    const reason = (await f.get('/deal-lost-reasons')).body.items[0].id;
    const make = async (name: string, amount: string, path: number[], lost = false) => {
      const d = await mk(f, '/deals', { name, amount, stageId: st[path[0]!].id });
      for (const i of path.slice(1)) {
        const r = await f.patch(`/deals/${d.id}`, { stageId: st[i].id, ...(lost && i === 5 ? { lostReasonId: reason } : {}) });
        if (r.status !== 200) throw new Error(JSON.stringify(r.body));
      }
      return d;
    };
    await make('A', '100', [0]); // Lead
    await make('B', '200', [0, 1]); // Qualified
    await make('C', '400', [0, 1, 2]); // Proposal
    await make('D', '800', [0, 1, 2, 3]); // Negotiation
    await make('E', '1600', [0, 1, 4]); // Won (через Qualified)
    await make('F', '50', [0, 1, 5], true); // Lost
    const to = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const rep = (await f.get(`/deal-funnel?from=2020-01-01&to=${to}`)).body;
    expect(rep.totals).toMatchObject({ deals: 6, open: 4, won: 1, lost: 1 });
    const by = Object.fromEntries(rep.rows.map((r: any) => [r.name, r]));
    expect(by.Lead).toMatchObject({ count: 1, amount: '100.00', reached: 6 });
    expect(by.Qualified).toMatchObject({ count: 1, reached: 5, conversion: 83.3 });
    expect(by.Proposal).toMatchObject({ count: 1, reached: 3 });
    expect(by.Negotiation).toMatchObject({ count: 1, reached: 2, weighted: '600.00' });
    expect(by.Won).toMatchObject({ count: 1, amount: '1600.00' });
    expect(by.Lost).toMatchObject({ count: 1 });
    // прогноз = Σ сумма × вероятность открытых этапов: 100·10% + 200·25% + 400·50% + 800·75%
    expect(rep.totals.weighted).toBe('860.00');
    expect(by.Lead.avgDays).not.toBeNull();
    // период вне диапазона — пусто
    expect((await f.get('/deal-funnel?from=2001-01-01&to=2001-02-01')).body.totals.deals).toBe(0);
  });
});
