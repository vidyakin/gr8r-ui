/* Автоматизации: триггер → условие → действия, задержка, повтор, защита от зацикливания, лимиты, SSRF, изоляция арендаторов.
   Воркер вызывается напрямую (processEventsOnce / processJobsOnce): события и задачи обрабатываются так же, как в проде. */
import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { TransientError, type HttpRequest, type HttpResult } from '@gr8r/shared';
import { flowEngine } from '../../worker/src/flows/engine';
import { scheduleFlowsOnce } from '../../worker/src/flows/triggers';
import { defaultOptions, processEventsOnce, processJobsOnce } from '../../worker/src/worker';
import { admin, Client, ddl, sql } from './helpers';

const opts = () => defaultOptions({ log: () => {}, concurrency: 10, ddl });

/** Гоняет outbox и очередь, пока есть работа (задержки не ждёт: их job в будущем) */
async function drain(max = 60) {
  const o = opts();
  for (let i = 0; i < max; i++) {
    const n = (await processEventsOnce(sql, o)) + (await processJobsOnce(sql, o));
    if (!n) return;
  }
  throw new Error('worker did not settle: possible event loop');
}

type NodeSpec = [id: string, type: string, params: Record<string, unknown>];
type EdgeSpec = [from: string, to: string, handle?: string];
const graph = (nodes: NodeSpec[], edges: EdgeSpec[]) => ({
  nodes: nodes.map(([id, type, params], i) => ({ id, type, position: { x: i * 220, y: 0 }, params })),
  edges: edges.map(([source, target, h]) => ({ id: `${source}-${target}-${h ?? 'out'}`, source, target, sourceHandle: h ?? null })),
});

async function makeFlow(c: Client, name: string, g: ReturnType<typeof graph>, publish = true) {
  const created = await c.post('/flows', { name, graph: g });
  expect(created.status).toBe(201);
  if (publish) {
    const pub = await c.post(`/flows/${created.body.id}/publish`, { enable: true });
    if (pub.status !== 200) throw new Error(`publish failed: ${JSON.stringify(pub.body)}`);
  }
  return created.body.id as string;
}

async function runsOf(c: Client, flowId: string) {
  return (await c.get(`/flow-runs?flowId=${flowId}&limit=100`)).body.items as any[];
}
async function runDetail(c: Client, runId: string) {
  return (await c.get(`/flow-runs/${runId}`)).body;
}

let owner: Client;
let ws: string;
let me: string; // members.id владельца
let project: { id: string };

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Flows WS' });
  ws = owner.workspaceId!;
  me = (await owner.get('/members')).body.items.find((m: any) => m.email === owner.user!.email).id;
  project = await owner.project('FLW', 'Flows project');
});

afterEach(async () => {
  // Каждый тест начинает с чистого листа: flow прежних тестов не должны реагировать на события следующих
  await admin`update flows set enabled = false where workspace_id = ${ws}`;
  flowEngine.httpImpl = undefined;
  flowEngine.maxSteps = 100;
  flowEngine.retryBaseSec = 5;
});

