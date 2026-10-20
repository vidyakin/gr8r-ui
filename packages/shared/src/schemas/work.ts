/* zod-схемы сущностей этапа 1: работа. Поля называются как колонки drizzle-схемы (camelCase). */
import { z } from 'zod';
import { FILE_KINDS, MEMBER_STATUSES, NOTIFICATION_TYPES, PROJECT_COLORS, PROJECT_STATUSES, VIEW_TYPES } from '../constants';
import { clientId, color, decimal, toPatch, hhmm, isoDate, listQuery, queryBool, shortText, uuid } from './common';

/* ---------- projects ---------- */
const milestone = z.object({ name: z.string().min(1).max(200), date: isoDate });
const projectMemberInput = z.object({ memberId: uuid, permission: z.string().min(1).max(32).default('edit') });

export const projectCreate = z.object({
  id: clientId,
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,9}$/, 'Key: 2-10 chars, letters and digits, starts with a letter'),
  name: shortText,
  icon: z.string().max(64).default('folder'),
  color: z.enum(PROJECT_COLORS).default('indigo'),
  status: z.enum(PROJECT_STATUSES).default('planning'),
  teamId: uuid.nullish(),
  leadId: uuid.nullish(),
  startDate: isoDate.nullish(),
  dueDate: isoDate.nullish(),
  fav: z.boolean().default(false),
  isPrivate: z.boolean().default(false),
  access: z.enum(['private', 'workspace']).default('workspace'),
  description: z.string().max(10_000).default(''),
  milestones: z.array(milestone).max(100).default([]),
  sortOrder: z.number().int().optional(),
  /** Участники и права (заменяют текущий список целиком) */
  members: z.array(projectMemberInput).max(500).optional(),
});
export const projectUpdate = toPatch(projectCreate.omit({ key: true, id: true }));
export const projectQuery = listQuery.extend({
  status: z.enum(PROJECT_STATUSES).optional(),
  teamId: uuid.optional(),
  leadId: uuid.optional(),
  fav: queryBool.optional(),
});

/* ---------- statuses ---------- */
export const statusCreate = z.object({
  id: clientId,
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_-]{0,31}$/, 'Key: lowercase letters, digits, dash and underscore'),
  name: shortText,
  color: color.default('var(--blue)'),
  sortOrder: z.number().int().optional(),
});
export const statusUpdate = toPatch(statusCreate.omit({ key: true, id: true }));
export const statusQuery = listQuery;

/* ---------- tasks ---------- */
const subtaskSchema: z.ZodType<import('../domain').Subtask> = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(64),
    title: z.string().max(500),
    done: z.boolean(),
    assignee: uuid.nullish(),
    due: isoDate.nullish(),
    note: z.string().max(10_000).optional(),
    planHours: z.number().nonnegative().nullish(),
    subtasks: z.array(subtaskSchema),
  }),
);

export const taskCreate = z.object({
  id: clientId,
  projectId: uuid,
  /** Только при повторном создании (Undo удаления): прежний ключ WEB-109 вместо нового номера */
  key: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{1,9}-\d{1,9}$/).optional(),
  title: z.string().trim().min(1).max(500),
  status: z.string().min(1).max(32).default('todo'),
  assigneeId: uuid.nullish(),
  priority: z.number().int().min(1).max(10).nullish(),
  dueDate: isoDate.nullish(),
  startDate: isoDate.nullish(),
  labels: z.array(z.string().min(1).max(32)).max(50).default([]),
  subtasks: z.array(subtaskSchema).max(1000).default([]),
  deps: z.array(uuid).max(200).default([]),
  description: z.string().max(100_000).default(''),
  planHours: decimal.nullish(),
  sortOrder: z.number().optional(),
  fav: z.boolean().default(false),
  recur: z.string().max(64).nullish(),
});
export const taskUpdate = toPatch(taskCreate.omit({ id: true, key: true }));
export const taskQuery = listQuery.extend({
  projectId: uuid.optional(),
  status: z.string().max(32).optional(),
  assigneeId: z.union([uuid, z.literal('none')]).optional(),
  priority: z.coerce.number().int().min(1).max(10).optional(),
  label: z.string().max(32).optional(),
  dueFrom: isoDate.optional(),
  dueTo: isoDate.optional(),
  fav: queryBool.optional(),
});

