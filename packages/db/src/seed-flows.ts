/* Демо-автоматизации: три опубликованные включённые flow. Граф — тот же формат, что строит редактор. */
import type { FlowGraph } from '@gr8r/shared';
import type { Db } from './client';
import { flows, flowVersions } from './schema';

const node = (id: string, type: string, x: number, y: number, params: Record<string, unknown>) => ({ id, type, position: { x, y }, params });
const edge = (source: string, target: string, sourceHandle: string | null = null) => ({ id: `${source}-${target}`, source, target, sourceHandle });

export async function seedFlows(db: Db, wsId: string, createdBy: string | null, kickoffProjectId: string) {
  const defs: { name: string; description: string; graph: FlowGraph; triggerType: string }[] = [
    {
      name: 'Task moved to Review → notify the project lead',
      description: 'When a task changes status to Review, the lead of its project gets a notification.',
      triggerType: 'trigger.field_changed',
      graph: {
        nodes: [
          node('trigger', 'trigger.field_changed', 0, 80, { entity: 'task', field: 'status', to: 'review' }),
          node('notify', 'action.notify', 320, 80, { recipientId: '{{trigger.project.leadId}}', text: 'moved a task to Review', snippet: '{{trigger.record.key}} · {{trigger.record.title}}', taskId: '{{trigger.recordId}}' }),
        ],
        edges: [edge('trigger', 'notify')],
      },
    },
    {
      name: 'Deal won → create a Kickoff task',
      description: 'When a deal moves to Won, a “Kickoff” task is created in the project.',
      triggerType: 'trigger.field_changed',
      graph: {
        nodes: [
          node('trigger', 'trigger.field_changed', 0, 80, { entity: 'deal', field: 'stage', to: 'won' }),
          node('task', 'action.create_task', 320, 80, {
            projectId: kickoffProjectId,
            title: 'Kickoff',
            description: 'Deal “{{trigger.record.name}}” was won ({{trigger.record.amount}} {{trigger.record.currency}}). Start the project.',
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
      name: 'Work order done → notify the responsible',
      description: 'When a work order reaches the Done state, the person responsible for it gets a notification.',
      triggerType: 'trigger.field_changed',
      graph: {
        nodes: [
          node('trigger', 'trigger.field_changed', 0, 80, { entity: 'document', field: 'state', to: 'done' }),
          node('notify', 'action.notify', 320, 80, { recipientId: '{{trigger.record.responsibleId}}', text: 'completed a work order', snippet: '{{trigger.record.number}}' }),
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
