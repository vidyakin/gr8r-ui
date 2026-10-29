/* Реестр узлов. Новый узел = новый файл в этой папке (описание + схема параметров + исполнитель) и одна строка ниже. */
import type { AnyNodeDef } from '../types';
import addComment from './action-add-comment';
import assignLead from './action-assign-lead';
import createLead from './action-create-lead';
import createTask from './action-create-task';
import moveDeal from './action-move-deal';
import httpRequest from './action-http-request';
import notify from './action-notify';
import updateField from './action-update-field';
import branch from './flow-branch';
import delay from './flow-delay';
import condition from './logic-condition';
import fieldChanged from './trigger-field-changed';
import documentPaid from './trigger-document-paid';
import dealLost from './trigger-deal-lost';
import dealStageChanged from './trigger-deal-stage-changed';
import dealStageOverdue from './trigger-deal-stage-overdue';
import dealWon from './trigger-deal-won';
import leadCreated from './trigger-lead-created';
import leadStatusChanged from './trigger-lead-status-changed';
import manual from './trigger-manual';
import paymentPosted from './trigger-payment-posted';
import recordCreated from './trigger-record-created';
import recordUpdated from './trigger-record-updated';
import schedule from './trigger-schedule';

export const NODE_LIST: AnyNodeDef[] = [
  // Триггеры
  recordCreated,
  recordUpdated,
  fieldChanged,
  schedule,
  manual,
  paymentPosted,
  documentPaid,
  leadCreated,
  leadStatusChanged,
  dealStageChanged,
  dealWon,
  dealLost,
  dealStageOverdue,
  // Условия и управление потоком
  condition,
  delay,
  branch,
  // Действия
  updateField,
  createTask,
  notify,
  httpRequest,
  addComment,
  createLead,
  assignLead,
  moveDeal,
];

export const NODE_DEFS: Record<string, AnyNodeDef> = Object.fromEntries(NODE_LIST.map(n => [n.type, n]));
if (Object.keys(NODE_DEFS).length !== NODE_LIST.length) throw new Error('Duplicate node type in the registry');
