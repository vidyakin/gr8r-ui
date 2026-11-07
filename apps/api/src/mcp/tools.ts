/* Инструменты MCP на чтение (docs/architecture/mcp.md). Каждый — поверх внутреннего GET в API (call.ts):
   права, RLS, разделы токена и должности проверяет обычная цепочка маршрута. Описания — английский / русский. */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DOCUMENT_GROUPS, DOCUMENT_STATUSES, DOCUMENT_TYPES } from '@gr8r/shared';
import { z } from 'zod';
import type { CallResult, WriteMethod } from './call';
import { ENTITY_KIND_NAMES, ENTITY_KINDS, REPORT_NAMES, REPORTS, type EntityKindName } from './kinds';

/** Предел текста результата инструмента, символов */
export const MCP_MAX_CHARS = 60_000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
/** Виды, по которым ищет search */
const SEARCH_KINDS: EntityKindName[] = ['company', 'contact', 'product', 'deal', 'lead', 'project', 'task', 'document', 'contract', 'object'];

export type ApiCaller = (path: string, query?: Record<string, string | number | undefined>) => Promise<CallResult>;
/** Запись: POST/PATCH в тот же маршрут API, права проверяет сам маршрут */
export type ApiSender = (method: WriteMethod, path: string, body: unknown) => Promise<CallResult>;
export interface ToolContext {
  call: ApiCaller;
  send: ApiSender;
  token: { id: string; workspaceId: string; memberId: string; readOnly: boolean; sections: string[] | null; canPost: boolean };
}