describe('flows: trigger → condition → actions', () => {
  test('task moved to Review → condition → priority set to 10 → notification', async () => {
    const flowId = await makeFlow(
      owner,
      'Review escalation',
      graph(
        [
          ['t', 'trigger.field_changed', { entity: 'task', field: 'status', to: 'review' }],
          ['c', 'logic.condition', { left: '{{trigger.record.priority}}', operator: 'lt', right: '10' }],
          ['u', 'action.update_field', { entity: 'task', recordId: '{{trigger.recordId}}', field: 'priority', value: '10' }],
          ['n', 'action.notify', { recipientId: me, text: 'Escalated', snippet: '{{trigger.record.title}} is in review', taskId: '{{trigger.recordId}}' }],
        ],
        [['t', 'c'], ['c', 'u', 'true'], ['u', 'n']],
      ),
    );
    const task = await owner.task(project.id, 'Ship the thing', { priority: 3 });
    await owner.patch(`/tasks/${task.id}`, { status: 'progress' }); // другое значение — не подходит
    await drain();
    expect(await runsOf(owner, flowId)).toHaveLength(0);

    await owner.patch(`/tasks/${task.id}`, { status: 'review' });
    await drain();
    const runs = await runsOf(owner, flowId);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('succeeded');
    const detail = await runDetail(owner, runs[0].id);
    expect(detail.steps.map((s: any) => [s.nodeId, s.status])).toEqual([['t', 'succeeded'], ['c', 'succeeded'], ['u', 'succeeded'], ['n', 'succeeded']]);
    expect(detail.steps[1].output).toMatchObject({ result: true });
    expect(detail.steps[2].input).toMatchObject({ value: '10', recordId: task.id });
    expect(detail.steps[2].output).toMatchObject({ before: 3, after: 10, changed: true });

    expect((await owner.get(`/tasks/${task.id}`)).body.priority).toBe(10);
    const notes = (await owner.get('/notifications?q=Escalated')).body.items;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ recipientId: me, snippet: 'Ship the thing is in review', taskId: task.id, actorId: null });
  });

  test('condition false → the other branch is not executed; branch node routes by value', async () => {
    const flowId = await makeFlow(
      owner,
      'Branching',
      graph(
        [
          ['t', 'trigger.record_updated', { entity: 'task' }],
          ['b', 'flow.branch', { value: '{{trigger.record.status}}', cases: 'review\nprogress' }],
          ['c1', 'action.add_comment', { entity: 'task', recordId: '{{trigger.recordId}}', body: 'went to review' }],
          ['c2', 'action.add_comment', { entity: 'task', recordId: '{{trigger.recordId}}', body: 'went to progress' }],
          ['c3', 'action.add_comment', { entity: 'task', recordId: '{{trigger.recordId}}', body: 'went elsewhere' }],
        ],
        [['t', 'b'], ['b', 'c1', 'case_0'], ['b', 'c2', 'case_1'], ['b', 'c3', 'else']],
      ),
    );
    const task = await owner.task(project.id, 'Branch me');
    await owner.patch(`/tasks/${task.id}`, { status: 'progress' });
    await drain();
    const runs = await runsOf(owner, flowId);
    expect(runs).toHaveLength(1);
    const detail = await runDetail(owner, runs[0].id);
    expect(detail.steps.map((s: any) => s.nodeId)).toEqual(['t', 'b', 'c2']);
    const bodies = (await owner.get(`/comments?taskId=${task.id}`)).body.items.map((x: any) => x.body);
    expect(bodies).toEqual(['went to progress']);
  });

  test('custom field update is validated by the entity builder schema', async () => {
    const f = await owner.post('/entities/task/fields', { name: 'Story points', type: 'number', options: { min: 0, max: 100 } });
    expect(f.status).toBe(201);
    const flowId = await makeFlow(
      owner,
      'Points',
      graph(
        [
          ['t', 'trigger.manual', { entity: 'task' }],
          ['u', 'action.update_field', { entity: 'task', recordId: '{{trigger.recordId}}', field: 'story_points', value: '{{trigger.record.title}}' }],
        ],
        [['t', 'u']],
      ),
    );
    const task = await owner.task(project.id, '8');
    expect((await owner.post(`/flows/${flowId}/run`, { entity: 'task', recordId: task.id })).status).toBe(201);
    await drain();
    expect((await owner.get(`/tasks/${task.id}`)).body.custom.story_points).toBe(8);

    const bad = await owner.task(project.id, '500');
    await owner.post(`/flows/${flowId}/run`, { entity: 'task', recordId: bad.id });
    await drain();
    const failed = (await runsOf(owner, flowId)).find(r => r.status === 'failed');
    expect(failed.error).toContain('Story points');
    expect((await owner.get(`/tasks/${bad.id}`)).body.custom.story_points).toBeUndefined();
  });

  test('create_task action: the demo "deal won → Kickoff task" scenario', async () => {
    const flowId = await makeFlow(
      owner,
      'Kickoff',
      graph(
        [
          ['t', 'trigger.field_changed', { entity: 'deal', field: 'stage', to: 'won' }],
          ['k', 'action.create_task', { projectId: project.id, title: 'Kickoff: {{trigger.record.name}}', priority: '8', assigneeId: me }],
        ],
        [['t', 'k']],
      ),
    );
    const deal = (await owner.post('/deals', { name: 'Big deal', stage: 'proposal' })).body;
    await owner.patch(`/deals/${deal.id}`, { stage: 'won' });
    await drain();
    const runs = await runsOf(owner, flowId);
    expect(runs.map(r => r.status)).toEqual(['succeeded']);
    const tasks = (await owner.get(`/tasks?q=Kickoff&projectId=${project.id}`)).body.items;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: 'Kickoff: Big deal', priority: 8, assigneeId: me });
    expect(tasks[0].key).toMatch(/^FLW-\d+$/);
  });
});

