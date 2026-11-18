/* Порты узлов (NodeRuntime) на базе транзакции арендатора: роль app_user + app.workspace_id, RLS включён. */
import { queueAutomationEmail, readSecret, type Db } from '@erp/db';
import { TELEGRAM_TOKEN_SECRET, telegramSendMessage, type EventVia, FlowContext, HttpRequest, HttpResult, NodeRuntime } from '@erp/shared';
import { guardedFetch, type HttpOptions } from './http';
import { addComment, assignLead, createLead, createTask, moveDealAction, notifyMember, submitApproval, updateField } from './records';

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
  /** Подмена fetch для Telegram (тесты) */
  telegramFetch?: typeof fetch;
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
    submitApproval: a => submitApproval(d.db, d.workspaceId, d.author, a),
    moveDeal: a => moveDealAction(d.db, d.workspaceId, d.via, a),
    notify: a => notifyMember(d.db, d.workspaceId, d.via, a),
    telegramSend: async a => {
      const token = await readSecret(d.db, d.workspaceId, TELEGRAM_TOKEN_SECRET);
      if (!token) throw new Error('Telegram bot token is not set: add the secret telegram.bot_token in Settings → Integrations');
      return telegramSendMessage(token, a, { fetch: d.telegramFetch, timeoutMs: d.http.timeoutMs });
    },
    sendEmail: a => queueAutomationEmail(d.db, d.workspaceId, d.via, a),
    http: req => (d.httpImpl ? d.httpImpl(req) : guardedFetch(req, d.http)),
  };
}