const limitArg = z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Page size, default ${DEFAULT_LIMIT}, max ${MAX_LIMIT} / Размер страницы`);
const offsetArg = z.number().int().min(0).optional().describe('Rows to skip / Сколько строк пропустить');
const uuidArg = (what: string) => z.string().uuid().describe(what);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Десятичное число строкой, как в схемах @gr8r/shared: "2.5" */
const decimalArg = z.union([z.string().regex(/^-?\d+(\.\d+)?$/), z.number().finite()]);
/** Типы документов, которые агент создаёт черновиком через MCP (остальные — в своих разделах) */
const MCP_DOCUMENT_TYPES = ['quote', 'customer_order', 'invoice', 'supplier_order', 'receipt'] as const;

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

/** Одновременных внутренних запросов инструмента — не больше четырёх: пул соединений API общий, а пачка из десяти
    видов занимала его целиком и запросы ждали друг друга (docs/architecture/mcp.md, «Лимиты ответа»). */
const TOOL_CONCURRENCY = 4;
const inChunks = async <T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += TOOL_CONCURRENCY) out.push(...(await Promise.all(items.slice(i, i + TOOL_CONCURRENCY).map(fn))));
  return out;
};

export function registerTools(server: McpServer, ctx: ToolContext) {
  const { call, send } = ctx;
  const ro = { readOnlyHint: true, openWorldHint: false } as const;
  /** Аннотация записи: destructiveHint — только у действия, меняющего остатки и статусы необратимо */
  const rw = (destructive: boolean) => ({ readOnlyHint: false, destructiveHint: destructive, idempotentHint: false, openWorldHint: false }) as const;

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
      const groups = await inChunks(list, async kind => {
        const k = ENTITY_KINDS[kind];
        const r = await call(k.path, { q: query, limit: limit ?? 5 });
        if (!r.ok) return null;
        const items = ((r.data as { items?: Record<string, unknown>[] } | null)?.items ?? []).map(row => ({ id: row.id, title: titleOf(row, k.title) }));
        return items.length ? { kind, items } : null;
      });
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

  /* ---------- запись (задача 1287, docs/architecture/mcp.md, «Запись») ----------
     Инструменты записи регистрируются только токену не только для чтения: у read_only их нет в tools/list.
     Каждый вызов — обычный POST/PATCH маршрута API: роль, разделы токена, модуль и can_post проверяет сам маршрут. */
  if (!ctx.token.readOnly) {
    server.registerTool(
      'create_task',
      {
        description:
          'Create a task in a project (title, description, assignee, status, priority, due date) / Создать задачу в проекте (название, описание, исполнитель, статус, приоритет, срок)',
        inputSchema: {
          projectId: uuidArg('Project id / Id проекта'),
          title: z.string().trim().min(1).max(500).describe('Task title / Название задачи'),
          description: z.string().max(100_000).optional().describe('Description (plain text or safe HTML) / Описание'),
          assigneeId: uuidArg('Assignee member id / Id исполнителя').nullish(),
          status: z.string().min(1).max(32).optional().describe('Status key, default todo / Статус, по умолчанию todo'),
          priority: z.number().int().min(1).max(10).nullish().describe('Priority 1–10 / Приоритет'),
          dueDate: isoDate.nullish().describe('Due date, YYYY-MM-DD / Срок'),
        },
        annotations: rw(false),
      },
      async ({ projectId, title, description, assigneeId, status, priority, dueDate }) =>
        answer(await send('POST', '/tasks', { projectId, title, description, assigneeId, status, priority, dueDate })),
    );

    server.registerTool(
      'update_task',
      {
        description: 'Update a task: title, status, assignee, priority or due date / Изменить задачу: название, статус, исполнитель, приоритет или срок',
        inputSchema: {
          id: uuidArg('Task id / Id задачи'),
          title: z.string().trim().min(1).max(500).optional().describe('New title / Новое название'),
          status: z.string().min(1).max(32).optional().describe('Status key / Статус'),
          assigneeId: uuidArg('Assignee member id, null to clear / Id исполнителя, null — снять').nullish(),
          priority: z.number().int().min(1).max(10).nullish().describe('Priority 1–10, null to clear / Приоритет, null — снять'),
          dueDate: isoDate.nullish().describe('Due date, YYYY-MM-DD, null to clear / Срок, null — снять'),
        },
        annotations: rw(false),
      },
      async ({ id, title, status, assigneeId, priority, dueDate }) =>
        answer(await send('PATCH', `/tasks/${id}`, { title, status, assigneeId, priority, dueDate })),
    );

    server.registerTool(
      'add_comment',
      {
        description: 'Add a comment to a task / Добавить комментарий к задаче',
        inputSchema: {
          taskId: uuidArg('Task id / Id задачи'),
          body: z.string().trim().min(1).max(20_000).describe('Comment text / Текст комментария'),
        },
        annotations: rw(false),
      },
      async ({ taskId, body }) => answer(await send('POST', '/comments', { taskId, body })),
    );

    server.registerTool(
      'create_deal',
      {
        description:
          'Create a deal in CRM (name, company, amount, pipeline and stage, close date) / Создать сделку в CRM (название, контрагент, сумма, воронка и этап, дата закрытия)',
        inputSchema: {
          name: z.string().trim().min(1).max(200).describe('Deal name / Название сделки'),
          companyId: uuidArg('Company (counterparty) id / Id контрагента').nullish(),
          amount: decimalArg.optional().describe('Amount as a decimal string, e.g. "1500.00" / Сумма строкой'),
          currency: z.string().length(3).optional().describe('Currency code (ISO 4217), default USD / Код валюты'),
          pipelineId: uuidArg('Pipeline id, default is the main pipeline / Id воронки').nullish(),
          stageId: uuidArg('Stage id, default is the first stage / Id этапа').nullish(),
          closeDate: isoDate.nullish().describe('Expected close date, YYYY-MM-DD / Ожидаемая дата закрытия'),
        },
        annotations: rw(false),
      },
      async ({ name, companyId, amount, currency, pipelineId, stageId, closeDate }) =>
        answer(await send('POST', '/deals', { name, companyId, amount, currency, pipelineId, stageId, closeDate })),
    );

    server.registerTool(
      'update_deal',
      {
        description: 'Update a deal: name, amount, stage or close date / Изменить сделку: название, сумма, этап или дата закрытия',
        inputSchema: {
          id: uuidArg('Deal id / Id сделки'),
          name: z.string().trim().min(1).max(200).optional().describe('New name / Новое название'),
          amount: decimalArg.optional().describe('Amount as a decimal string / Сумма строкой'),
          stageId: uuidArg('Stage id / Id этапа').nullish(),
          closeDate: isoDate.nullish().describe('Expected close date, YYYY-MM-DD / Ожидаемая дата закрытия'),
        },
        annotations: rw(false),
      },
      async ({ id, name, amount, stageId, closeDate }) => answer(await send('PATCH', `/deals/${id}`, { name, amount, stageId, closeDate })),
    );

    server.registerTool(
      'create_lead',
      {
        description: 'Create a lead (name, company name, phone, email, comment, source) / Создать лид (название, компания, телефон, email, комментарий, источник)',
        inputSchema: {
          name: z.string().trim().min(1).max(200).describe('Lead name / Название лида'),
          companyName: z.string().trim().max(200).optional().describe('Company name / Название компании'),
          phone: z.string().trim().max(50).optional().describe('Phone / Телефон'),
          email: z.string().trim().max(254).optional().describe('Email / Электронная почта'),
          comment: z.string().max(5000).optional().describe('Comment / Комментарий'),
          source: z.string().trim().max(200).optional().describe('Source name (found or created in the dictionary) / Источник по названию'),
        },
        annotations: rw(false),
      },
      async ({ name, companyName, phone, email, comment, source }) =>
        answer(await send('POST', '/leads', { name, companyName, phone, email, comment, source })),
    );

    server.registerTool(
      'create_document',
      {
        description:
          'Create a draft document (quote, customer order, invoice, supplier order or receipt) with optional lines; it stays a draft until posted / Создать черновик документа (КП, заказ покупателя, счёт, заказ поставщику или приход) со строками; до проведения он остаётся черновиком',
        inputSchema: {
          type: z.enum(MCP_DOCUMENT_TYPES).describe('Document type / Тип документа'),
          counterpartyId: uuidArg('Counterparty (company) id / Id контрагента').nullish(),
          organizationId: uuidArg('Own organization id, default is the main one / Id своей организации').nullish(),
          warehouseId: uuidArg('Warehouse id / Id склада').nullish(),
          dealId: uuidArg('Deal id the document is made from / Id сделки, из которой создан документ').nullish(),
          date: isoDate.optional().describe('Document date, default today / Дата документа, по умолчанию сегодня'),
          comment: z.string().max(5000).optional().describe('Comment / Комментарий'),
          lines: z
            .array(
              z.object({
                productId: uuidArg('Product id / Id товара'),
                qty: decimalArg.describe('Quantity as a decimal string, e.g. "2.5" / Количество строкой'),
                price: decimalArg.describe('Price as a decimal string, e.g. "1500.00" / Цена строкой'),
              }),
            )
            .max(500)
            .optional()
            .describe('Document lines / Строки документа'),
        },
        annotations: rw(false),
      },
      async ({ type, counterpartyId, organizationId, warehouseId, dealId, date, comment, lines }) =>
        answer(await send('POST', '/documents', { type, counterpartyId, organizationId, warehouseId, dealId, date, comment, lines })),
    );

    // проведение меняет нумерацию, остатки и финансы: только токену с правом «Проводить, оплачивать, удалять» (can_post)
    if (ctx.token.canPost) {
      server.registerTool(
        'post_document',
        {
          description: 'Post a draft document: assign its number and apply stock and finance movements / Провести черновик документа: присвоить номер, изменить остатки и финансы',
          inputSchema: { id: uuidArg('Document id / Id документа') },
          annotations: rw(true),
        },
        async ({ id }) => answer(await send('POST', `/documents/${id}/post`, {})),
      );
    }
  }
}
