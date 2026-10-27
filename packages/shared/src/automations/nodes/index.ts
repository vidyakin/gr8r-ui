/* Реестр узлов. Новый узел = новый файл в этой папке (описание + схема параметров + исполнитель) и одна строка ниже. */
import type { AnyNodeDef } from '../types';
import addComment from './action-add-comment';
import assignLead from './action-assign-lead';
import createLead from './action-create-lead';
import createTask from './action-create-task';
import httpRequest from './action-http-request';
import notify from './action-notify';
import updateField from './action-update-field';
import branch from './flow-branch';
import delay from './flow-delay';
import condition from './logic-condition';
import fieldChanged from './trigger-field-changed';
import leadCreated from './trigger-lead-created';
import leadStatusChanged from './trigger-lead-status-changed';
import manual from './trigger-manual';
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
  leadCreated,
  leadStatusChanged,
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
];

export const NODE_DEFS: Record<string, AnyNodeDef> = Object.fromEntries(NODE_LIST.map(n => [n.type, n]));
if (Object.keys(NODE_DEFS).length !== NODE_LIST.length) throw new Error('Duplicate node type in the registry');
