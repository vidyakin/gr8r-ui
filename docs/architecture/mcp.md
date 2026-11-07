# MCP-сервер для агентов (задача 1286, сессия TaskFlow 59)

Агент (Claude, Cursor, любой MCP-клиент) подключается к `POST /mcp` (снаружи — `https://<хост>/api/mcp`) по токену
доступа из «Настройки → Доступ для агентов» (`docs/architecture/agent-tokens.md`). Сервер даёт инструменты **на чтение**;
запись черновиков — задача 1287.

## Транспорт
- `@modelcontextprotocol/sdk` (1.32+): `McpServer` + `WebStandardStreamableHTTPServerTransport` — работает на `Request`/
  `Response`, то есть прямо в Hono. Режим без сессий (`sessionIdGenerator: undefined`) и `enableJsonResponse: true`:
  на каждый HTTP-запрос — новый сервер и транспорт, состояние между запросами не хранится.
- `POST /mcp` — JSON-RPC (`initialize`, `tools/list`, `tools/call`, `ping`, уведомления). `GET /mcp` и `DELETE /mcp` — 405
  (поток событий сервера не нужен).
- Код — `apps/api/src/mcp/` (`server.ts` — сборка сервера и маршрут, `tools.ts` — инструменты, `call.ts` — внутренний вызов API).
  Маршрут подключается в `createApp` до `.route('/', tenantApi)`.

## Вход
- Только `Authorization: Bearer gr8r_…`. Cookie не принимается (401 `token_required`): MCP — только для токенов.
- `requireSession` пускает токен на `/mcp` (наряду с `TENANT_PATHS` и `GET /auth/me`).
- Воркспейс — воркспейс токена; заголовок `X-Workspace-Id` не обязателен, а если передан и не совпадает — 403 `token_forbidden`.

## Права: инструмент = внутренний вызов API
Инструменты **не ходят в БД сами**. Каждый вызов инструмента делает один или несколько внутренних GET-запросов в то же
приложение (`app.request(path, { headers: { authorization, 'x-workspace-id': token.workspaceId } })`) с исходным заголовком
`Authorization`. Поэтому на каждом вызове действуют все проверки обычного запроса: `requireSession` (токен не отозван и не
истёк), транзакция `tenant()` под `app_user` с RLS, модуль лицензии, должности (`requireSection`), разделы токена
(`TOKEN_PATH_SECTIONS`), роль, `maskCost`. Новых правил доступа MCP не вводит.

Ответ внутреннего API с ошибкой (403, 404, 422) становится результатом инструмента с `isError: true` и текстом
`<code>: <message>` — агент видит, что раздел ему закрыт, а не пустой список.

## Инструменты (только чтение)
Имена — латиницей snake_case. Описание каждого инструмента и его параметров — на двух языках: сначала английский, затем
русский (`"Search … / Поиск …"`). Параметры — zod-схемы.

| Инструмент | Что делает | Внутренние вызовы |
|---|---|---|
| `search` | Поиск по строке во всех основных сущностях | параллельно `GET /<путь>?q=&limit=5` по видам из `ENTITY_KINDS`; закрытые токену виды молча пропускаются; результат — группы `{ kind, items: [{ id, title }] }` |
| `get_entity` | Карточка записи по виду и id | `GET /<путь>/:id` |
| `list_entities` | Список записей вида с поиском, сортировкой, страницами и фильтрами | `GET /<путь>?q&sort&limit&offset&archived&<filters>` |
| `list_documents` | Документы с фильтрами: тип, группа, статус, контрагент, организация, склад, сделка, договор, период | `GET /documents` (`documentQuery`) |
| `get_document` | Документ со строками | `GET /documents/:id` |
| `stock_balances` | Остатки товаров по складам | `GET /stock/balances` (`stockBalanceQuery`) |
| `list_tasks` | Задачи: проект, исполнитель, статус, поиск | `GET /tasks` |
| `run_report` | Ключевые отчёты по имени из списка | см. ниже |
| `whoami` | От чьего имени работает агент: сотрудник, роль, воркспейс, права токена | `GET /auth/me` + данные токена |