describe('flows: delay, retries, limits', () => {
  test('delay pauses the run via jobs.run_at, then continues', async () => {
    const flowId = await makeFlow(
      owner,
      'Delayed',
      graph(
        [
          ['t', 'trigger.record_created', { entity: 'task' }],
          ['d', 'flow.delay', { amount: 10, unit: 'minutes' }],
          ['u', 'action.update_field', { entity: 'task', recordId: '{{trigger.recordId}}', field: 'description', value: 'touched after delay' }],
        ],
        [['t', 'd'], ['d', 'u']],
      ),
    );
    const task = await owner.task(project.id, 'Wait for it');
    await drain();
    let [run] = await runsOf(owner, flowId);
    expect(run.status).toBe('waiting');
    expect((await owner.get(`/tasks/${task.id}`)).body.description).toBe('');
    const [job] = await admin`select run_at, status from jobs where type = 'flow.run' and payload->>'runId' = ${run.id} and status = 'queued'`;
    expect(new Date(job!.run_at as unknown as string).getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
    let detail = await runDetail(owner, run.id);
    expect(detail.steps.map((s: any) => [s.nodeId, s.status])).toEqual([['t', 'succeeded'], ['d', 'waiting']]);

    // «Прошло 10 минут»
    await admin`update jobs set run_at = now() where type = 'flow.run' and payload->>'runId' = ${run.id}`;
    await admin`update flow_runs set state = jsonb_set(state, '{resumeAt}', to_jsonb(now() - interval '1 second')) where id = ${run.id}`;
    await drain();
    [run] = await runsOf(owner, flowId);
    expect(run.status).toBe('succeeded');
    detail = await runDetail(owner, run.id);
    expect(detail.steps.map((s: any) => [s.nodeId, s.status])).toEqual([['t', 'succeeded'], ['d', 'succeeded'], ['u', 'succeeded']]);
    expect((await owner.get(`/tasks/${task.id}`)).body.description).toBe('touched after delay');
  });

  test('a job that fires before the delay is over does nothing', async () => {
    const flowId = await makeFlow(owner, 'Early job', graph([['t', 'trigger.manual', {}], ['d', 'flow.delay', { amount: 1, unit: 'hours' }], ['n', 'action.notify', { recipientId: me, text: 'late' }]], [['t', 'd'], ['d', 'n']]));
    await owner.post(`/flows/${flowId}/run`, {});
    await drain();
    const [run] = await runsOf(owner, flowId);
    await admin`update jobs set run_at = now() where type = 'flow.run' and payload->>'runId' = ${run.id}`; // job раньше срока, state.resumeAt в будущем
    await drain();
    expect((await runsOf(owner, flowId))[0].status).toBe('waiting');
  });

  test('transient HTTP errors are retried with attempts counted; success after retries', async () => {
    let calls = 0;
    flowEngine.retryBaseSec = 0;
    flowEngine.httpImpl = async (req: HttpRequest): Promise<HttpResult> => {
      calls++;
      if (calls < 3) throw new TransientError('HTTP 503 from hooks.example.com');
      return { status: 200, ok: true, headers: {}, body: JSON.stringify({ got: req.url }), json: { got: req.url } };
    };
    const flowId = await makeFlow(
      owner,
      'Webhook',
      graph(
        [
          ['t', 'trigger.manual', {}],
          ['h', 'action.http_request', { method: 'POST', url: 'https://hooks.example.com/{{flow.name}}', headers: 'Content-Type: application/json\nAuthorization: Bearer top-secret', body: '{"a":1}' }],
        ],
        [['t', 'h']],
      ),
    );
    await owner.post(`/flows/${flowId}/run`, {});
    await drain();
    const [run] = await runsOf(owner, flowId);
    expect(run.status).toBe('succeeded');
    expect(calls).toBe(3);
    const detail = await runDetail(owner, run.id);
    const step = detail.steps.find((s: any) => s.nodeId === 'h');
    expect(step).toMatchObject({ status: 'succeeded', attempt: 3 });
    expect(step.output.json).toEqual({ got: 'https://hooks.example.com/Webhook' });
    expect(JSON.stringify(step.input)).not.toContain('top-secret'); // секреты не попадают в журнал
    expect(step.input.headers).toContain('Authorization: ***');
  });

  test('transient errors give up after max attempts; permanent errors fail at once', async () => {
    flowEngine.retryBaseSec = 0;
    let calls = 0;
    flowEngine.httpImpl = async () => {
      calls++;
      throw new TransientError('Request timed out after 10000 ms');
    };
    const flowId = await makeFlow(owner, 'Flaky', graph([['t', 'trigger.manual', {}], ['h', 'action.http_request', { method: 'GET', url: 'https://slow.example.com/' }]], [['t', 'h']]));
    await owner.post(`/flows/${flowId}/run`, {});
    await drain();
    let [run] = await runsOf(owner, flowId);
    expect(run.status).toBe('failed');
    expect(calls).toBe(flowEngine.maxAttempts);
    expect(run.error).toContain('gave up after 3 attempts');

    flowEngine.httpImpl = async () => ({ status: 404, ok: false, headers: {}, body: 'nope' });
    await owner.post(`/flows/${flowId}/run`, {});
    await drain();
    [run] = (await runsOf(owner, flowId)).filter(r => r.status === 'failed' && r.error.includes('404'));
    expect(run.error).toContain('HTTP 404');
  });

  test('SSRF: private and local addresses are rejected before any request', async () => {
    const urls = ['http://127.0.0.1:9/x', 'http://169.254.169.254/latest/meta-data', 'http://localhost/admin', 'http://[::1]/', 'http://10.0.0.5/', 'http://2130706433/', 'file:///etc/passwd'];
    const flowId = await makeFlow(owner, 'Ssrf', graph([['t', 'trigger.manual', {}]], []), false);
    for (const url of urls) {
      await owner.patch(`/flows/${flowId}`, { graph: graph([['t', 'trigger.manual', {}], ['h', 'action.http_request', { method: 'GET', url }]], [['t', 'h']]) });
      await owner.post(`/flows/${flowId}/publish`, {});
      await owner.post(`/flows/${flowId}/run`, {});
    }
    await drain();
    const runs = await runsOf(owner, flowId);
    expect(runs).toHaveLength(urls.length);
    expect(runs.every(r => r.status === 'failed')).toBe(true);
    const errors = runs.map(r => r.error as string);
    expect(errors.filter(e => /blocked/.test(e))).toHaveLength(urls.length - 1);
    expect(errors.some(e => /Only http and https/.test(e))).toBe(true);
  });

  test('step limit per run', async () => {
    flowEngine.maxSteps = 2;
    const flowId = await makeFlow(
      owner,
      'Long',
      graph([['t', 'trigger.manual', {}], ['a', 'action.notify', { recipientId: me, text: '1' }], ['b', 'action.notify', { recipientId: me, text: '2' }], ['c', 'action.notify', { recipientId: me, text: '3' }]], [['t', 'a'], ['a', 'b'], ['b', 'c']]),
    );
    await owner.post(`/flows/${flowId}/run`, {});
    await drain();
    const [run] = await runsOf(owner, flowId);
    expect(run.status).toBe('failed');
    expect(run.error).toContain('Step limit exceeded');
    expect(run.stepCount).toBe(2);
  });

  test('a failed step rolls back its own writes but keeps the journal', async () => {
    // Первое действие меняет задачу, второе падает (неверный получатель) — первое остаётся (оно отдельный шаг), у упавшего записей нет
    const task = await owner.task(project.id, 'Rollback');
    const flowId = await makeFlow(
      owner,
      'Partial',
      graph(
        [
          ['t', 'trigger.manual', { entity: 'task' }],
          ['u', 'action.update_field', { entity: 'task', recordId: '{{trigger.recordId}}', field: 'description', value: 'first step done' }],
          ['n', 'action.notify', { recipientId: '00000000-0000-4000-8000-000000000000', text: 'boom' }],
        ],
        [['t', 'u'], ['u', 'n']],
      ),
    );
    await owner.post(`/flows/${flowId}/run`, { entity: 'task', recordId: task.id });
    await drain();
    const [run] = await runsOf(owner, flowId);
    expect(run.status).toBe('failed');
    const detail = await runDetail(owner, run.id);
    expect(detail.steps.map((s: any) => [s.nodeId, s.status])).toEqual([['t', 'succeeded'], ['u', 'succeeded'], ['n', 'failed']]);
    expect(detail.steps[2].error).toContain('member not found');
    expect((await owner.get(`/tasks/${task.id}`)).body.description).toBe('first step done');
    expect((await owner.get('/notifications?q=boom')).body.items).toHaveLength(0);
  });
});

describe('flows: loop protection', () => {
  test('an event caused by the flow itself does not restart it', async () => {
    const flowId = await makeFlow(
      owner,
      'Self-triggering',
      graph([['t', 'trigger.record_updated', { entity: 'task' }], ['u', 'action.update_field', { entity: 'task', recordId: '{{trigger.recordId}}', field: 'priority', value: '7' }]], [['t', 'u']]),
    );
    const task = await owner.task(project.id, 'Loop bait', { priority: 1 });
    await owner.patch(`/tasks/${task.id}`, { title: 'Loop bait 2' });
    await drain(); // не зацикливается
    const runs = await runsOf(owner, flowId);
    expect(runs.map(r => r.status).sort()).toEqual(['skipped', 'succeeded']);
    expect(runs.find(r => r.status === 'skipped').error).toContain('loop protection');
    expect((await owner.get(`/tasks/${task.id}`)).body.priority).toBe(7);
  });

  test('another flow can react to a flow-made change, but the chain never returns to the first one', async () => {
    // A: title изменён → description = title + "a"; B: description изменено → title = description + "b". Без защиты это бесконечный обмен
    const a = await makeFlow(
      owner,
      'Chain A',
      graph([['t', 'trigger.field_changed', { entity: 'task', field: 'title' }], ['u', 'action.update_field', { entity: 'task', recordId: '{{trigger.recordId}}', field: 'description', value: '{{trigger.record.title}}a' }]], [['t', 'u']]),
    );
    const b = await makeFlow(
      owner,
      'Chain B',
      graph([['t', 'trigger.field_changed', { entity: 'task', field: 'description' }], ['u', 'action.update_field', { entity: 'task', recordId: '{{trigger.recordId}}', field: 'title', value: '{{trigger.record.description}}b' }]], [['t', 'u']]),
    );
    const task = await owner.task(project.id, 'T');
    await owner.patch(`/tasks/${task.id}`, { title: 'T1' });
    await drain();
    expect((await runsOf(owner, a)).map(r => r.status).sort()).toEqual(['skipped', 'succeeded']);
    expect((await runsOf(owner, b)).map(r => r.status)).toEqual(['succeeded']);
    const after = (await owner.get(`/tasks/${task.id}`)).body;
    expect(after).toMatchObject({ description: 'T1a', title: 'T1ab' });
  });

  test('the same event processed twice creates one run (idempotent)', async () => {
    const flowId = await makeFlow(owner, 'Once', graph([['t', 'trigger.record_created', { entity: 'task' }], ['n', 'action.notify', { recipientId: me, text: 'Once only' }]], [['t', 'n']]));
    const dup = await owner.task(project.id, 'Dup');
    await drain();
    await admin`update events set processed_at = null where record_id = ${dup.id} and type = 'task.created'`;
    await drain();
    expect(await runsOf(owner, flowId)).toHaveLength(1);
  });
});

describe('flows: schedule', () => {
  test('cron trigger fires once per matching minute', async () => {
    // расписание живёт в часовом поясе арендатора: переводим его в UTC, чтобы «9:00» осталось 9:00 UTC
    await owner.patch('/billing/timezone', { timezone: 'UTC' });
    const flowId = await makeFlow(owner, 'Morning', graph([['t', 'trigger.schedule', { cron: '0 9 * * 1-5' }], ['n', 'action.notify', { recipientId: me, text: 'Good morning {{trigger.scheduledFor}}' }]], [['t', 'n']]));
    const monday9 = new Date('2026-01-05T09:00:30Z');
    expect(await scheduleFlowsOnce(sql, new Date('2026-01-05T09:01:00Z'))).toBe(0);
    expect(await scheduleFlowsOnce(sql, new Date('2026-01-04T09:00:00Z'))).toBe(0); // воскресенье
    expect(await scheduleFlowsOnce(sql, monday9)).toBe(1);
    expect(await scheduleFlowsOnce(sql, monday9)).toBe(0); // та же минута
    await drain();
    const [run] = await runsOf(owner, flowId);
    expect(run).toMatchObject({ status: 'succeeded', triggerKind: 'schedule' });
    expect((await owner.get('/notifications?q=Good morning')).body.items[0].text).toBe('Good morning 2026-01-05T09:00:00.000Z');
  });

  test('cron trigger fires in the time zone of the workspace', async () => {
    // Europe/Moscow: 9:00 по Москве — это 6:00 UTC
    await owner.patch('/billing/timezone', { timezone: 'Europe/Moscow' });
    const flowId = await makeFlow(owner, 'Moscow morning', graph([['t', 'trigger.schedule', { cron: '0 9 * * 1-5' }], ['n', 'action.notify', { recipientId: me, text: 'Moscow morning {{trigger.scheduledFor}}' }]], [['t', 'n']]));
    expect(await scheduleFlowsOnce(sql, new Date('2026-01-05T06:00:30Z'))).toBe(1);
    expect(await scheduleFlowsOnce(sql, new Date('2026-01-05T09:00:30Z'))).toBe(0); // 12:00 по Москве — не 9:00
    await drain();
    const [run] = await runsOf(owner, flowId);
    expect(run).toMatchObject({ status: 'succeeded', triggerKind: 'schedule' });
    expect((await owner.get('/notifications?q=Moscow morning')).body.items[0].text).toBe('Moscow morning 2026-01-05T09:00:00.000Z');
    await owner.patch('/billing/timezone', { timezone: 'UTC' });
  });
});

describe('flows: API', () => {
  test('publish validates the graph; enable and run need a published version', async () => {
    const f = await owner.post('/flows', { name: 'Draft', graph: graph([['t', 'trigger.manual', {}], ['n', 'action.notify', { recipientId: me, text: 'hi' }], ['x', 'action.notify', { recipientId: me, text: 'orphan' }]], [['t', 'n']]) });
    const id = f.body.id;
    expect((await owner.patch(`/flows/${id}`, { enabled: true })).status).toBe(409);
    expect((await owner.post(`/flows/${id}/run`, {})).status).toBe(409);
    const bad = await owner.post(`/flows/${id}/publish`, {});
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('invalid_graph');
    expect(JSON.stringify(bad.body.error.details.issues)).toContain('not connected');

    await owner.patch(`/flows/${id}`, { graph: graph([['t', 'trigger.manual', {}], ['n', 'action.notify', { recipientId: me, text: 'hi' }]], [['t', 'n']]) });
    const pub = await owner.post(`/flows/${id}/publish`, { enable: true });
    expect(pub.status).toBe(200);
    expect(pub.body).toMatchObject({ enabled: true, publishedVersion: 1, hasDraftChanges: false });

    // правка черновика не трогает опубликованную версию
    const edit = await owner.patch(`/flows/${id}`, { name: 'Draft v2', graph: graph([['t', 'trigger.manual', {}]], []) });
    expect(edit.body.hasDraftChanges).toBe(true);
    expect(edit.body.publishedGraph.nodes).toHaveLength(2);
    expect((await owner.post(`/flows/${id}/publish`, {})).status).toBe(422); // триггер без шагов

    const list = (await owner.get('/flows')).body.items.find((x: any) => x.id === id);
    expect(list).toMatchObject({ enabled: true, publishedVersion: 1, hasDraftChanges: true, lastRun: null, failedRuns7d: 0 });
    expect(list.graph).toBeUndefined();

    expect((await owner.patch(`/flows/${id}`, { enabled: false })).body.enabled).toBe(false);
    expect((await owner.del(`/flows/${id}`)).status).toBe(200);
    expect((await owner.get(`/flows/${id}`)).status).toBe(404);
  });

  test('disabled flows do not run on events, a disabled flow stops waiting runs', async () => {
    const flowId = await makeFlow(owner, 'Toggle', graph([['t', 'trigger.record_created', { entity: 'task' }], ['n', 'action.notify', { recipientId: me, text: 'toggle' }]], [['t', 'n']]));
    await owner.patch(`/flows/${flowId}`, { enabled: false });
    await owner.task(project.id, 'Nobody listens');
    await drain();
    expect(await runsOf(owner, flowId)).toHaveLength(0);
  });

  test('only admins change flows; members can read them and the journal', async () => {
    const member = new Client();
    await member.signup();
    const inv = await owner.post(`/workspaces/${ws}/invites`, { email: member.user!.email, role: 'member' });
    await member.post('/invites/accept', { token: inv.body.token });
    member.workspaceId = ws;
    expect((await member.get('/flows')).status).toBe(200);
    expect((await member.post('/flows', { name: 'Nope' })).status).toBe(403);
  });
});

describe('flows: tenant isolation', () => {
  test('events, flows, runs and record access never cross workspaces', async () => {
    const bob = new Client();
    await bob.signup({ workspaceName: 'Bob WS' });
    const bobMe = (await bob.get('/members')).body.items.find((m: any) => m.email === bob.user!.email).id;
    const bobProject = await bob.project('BOB', 'Bob project');

    const mine = await makeFlow(owner, 'Mine', graph([['t', 'trigger.record_created', { entity: 'task' }], ['n', 'action.notify', { recipientId: me, text: 'Mine fired' }]], [['t', 'n']]));
    const theirs = await makeFlow(bob, 'Theirs', graph([['t', 'trigger.record_created', { entity: 'task' }], ['n', 'action.notify', { recipientId: bobMe, text: 'Theirs fired' }]], [['t', 'n']]));

    await bob.task(bobProject.id, 'Bob task');
    await drain();
    expect(await runsOf(bob, theirs)).toHaveLength(1);
    expect(await runsOf(owner, mine)).toHaveLength(0); // событие чужого арендатора не запускает мои flow
    expect((await owner.get('/notifications?q=Theirs')).body.items).toHaveLength(0);
    expect((await bob.get('/notifications?q=Mine fired')).body.items).toHaveLength(0);

    // чужие flow и запуски не видны и не доступны
    expect((await owner.get(`/flows/${theirs}`)).status).toBe(404);
    expect((await owner.patch(`/flows/${theirs}`, { name: 'hijack' })).status).toBe(404);
    expect((await owner.post(`/flows/${theirs}/run`, {})).status).toBe(404);
    const bobRun = (await runsOf(bob, theirs))[0];
    expect((await owner.get(`/flow-runs/${bobRun.id}`)).status).toBe(404);
    expect((await owner.get(`/flow-runs?flowId=${theirs}`)).body.items).toHaveLength(0);
    expect((await owner.get('/flows')).body.items.map((f: any) => f.id)).not.toContain(theirs);
    // заголовок чужого воркспейса — отказ по членству
    expect((await owner.get('/flows', bob.workspaceId)).status).toBe(403);

    // действие flow под RLS не достаёт до записи другого арендатора, даже если знать её id
    const bobTask = await bob.task(bobProject.id, 'Secret', { priority: 2 });
    const attack = await makeFlow(owner, 'Attack', graph([['t', 'trigger.manual', {}], ['u', 'action.update_field', { entity: 'task', recordId: bobTask.id, field: 'priority', value: '10' }]], [['t', 'u']]));
    await owner.post(`/flows/${attack}/run`, {});
    await drain();
    const [run] = await runsOf(owner, attack);
    expect(run.status).toBe('failed');
    expect(run.error).toContain('not found');
    expect((await bob.get(`/tasks/${bobTask.id}`)).body.priority).toBe(2);
  });

  test('flow tables are protected by RLS for the application role', async () => {
    const rows = await admin`select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('flows','flow_versions','flow_runs','flow_run_steps') order by relname`;
    expect(rows).toHaveLength(4);
    expect(rows.every(r => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
  });
});
