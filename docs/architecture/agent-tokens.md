# Токены доступа агентов (задача 1285, сессия TaskFlow 59)

Агент (MCP-клиент, скрипт, внешний ИИ) работает **от имени сотрудника**: токен выпускается на участника воркспейса и
может только **сузить** его права — роль, должности (`requireSection`), RLS и `maskCost` действуют как у самого сотрудника.
Для агента без человека — служебный сотрудник со своей ролью и должностями.

## Данные (миграция 0105)
`api_tokens` (RLS `app_secure_tenant_table`, ссылки составные `(workspace_id, id)`):
- `id`, `workspace_id`, `member_id` → members (чей токен), `created_by` → members, `name` (до 120 символов);
- `token_hash text unique` — sha256 (hex) полного токена; сам токен не хранится;
- `prefix text` — первые 12 символов токена для показа в списке (`gr8r_ab12cd3`);
- `read_only bool not null default true`;
- `sections text[]` — `null` = все разделы сотрудника; иначе подмножество `POSITION_SECTIONS`;
- `can_post bool not null default false` — право проводить, оплачивать, удалять (используется инструментами MCP, задача 1287);
- `expires_at timestamptz null`, `last_used_at timestamptz null`, `revoked_at timestamptz null`, `created_at`.

`events.api_token_id uuid null` (без FK) с `default nullif(current_setting('app.api_token_id', true), '')::uuid` — событие,
записанное запросом по токену, помечено им без правки мест вызова `recordEvent`. `setContext` выставляет `app.api_token_id`.

Служебный сотрудник: `users.is_service bool not null default false`; у такого пользователя `password_hash` — заведомо
непроверяемая строка (`!service`), вход по паролю для него запрещён явно (`/auth/login` → 401, как неверный пароль).

Поиск токена в `requireSession` идёт без арендатора, а таблица под RLS — функция `app_api_token_lookup(hash text)`
(SECURITY DEFINER, владелец `app_worker`, как `app_workspace_license`): возвращает `id, workspace_id, member_id, user_id,
read_only, sections, can_post` для неотозванного и неистёкшего токена и обновляет `last_used_at` не чаще раза в минуту.

## Формат токена
`gr8r_` + 32 случайных байта base64url (`crypto.getRandomValues`). Показывается один раз в ответе на создание.

## Проверка запроса (apps/api)
1. `requireSession`: заголовок `Authorization: Bearer gr8r_…` → `app_api_token_lookup(sha256)`; нет строки → 401
   `token_invalid`. Иначе `c.set('user', …)` (пользователь участника) и `c.set('apiToken', { id, workspaceId, memberId,
   readOnly, sections, canPost })`. Cookie и Bearer вместе — приоритет у Bearer.
2. По токену доступны только пути `TENANT_PATHS` и `GET /auth/me`. Всё остальное (`/auth/*`, `/workspaces/*`, приглашения,
   `/api-tokens`) → 403 `token_forbidden`: токен не выпускает токены и не меняет учётные данные.
3. `tenant()`: заголовок `X-Workspace-Id` обязан совпасть с воркспейсом токена, участник — с `member_id` токена,
   иначе 403 `token_forbidden`. Выставляет `app.api_token_id`.
4. `read_only` → любой метод кроме GET/HEAD/OPTIONS → 403 `token_read_only`.
5. Разделы токена: `TOKEN_PATH_SECTIONS` (`@gr8r/shared`) — **каждый** корень `TENANT_PATHS` либо сопоставлен списку
   разделов, либо внесён в `TOKEN_OPEN_PATHS` (участники, уведомления, справочники единиц и т. п.). Тест проверяет полноту.
   Путь с разделами пропускается, если пересечение с `sections` токена не пусто (`/documents` → trade, stock, finance,
   services, production…). Иначе 403 `token_section_forbidden`. В отличие от `SECTION_OF_API_PATH` (должности, только пути
   одного раздела) здесь закрыты и общие пути: интерфейс токеном не пользуется.
6. Должности сотрудника (`requireSection`) и роль действуют как обычно — токен не может дать больше, чем есть у сотрудника.

## API `/api-tokens` (только по cookie)
- `GET /api-tokens` — admin/owner: все токены воркспейса; остальные — свои. Элемент: `id, name, prefix, memberId,
  memberName, readOnly, sections, canPost, expiresAt, lastUsedAt, revokedAt, createdAt` (без хэша).
- `POST /api-tokens` `{ name, memberId?, readOnly, sections?: PositionSection[] | null, canPost, expiresAt?: string | null }`
  → 201 `{ token, item }`. `memberId` не свой — только admin/owner (403). guest — только `readOnly: true` (422
  `token_guest_write`). `sections` должен быть подмножеством видимых разделов сотрудника (422 `token_sections_exceed`).
  `canPost` при `readOnly` — 422 `token_can_post_read_only`. `expiresAt` в прошлом — 422.
- `DELETE /api-tokens/:id` — отзыв (`revoked_at = now()`), свой или любой для admin/owner. Повторный — 200.
- `POST /api-tokens/service-members` (admin/owner) `{ name, role: 'member' | 'guest', positionIds?: string[] }` → 201
  `{ memberId }`: пользователь `is_service`, email `agent-<uuid>@agents.invalid`, участник с ролью и должностями.
- Все изменения пишут события `api_token.created` / `api_token.revoked` / `member.created` (realtime: `api_token`).

## Интерфейс
Настройки → «Доступ для агентов» (`settings/agent-access.tsx`, пункт в `settings/nav.ts`, группа workspace).
- Таблица токенов: название, сотрудник, права (чтение / запись / проводить), разделы, срок, последнее использование, статус;
  кнопка «Отозвать» с подтверждением.
- «Выпустить токен» — диалог: название; сотрудник (admin/owner — список участников, включая служебных; остальные — только
  себя); «Только чтение»; «Проводить, оплачивать, удалять» (недоступно при «только чтение»); разделы (флажки, пусто — все
  разделы сотрудника); срок (`DateInput`, необязательно).
- После создания — окно с токеном один раз: поле только для чтения, «Копировать», предупреждение, что токен больше не
  покажется; пример подключения `Authorization: Bearer <токен>` и `X-Workspace-Id: <id воркспейса>`.
- admin/owner: «Добавить служебного сотрудника» — имя, роль, должности.

Ошибки `token_*` — в `apps/web/src/i18n/{en,ru}/errors.ts`.
