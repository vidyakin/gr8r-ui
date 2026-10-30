/* Демо-автоматизации: три опубликованные включённые flow. Граф — тот же формат, что строит редактор. */
import type { FlowGraph } from '@gr8r/shared';
import type { Db } from './client';
import { flows, flowVersions } from './schema';

const node = (id: string, type: string, x: number, y: number, params: Record<string, unknown>) => ({ id, type, position: { x, y }, params });
const edge = (source: string, target: string, sourceHandle: string | null = null) => ({ id: `${source}-${target}`, source, target, sourceHandle });

export async function seedFlows(db: Db, wsId: string, createdBy: string | null, kickoffProjectId: string) {
  const defs: { name: string; description: string; graph: FlowGraph; triggerType: string }[] = [
    {
      name: 'Задача на проверке → уведомить руководителя проекта',
      description: 'Когда задача переходит в статус «Review», руководитель её проекта получает уведомление.',
      triggerType: 'trigger.field_changed',
      graph: {
        nodes: [
          node('trigger', 'trigger.field_changed', 0, 80, { entity: 'task', field: 'status', to: 'review' }),
          node('notify', 'action.notify', 320, 80, { recipientId: '{{trigger.project.leadId}}', text: 'перевёл задачу на проверку', snippet: '{{trigger.record.key}} · {{trigger.record.title}}', taskId: '{{trigger.recordId}}' }),
        ],
        edges: [edge('trigger', 'notify')],
      },
    },
    {
      name: 'Сделка выиграна → создать задачу «Старт проекта»',
      description: 'Когда сделка переходит в «Выиграна», в проекте создаётся задача «Старт проекта».',
      triggerType: 'trigger.deal_won',
      graph: {
        nodes: [
          node('trigger', 'trigger.deal_won', 0, 80, {}),
          node('task', 'action.create_task', 320, 80, {
            projectId: kickoffProjectId,
            title: 'Старт проекта',
            description: 'Сделка «{{trigger.record.name}}» выиграна ({{trigger.record.amount}} {{trigger.record.currency}}). Запустите проект.',
            assigneeId: '{{trigger.record.ownerId}}',
            priority: '8',
            status: 'todo',
            dueDate: '',
          }),
        ],
        edges: [edge('trigger', 'task')],
      },
    },
    {
      name: 'Заказ-наряд выполнен → уведомить ответственного',
      description: 'Когда заказ-наряд переходит в состояние «Выполнен», ответственный за него получает уведомление.',
      triggerType: 'trigger.field_changed',
      graph: {
        nodes: [
          node('trigger', 'trigger.field_changed', 0, 80, { entity: 'document', field: 'state', to: 'done' }),
          node('notify', 'action.notify', 320, 80, { recipientId: '{{trigger.record.responsibleId}}', text: 'выполнен заказ-наряд', snippet: '{{trigger.record.number}}' }),
        ],
        edges: [edge('trigger', 'notify')],
      },
    },
    {
      name: 'Ремонт готов → сообщить клиенту',
      description: 'Когда заказ-наряд на ремонт переходит в состояние «Готов», ответственный получает уведомление «сообщить клиенту» (почта и SMS отложены).',
      triggerType: 'trigger.field_changed',
      graph: {
        nodes: [
          node('trigger', 'trigger.field_changed', 0, 80, { entity: 'document', field: 'state', to: 'ready' }),
          node('notify', 'action.notify', 320, 80, { recipientId: '{{trigger.record.responsibleId}}', text: 'ремонт готов: сообщите клиенту', snippet: '{{trigger.record.number}}' }),
        ],
        edges: [edge('trigger', 'notify')],
      },
    },
  ];
  for (const d of defs) {
    const [f] = await db
      .insert(flows)
      .values({ workspaceId: wsId, name: d.name, description: d.description, graph: d.graph, enabled: true, versionCounter: 1, publishedVersion: 1, publishedAt: new Date(), createdBy })
      .returning({ id: flows.id });
    await db.insert(flowVersions).values({ workspaceId: wsId, flowId: f!.id, version: 1, graph: d.graph, triggerType: d.triggerType, publishedBy: createdBy });
  }
  return defs.length;
}