`ENTITY_KINDS` — словарь «вид → корневой путь и поле заголовка» в `apps/api/src/mcp/kinds.ts`: `company` (`/companies`),
`contact`, `product`, `deal`, `lead`, `project`, `task`, `document`, `payment`, `warehouse`, `organization`, `contract`,
`work_order`, `production_order`, `object`, `crm_activity`. Путь каждого вида обязан быть в `TENANT_PATHS` — тест проверяет.

`run_report` — `report` из перечня: `cash_flow` (`/payments/reports/cash-flow`), `receivables`, `payables`
(`/payments/reports/…`), `deal_funnel` (`/deal-funnel`), `sales_plan` (`/sales-plan`), `payment_calendar`
(`/payment-calendar`), `production_release` (`/production/reports/release` — проверить фактический путь), `service_states`.
Параметры отчёта — `params` (объект строк) передаются в query как есть; проверку делает zod-схема маршрута, ошибка 400
возвращается агенту текстом.

Добавить инструмент — функция в `tools.ts` поверх `callApi(path, query)`; новых проверок прав не писать.

## Лимиты ответа
- `limit` в списках — по умолчанию 20, максимум 100 (меньше, чем у интерфейса).
- Результат инструмента — JSON-текст (`content: [{ type: 'text', text }]`). Текст длиннее `MCP_MAX_CHARS` (60 000 символов)
  обрезается: у массивов отбрасываются хвостовые элементы, в ответ добавляется `truncated: true` и подсказка уточнить фильтр
  или взять следующую страницу (`offset`).
- Вложения, печатные формы и PDF через MCP не отдаются.

## Журнал
Каждый `tools/call` пишется в лог запросов API (`requestLogger`) как обычный запрос; внутренние вызовы тоже. Событий в
`events` чтение не создаёт.

## Подключение
Адрес: `https://<хост>/api/mcp` (в разработке `http://localhost:3000/mcp`). Заголовок `Authorization: Bearer <токен>`.

Claude Code:
```bash
claude mcp add --transport http gr8r https://<хост>/api/mcp --header "Authorization: Bearer gr8r_…"
```

Cursor (`~/.cursor/mcp.json` или `.cursor/mcp.json` проекта):
```json
{ "mcpServers": { "gr8r": { "url": "https://<хост>/api/mcp", "headers": { "Authorization": "Bearer gr8r_…" } } } }
```

Claude Desktop (через `mcp-remote`, `claude_desktop_config.json`):
```json
{ "mcpServers": { "gr8r": { "command": "npx", "args": ["mcp-remote", "https://<хост>/api/mcp", "--header", "Authorization: Bearer gr8r_…"] } } }
```

Интерфейс: в окне с выпущенным токеном («Доступ для агентов») — кроме примера заголовков, адрес MCP и готовая команда
для Claude Code (адрес строится из `window.location.origin` + `/api/mcp`).

## Тесты
`apps/api/test/mcp.test.ts`: `initialize` и `tools/list` по токену; без токена и по cookie — 401; `search` токеном с
разделом CRM находит контрагента и не содержит документов; `list_documents` тем же токеном — `isError` с
`token_section_forbidden`; `get_entity` чужого id — `isError` (404); обрезка длинного ответа; все пути `ENTITY_KINDS` есть в
`TENANT_PATHS`.

## Фактическая реализация
Соответствует контракту. Уточнения:
- Код — `apps/api/src/mcp/{server,tools,call,kinds}.ts`; маршрут `/mcp` подключён в `createApp` после `/hooks`, ссылка на
  приложение для внутренних вызовов передаётся функцией (`mcpRoutes(() => self)`).
- Без Bearer (в том числе с одной cookie) — 401 `token_required` до `requireSession`.
- `run_report`: `cash_flow`, `receivables`, `payables` (`/payments/reports/…`), `deal_funnel` (`/deal-funnel`), `sales_plan`
  (`/sales-plan/analysis` — у `/sales-plan` нет корневого GET), `payment_calendar` (`/payment-calendar`), `production_release`
  (`/production/reports/release`), `service_states` (`/services/reports/states`).
- `search` по умолчанию ищет в видах `company, contact, product, deal, lead, project, task, document, contract, object` (5
  записей на вид, параметр `kinds` сужает); заголовок записи — первое непустое из поля вида, `name`, `title`, `number`,
  `subject`, `key`.
- `whoami` возвращает `GET /auth/me` и ограничения токена (`readOnly`, `sections`, `canPost`).
- Тесты — `apps/api/test/mcp.test.ts` (12).
