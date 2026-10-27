/* Порты узлов (NodeRuntime) на базе транзакции арендатора: роль app_user + app.workspace_id, RLS включён. */
import type { Db } from '@gr8r/db';
import type { EventVia, FlowContext, HttpRequest, HttpResult, NodeRuntime } from '@gr8r/shared';
import { guardedFetch, type HttpOptions } from './http';
import { addComment, assignLead, createLead, createTask, notifyMember, updateField } from './records';

export interface RuntimeDeps {
  db: Db;
  workspaceId: string;
  nodeId: string;
  ctx: FlowContext;
  via: EventVia;
  /** members.id автора flow: от его имени создаются задачи и комментарии */
  author: string | null;
  http: HttpOptions;
  httpImpl?: (req: HttpRequest) => Promise<HttpResult>;
}

export function makeRuntime(d: RuntimeDeps): NodeRuntime {
  return {
    workspaceId: d.workspaceId,
    nodeId: d.nodeId,
    ctx: d.ctx,
    updateField: a => updateField(d.db, d.workspaceId, d.via, a),
    createTask: a => createTask(d.db, d.workspaceId, d.via, d.author, a),
    addComment: a => addComment(d.db, d.workspaceId, d.via, d.author, a),
    createLead: a => createLead(d.db, d.workspaceId, d.via, a),
    assignLead: a => assignLead(d.db, d.workspaceId, d.via, a),
    notify: a => notifyMember(d.db, d.workspaceId, d.via, a),
    http: req => (d.httpImpl ? d.httpImpl(req) : guardedFetch(req, d.http)),
  };
}
