/* Константы, общие для API, БД и фронтенда. */

/** Набор статусов по умолчанию (колонки доски); новые воркспейсы получают его при создании */
export const STATUSES = [
  { id: 'backlog', name: 'Backlog' },
  { id: 'todo', name: 'To Do' },
  { id: 'progress', name: 'In Progress' },
  { id: 'review', name: 'Review' },
  { id: 'done', name: 'Done' },
] as const;

/** Приоритет — шкала 1–10 (10 — самый срочный) */
export const PRIORITIES: number[] = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

/** Роли воркспейса по убыванию прав */
export const ROLES = ['owner', 'admin', 'member', 'guest'] as const;
export type Role = (typeof ROLES)[number];

export const PROJECT_STATUSES = ['planning', 'active', 'risk', 'hold', 'complete'] as const;
export const PROJECT_COLORS = ['indigo', 'blue', 'violet', 'teal', 'rose', 'amber', 'green', 'slate'] as const;
export const MEMBER_STATUSES = ['active', 'invited', 'deactivated'] as const;
export const NOTIFICATION_TYPES = ['mention', 'assign', 'comment', 'update'] as const;
export const VIEW_TYPES = ['list', 'board', 'table', 'calendar', 'timeline'] as const;
export const FILE_KINDS = ['fig', 'pdf', 'zip', 'img', 'sheet', 'doc', 'code', 'other'] as const;
export const DEAL_STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] as const;
export const CRM_ACTIVITY_TYPES = ['call', 'email', 'meeting', 'note', 'task'] as const;

/** Системные сущности конструктора: у их таблиц есть колонка custom jsonb. Регистрируются в entities при создании воркспейса */
export const SYSTEM_ENTITIES = [
  { key: 'task', name: 'Tasks', icon: 'list-checks', titleField: 'title' },
  { key: 'project', name: 'Projects', icon: 'folder-kanban', titleField: 'name' },
  { key: 'deal', name: 'Deals', icon: 'handshake', titleField: 'name' },
  { key: 'company', name: 'Companies', icon: 'building-2', titleField: 'name' },
  { key: 'contact', name: 'Contacts', icon: 'contact-round', titleField: 'name' },
] as const;
export type SystemEntityKey = (typeof SYSTEM_ENTITIES)[number]['key'];