/* ---------- comments ---------- */
export const commentCreate = z.object({ id: clientId, taskId: uuid, body: z.string().trim().min(1).max(20_000) });
export const commentUpdate = z.object({ body: z.string().trim().min(1).max(20_000) });
export const commentQuery = listQuery.extend({ taskId: uuid.optional(), authorId: uuid.optional() });
export const reactionBody = z.object({ emoji: z.string().min(1).max(16) });

/* ---------- time logs ---------- */
export const timeLogCreate = z.object({
  id: clientId,
  taskId: uuid,
  subId: z.string().max(64).nullish(),
  /** По умолчанию — текущий участник; указывать другого может только admin */
  memberId: uuid.optional(),
  hours: decimal.refine(v => Number(v) > 0 && Number(v) <= 24, 'Hours must be between 0 and 24'),
  logDate: isoDate,
  note: z.string().max(2000).default(''),
});
export const timeLogUpdate = toPatch(timeLogCreate.omit({ id: true, memberId: true }));
export const timeLogQuery = listQuery.extend({ taskId: uuid.optional(), memberId: uuid.optional(), from: isoDate.optional(), to: isoDate.optional() });

/* ---------- notifications ---------- */
export const notificationUpdate = z.object({ read: z.boolean() });
export const notificationQuery = listQuery.extend({ read: queryBool.optional(), type: z.enum(NOTIFICATION_TYPES).optional() });

/* ---------- members / teams ---------- */
export const memberUpdate = z.object({
  name: shortText.optional(),
  title: z.string().max(200).optional(),
  color: color.optional(),
  teamId: uuid.nullish(),
  tz: z.string().max(100).optional(),
  status: z.enum(MEMBER_STATUSES).optional(),
});
export const memberQuery = listQuery.extend({ teamId: uuid.optional(), status: z.enum(MEMBER_STATUSES).optional(), role: z.enum(['owner', 'admin', 'member', 'guest']).optional() });

export const teamCreate = z.object({
  id: clientId,
  key: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  name: shortText,
  icon: z.string().max(64).default('users'),
  color: color.default('#5A67D8'),
  description: z.string().max(2000).default(''),
  sortOrder: z.number().int().optional(),
});
export const teamUpdate = toPatch(teamCreate.omit({ key: true, id: true }));
export const teamQuery = listQuery;

/* ---------- saved views, calendar events, files ---------- */
export const savedViewCreate = z.object({
  id: clientId,
  projectId: uuid,
  name: shortText,
  type: z.enum(VIEW_TYPES),
  filters: z.array(z.object({ f: z.enum(['status', 'assignee', 'priority', 'due', 'project']), v: z.array(z.string()) })).max(50).default([]),
});
export const savedViewUpdate = toPatch(savedViewCreate.omit({ projectId: true, id: true }));
export const savedViewQuery = listQuery.extend({ projectId: uuid.optional() });

export const calendarEventCreate = z.object({ id: clientId, projectId: uuid.nullish(), title: shortText, eventDate: isoDate, eventTime: hhmm.default('09:00') });
export const calendarEventUpdate = toPatch(calendarEventCreate.omit({ id: true }));
export const calendarEventQuery = listQuery.extend({ projectId: uuid.optional(), from: isoDate.optional(), to: isoDate.optional() });

export const fileCreate = z.object({
  id: clientId,
  projectId: uuid.nullish(),
  taskId: uuid.nullish(),
  name: shortText,
  kind: z.enum(FILE_KINDS).default('other'),
  mime: z.string().max(200).nullish(),
  sizeBytes: z.number().int().nonnegative().default(0),
  storageKey: z.string().max(500).nullish(),
});
export const fileUpdate = toPatch(fileCreate.pick({ name: true, kind: true }));
export const fileQuery = listQuery.extend({ projectId: uuid.optional(), taskId: uuid.optional() });

export const activityQuery = listQuery.extend({ projectId: uuid.optional(), taskId: uuid.optional(), actorId: uuid.optional() });
