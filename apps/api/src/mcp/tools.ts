/* Инструменты MCP на чтение (docs/architecture/mcp.md). Каждый — поверх внутреннего GET в API (call.ts):
   права, RLS, разделы токена и должности проверяет обычная цепочка маршрута. Описания — английский / русский. */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DOCUMENT_GROUPS, DOCUMENT_STATUSES, DOCUMENT_TYPES } from '@gr8r/shared';
import { z } from 'zod';
import type { CallResult } from './call';
import { ENTITY_KIND_NAMES, ENTITY_KINDS, REPORT_NAMES, REPORTS, type EntityKindName } from './kinds';

/** Предел текста результата инструмента, символов */
export const MCP_MAX_CHARS = 60_000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
/** Виды, по которым ищет search */
const SEARCH_KINDS: EntityKindName[] = ['company', 'contact', 'product', 'deal', 'lead', 'project', 'task', 'document', 'contract', 'object'];

export type ApiCaller = (path: string, query?: Record<string, string | number | undefined>) => Promise<CallResult>;
export interface ToolContext {
  call: ApiCaller;
  token: { id: string; workspaceId: string; memberId: string; readOnly: boolean; sections: string[] | null; canPost: boolean };
}

const limitArg = z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Page size, default ${DEFAULT_LIMIT}, max ${MAX_LIMIT} / Размер страницы`);
const offsetArg = z.number().int().min(0).optional().describe('Rows to skip / Сколько строк пропустить');
const uuidArg = (what: string) => z.string().uuid().describe(what);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** JSON-текст результата с обрезкой длинных списков */
export function toText(data: unknown, max = MCP_MAX_CHARS): string {
  let text = JSON.stringify(data);
  if (text.length <= max) return text;
  const hint = 'Response truncated: narrow the filter or request the next page (offset) / Ответ обрезан: уточните фильтр или возьмите следующую страницу';
  const shrink = (arr: unknown[], wrap: (a: unknown[]) => unknown) => {
    let n = arr.length;
    while (n > 0) {
      n = Math.floor(n * 0.7);
      const t = JSON.stringify(wrap(arr.slice(0, n)));
      if (t.length <= max) return t;
    }
    return null;
  };
  if (Array.isArray(data)) {
    const t = shrink(data, a => ({ items: a, truncated: true, hint }));
    if (t) return t;
  } else if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const key = Object.keys(obj).find(k => Array.isArray(obj[k]));
    if (key) {
      const t = shrink(obj[key] as unknown[], a => ({ ...obj, [key]: a, truncated: true, hint }));
      if (t) return t;
    }
  }
  return JSON.stringify({ truncated: true, hint, text: text.slice(0, max - 400) });
}

const ok = (data: unknown): CallToolResult => ({ content: [{ type: 'text', text: toText(data) }] });
const fail = (r: Extract<CallResult, { ok: false }>): CallToolResult => ({ content: [{ type: 'text', text: `${r.code}: ${r.message}` }], isError: true });
const answer = (r: CallResult): CallToolResult => (r.ok ? ok(r.data) : fail(r));

/** Заголовок записи для выдачи search */
function titleOf(row: Record<string, unknown>, field: string): string {
  for (const k of [field, 'name', 'title', 'number', 'subject', 'key']) {
    const v = row[k];
    if (typeof v === 'string' && v) return v;
  }
  return String(row.id ?? '');
}

const page = (limit?: number, offset?: number) => ({ limit: limit ?? DEFAULT_LIMIT, offset: offset ?? 0 });

export function registerTools(server: McpServer, ctx: ToolContext) {
  const { call } = ctx;
  const ro = { readOnlyHint: true, openWorldHint: false } as const;

  server.registerTool(
    'whoami',
    {
      description: 'Who the agent acts as: employee, role, workspace and token restrictions / От чьего имени работает агент: сотрудник, роль, воркспейс и ограничения токена',
      annotations: ro,
    },
    async () => {
      const me = await call('/auth/me');
      if (!me.ok) return fail(me);
      const { id, ...token } = ctx.token;
      return ok({ me: me.data, token: { id, ...token } });
    },
  );

  server.registerTool(
    'search',
    {
      description:
        'Search by text across main entities (companies, contacts, products, deals, leads, projects, tasks, documents, contracts, objects); kinds closed to the token are skipped / Поиск по строке во всех основных сущностях; закрытые токену виды пропускаются',
      inputSchema: {
        query: z.string().trim().min(1).max(200).describe('Text to find / Что искать'),
        kinds: z.array(z.enum(ENTITY_KIND_NAMES)).optional().describe('Limit to these kinds / Искать только в этих видах'),
        limit: z.number().int().min(1).max(20).optional().describe('Items per kind, default 5 / Записей на вид'),
      },
      annotations: ro,
    },
    async ({ query, kinds, limit }) => {
      const list = kinds?.length ? kinds : SEARCH_KINDS;
      const groups = await Promise.all(
        list.map(async kind => {
          const k = ENTITY_KINDS[kind];
          const r = await call(k.path, { q: query, limit: limit ?? 5 });
          if (!r.ok) return null;
          const items = ((r.data as { items?: Record<string, unknown>[] } | null)?.items ?? []).map(row => ({ id: row.id, title: titleOf(row, k.title) }));
          return items.length ? { kind, items } : null;
        }),
      );
      return ok({ groups: groups.filter(Boolean) });
    },
  );

  server.registerTool(
    'get_entity',
    {
      description: 'Get one record by kind and id / Карточка записи по виду и id',
      inputSchema: { kind: z.enum(ENTITY_KIND_NAMES).describe('Entity kind / Вид записи'), id: uuidArg('Record id / Id записи') },
      annotations: ro,
    },
    async ({ kind, id }) => answer(await call(`${ENTITY_KINDS[kind].path}/${id}`)),
  );

  server.registerTool(
    'list_entities',
    {
      description:
        'List records of a kind with search, sorting, paging and extra filters (passed to the API as query parameters) / Список записей вида: поиск, сортировка, страницы и дополнительные фильтры (уходят в API как параметры запроса)',
      inputSchema: {
        kind: z.enum(ENTITY_KIND_NAMES).describe('Entity kind / Вид записи'),
        query: z.string().trim().max(200).optional().describe('Text search / Поиск по строке'),
        sort: z.string().max(64).optional().describe('Sort field, "-" prefix for descending, e.g. -createdAt / Поле сортировки, "-" — по убыванию'),
        archived: z.enum(['exclude', 'include', 'only']).optional().describe('Archived records / Архивные записи'),
        filters: z.record(z.string(), z.string()).optional().describe('Extra filters, e.g. {"companyId": "..."} / Дополнительные фильтры'),
        limit: limitArg,
        offset: offsetArg,
      },
      annotations: ro,
    },
    async ({ kind, query, sort, archived, filters, limit, offset }) =>
      answer(await call(ENTITY_KINDS[kind].path, { ...filters, q: query, sort, archived, ...page(limit, offset) })),
  );

  server.registerTool(
    'list_documents',
    {
      description:
        'List documents (orders, invoices, receipts, payments, production…) with filters by type, group, status, counterparty, organization, warehouse, deal, contract and period / Документы с фильтрами: тип, группа, статус, контрагент, организация, склад, сделка, договор, период',
      inputSchema: {
        type: z.array(z.enum(DOCUMENT_TYPES)).optional().describe('Document types / Типы документов'),
        group: z.enum(DOCUMENT_GROUPS).optional().describe('Document group / Группа документов'),
        status: z.array(z.enum(DOCUMENT_STATUSES)).optional().describe('Statuses / Статусы'),
        counterpartyId: uuidArg('Counterparty (company) id / Контрагент').optional(),
        organizationId: uuidArg('Own organization id / Организация').optional(),
        warehouseId: uuidArg('Warehouse id / Склад').optional(),
        dealId: uuidArg('Deal id / Сделка').optional(),
        contractId: uuidArg('Contract id / Договор').optional(),
        from: isoDate.optional().describe('Date from, YYYY-MM-DD / Дата с'),
        to: isoDate.optional().describe('Date to, YYYY-MM-DD / Дата по'),
        query: z.string().trim().max(200).optional().describe('Text search / Поиск по строке'),
        sort: z.string().max(64).optional().describe('Sort field / Поле сортировки'),
        limit: limitArg,
        offset: offsetArg,
      },
      annotations: ro,
    },
    async ({ type, status, query, limit, offset, ...rest }) =>
      answer(await call('/documents', { ...rest, type: type?.join(','), status: status?.join(','), q: query, ...page(limit, offset) })),
  );

  server.registerTool(
    'get_document',
    {
      description: 'Get a document with its lines / Документ со строками',
      inputSchema: { id: uuidArg('Document id / Id документа') },
      annotations: ro,
    },
    async ({ id }) => answer(await call(`/documents/${id}`)),
  );

  server.registerTool(
    'stock_balances',
    {
      description: 'Stock balances of products by warehouse / Остатки товаров по складам',
      inputSchema: {
        warehouseId: uuidArg('Warehouse id / Склад').optional(),
        productId: uuidArg('Product id / Товар').optional(),
        query: z.string().trim().max(200).optional().describe('Product search / Поиск товара'),
        nonZero: z.boolean().optional().describe('Hide zero balances / Скрыть нулевые остатки'),
        limit: limitArg,
        offset: offsetArg,
      },
      annotations: ro,
    },
    async ({ query, nonZero, limit, offset, ...rest }) =>
      answer(await call('/stock/balances', { ...rest, q: query, nonZero: nonZero === undefined ? undefined : String(nonZero), ...page(limit, offset) })),
  );

  server.registerTool(
    'list_tasks',
    {
      description: 'List tasks with filters by project, assignee, status, priority and due date / Задачи: проект, исполнитель, статус, приоритет, срок',
      inputSchema: {
        projectId: uuidArg('Project id / Проект').optional(),
        assigneeId: z.string().optional().describe('Assignee member id or "none" / Исполнитель или "none"'),
        status: z.string().max(32).optional().describe('Status key / Статус'),
        priority: z.number().int().min(1).max(10).optional().describe('Priority / Приоритет'),
        dueFrom: isoDate.optional().describe('Due from / Срок с'),
        dueTo: isoDate.optional().describe('Due to / Срок по'),
        query: z.string().trim().max(200).optional().describe('Text search / Поиск по строке'),
        sort: z.string().max(64).optional().describe('Sort field / Поле сортировки'),
        limit: limitArg,
        offset: offsetArg,
      },
      annotations: ro,
    },
    async ({ query, limit, offset, ...rest }) => answer(await call('/tasks', { ...rest, q: query, ...page(limit, offset) })),
  );

  server.registerTool(
    'run_report',
    {
      description: `Run a key report by name (${REPORT_NAMES.join(', ')}); params go to the report as query parameters / Ключевой отчёт по имени; params уходят в отчёт параметрами запроса`,
      inputSchema: {
        report: z.enum(REPORT_NAMES).describe('Report name / Отчёт'),
        params: z.record(z.string(), z.string()).optional().describe('Report parameters, e.g. {"from": "2026-01-01"} / Параметры отчёта'),
      },
      annotations: ro,
    },
    async ({ report, params }) => answer(await call(REPORTS[report], params ?? {})),
  );
}
