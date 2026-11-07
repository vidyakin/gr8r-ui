# Деплой и арендаторы оператора

План и решения интервью — `docs/plans/2026-10-29-tenants-deploy.md`. Пошаговая инструкция для сервера — README, «Деплой».

## Модель
- Арендатор — воркспейс в общей БД, изоляция RLS по `workspace_id` (`tenancy.md`). Отдельных БД на клиента нет.
- **Оператор установки** — пользователь с `users.is_operator`. Флаг выдаёт и снимает только CLI (`bun run tenant operator grant|revoke <email>`).
  API перечитывает флаг на каждый запрос `/admin/*`, поэтому снятие действует сразу.
- `workspaces.kind`: `regular` (клиент) или `demo` (демо-арендатор со сроком `expires_at`). `workspaces.delete_requested_at` — оператор
  запросил удаление: воркспейс сразу пропадает из «моих воркспейсов», воркер удаляет его в течение минуты.
- Сервис — `packages/db/src/tenants.ts`: `createTenant`, `requestTenantDelete`, `deleteTenant`, `purgeTenantsOnce`, `exportTenant`,
  `importTenant`, `listTenants`, `setOperator`. Пустой арендатор создаёт `initWorkspace` (общий с регистрацией и `POST /workspaces`),
  демо — `seedDemoWorkspace` из сида с именем, адресом и владельцем арендатора: аккаунт есть только у владельца, остальные демо-участники —
  профили без входа.

## Кто что делает
| Действие | CLI (`bun run tenant …`) | API `/admin/tenants` (экран «Настройки → Оператор → Арендаторы») |
|---|---|---|
| список | `list` (под `app_worker`) | `GET` — функция `app_operator_tenants()` |
| создать пустого / демо | `create` / `demo --ttl N` | `POST {name, ownerEmail, ownerName?, demo, ttlDays?}` |
| удалить | `delete <id\|адрес>` — сразу | `DELETE /:id` → 202, удаляет воркер |
| выгрузить | `export <id\|адрес> [--out f.jsonl.gz]` | `GET /:id/export` — файл |
| загрузить | `import <файл>` | нет: нужен суперпользователь |
| очистить просроченные демо | `purge` | воркер раз в минуту |

Тариф и пробный период (`licensing.md`): CLI `create/demo … --plan <ключ|id>`, в API `planId`. Без `--plan` арендатор живёт на тарифе по умолчанию; если у выбранного
(или у тарифа по умолчанию) задан `trial_days`, сразу ставятся срок «сегодня + trial_days» и признак пробного периода, в журнал лицензии пишется `trial_started`.
Лицензия самостоятельно зарегистрированных арендаторов (`/auth/signup`, `POST /workspaces`) пробного периода не получает.

Пароль нового владельца генерируется (или задаётся `--password` в CLI) и показывается один раз; в БД — только Argon2id-хэш.
Если пользователь с этим email уже есть, он становится владельцем со своим паролем.

## Заявки арендаторов на модули и `OPERATOR_LEAD_HOOK_URL`
Страница «Нужно больше?» создаёт заявку (`POST /license/requests`, таблица `module_requests`); оператор видит их в «Настройки → Оператор → Заявки на модули».
Если у **воркера** задана `OPERATOR_LEAD_HOOK_URL` (полный адрес `…/hooks/leads/<токен>` формы лидов арендатора оператора, `.env.example`), задача
`module_request.notify` отправляет заявку туда POST-ом JSON (`name`, `company`, `email` или `phone`, `comment`, `utm_source=gr8r-module-request`); не 2xx или сбой сети —
повтор с нарастающей паузой (до 5 попыток), успех отмечается в `module_requests.hook_sent_at`. Переменная передаётся сервису `worker` в `docker-compose.prod.yml` и `docker-compose.coolify.yml`.

## Доступ из API без обхода RLS
- **Список** — единственное чтение через всех арендаторов: `SECURITY DEFINER`-функция `app_operator_tenants()` (миграция `0052`),
  владелец `app_worker` (BYPASSRLS). Функция сама проверяет `is_operator` у `app.user_id` и отдаёт только метаданные (имя, адрес, вид, срок,
  email владельца, число участников). Политик «оператор видит всё» в RLS нет.
- Создание, запрос удаления и выгрузка идут под `app_user` с `app.workspace_id` целевого арендатора: RLS отдаёт ровно его строки.
  Членство в арендаторе оператор не получает — его данных через обычные маршруты он не видит (тест `tenants.test.ts`).
- Удаление целиком — только воркер и CLI: нужен DDL (снять индексы полей конструктора `idx_cf_*`, иначе они переживут арендатора).

## Удаление
`deleteTenant(sql, ddl, id)`: индексы полей с `filterable` → `delete from workspaces` под `app_worker` (все 90+ таблиц арендатора удаляются
каскадом по FK на `workspaces.id`, RESTRICT-ссылок нет; каскад FK идёт мимо RLS) → удаление пользователей, у которых не осталось членств
(`GRANT DELETE ON users TO app_worker`). Пользователь, состоящий ещё где-то, остаётся.

## Выгрузка и загрузка
- Формат — текст: первая строка — заголовок JSON (`format: gr8r-tenant`, `version`, `schema` — тег последней миграции, `workspaceId`, `slug`),
  дальше строки `<таблица>\t<JSON-массив строк>`: `users` (участники арендатора: email, имя, хэш пароля, язык), `workspaces`, затем все таблицы
  с `workspace_id`, кроме очереди `jobs`. Список таблиц берётся из каталога, новые таблицы попадают в выгрузку сами.
- Строки сериализует и разбирает сам Postgres (`to_jsonb` / `jsonb_populate_recordset`): numeric, даты, jsonb и bytea (PDF в `document_files`)
  переносятся без потерь, JS числа не разбирает.
- **Загрузка** — только CLI под `ADMIN_DATABASE_URL`: одна транзакция с `session_replication_role = replica` (порядок таблиц и циклы ссылок не
  важны, триггеры не срабатывают). Отказ, если схема архива не совпадает с установкой или воркспейс с этим id/адресом уже есть.
  Id сохраняются прежние (ссылки на них лежат и внутри jsonb — настройки, flow, представления), поэтому «клонировать с новыми id» нельзя.
  Пользователи сопоставляются по email: существующий — к нему (ссылки `memberships`, `members`, `invites`, `workspaces.created_by`
  переписываются), иначе создаётся с прежним id и хэшем пароля. После загрузки: события помечаются обработанными (автоматизации не
  запустятся повторно), счётчики identity сдвигаются, индексы полей ставятся в очередь воркеру.
- Секреты воркспейса (`workspace_secrets`) зашифрованы `SECRETS_KEY` — в другой установке с другим ключом их придётся ввести заново.
- Архив содержит хэши паролей и все данные клиента — хранить как бэкап.

## Развёртывание (`docker-compose.prod.yml`)
- Сервисы: `postgres` (порт наружу не публикуется), `migrate` (миграции и роли `gr8r_app`/`gr8r_ddl` при каждом `up`, через него же CLI),
  `api`, `worker`, `web` (nginx: статика и прокси `/api` + WebSocket), `caddy` (80/443, Let's Encrypt по `DOMAIN`), `backup` (`pg_dump -Fc` раз в сутки в `./backups`).
- Обязательные переменные (`${VAR:?}` — без них compose не стартует): `DOMAIN`, `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `DDL_DB_PASSWORD`, `SECRETS_KEY`.
  `COOKIE_SECURE=1`, `CORS_ORIGINS=https://$DOMAIN`.
- IP клиента для rate-limit: Caddy не доверяет входящему `X-Forwarded-For` и ставит его сам, nginx дописывает свой адрес, API (`TRUST_PROXY=1`)
  берёт первый — адрес клиента. Проверено на локальном стеке: запрос с подставленным `X-Forwarded-For: 6.6.6.6` попал в `rate_limits` с адресом,
  который видит Caddy, а не с подставленным.
- **Маршрутизация (1213), по желанию:** профиль `routing` поднимает `osrm` и `vroom` (без публикации портов); оператор готовит данные OSRM из `.osm.pbf` и задаёт `ROUTING_OSRM_URL` / `ROUTING_VROOM_URL` в `.env.prod` — воркер доверяет этим адресам (внутренняя сеть compose). Подробности и проверенность — [routing.md](routing.md).
- **Хранилище файлов** (`docs/architecture/attachments.md`): в оба прод-файла добавлены `minio` (порты наружу не публикуются, том `miniodata`) и разовый
  `minio-init` (создаёт бакет `gr8r` / `erp` в Coolify; `mc` входит в образ сервера). Образ — `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z`: на Docker Hub
  `minio/minio` и `minio/mc` больше не публикуются (в том числе в локальном `docker-compose.yml`). Обязательные переменные: `S3_ACCESS_KEY`, `S3_SECRET_KEY`;
  `api` и `worker` получают `S3_*`, `FILE_MAX_BYTES`, `STORAGE_QUOTA_BYTES`. Том `miniodata` в `pg_dump`-бэкап не входит — копировать отдельно
  (`docker run --rm -v <проект>_miniodata:/data -v $PWD/backups:/b alpine tar czf /b/minio.tgz /data`). Для Yandex Object Storage вместо MinIO задайте `S3_ENDPOINT=https://storage.yandexcloud.net`,
  `S3_FORCE_PATH_STYLE=0` и уберите сервисы `minio`/`minio-init`. `nginx` пропускает тело до 55 МБ (`client_max_body_size` на `/api/`). PDF печатных форм по-прежнему в БД (`PDF_STORE=db`).
  Выгрузка арендатора (`tenant export`) не содержит файлов из S3 — их копируют вместе с бакетом (`mc mirror`). Проверено локально: `docker compose config` для всех трёх файлов; `S3FileStore` против настоящего MinIO этого образа; полный стек в compose не поднимался.
- **Coolify** — `docker-compose.coolify.yml`: те же сервисы без `caddy` (80/443 держит прокси Coolify, домен задаётся у сервиса `web`),
  `migrate` помечен `exclude_from_hc` (ключ Coolify: завершившийся контейнер не делает приложение «нездоровым»; обычный
  `docker compose config` на этом ключе падает). CLI — в контейнере `api` (там весь код и `ADMIN_DATABASE_URL`), `./archives` смонтирован в него.
  Цепочка IP: прокси Coolify → nginx → api, `TRUST_PROXY=1`. Что Traefik Coolify не доверяет входящему `X-Forwarded-For` (поведение по
  умолчанию, `forwardedHeaders` без `insecure`), на сервере не проверялось — проверка в README. В Coolify не разворачивался.
- **Заголовки безопасности** — в `docker/nginx.conf` (отдаёт и HSTS: TLS снимает Caddy или прокси Coolify). У приложения CSP: скрипты
  только свои (`script-src 'self'`), стили свои и inline, шрифты Google, картинки `https:`/`data:`/`blob:`, `frame-ancestors 'none'`;
  плюс `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` (камера — сканер бейджей, геолокация — экран водителя).
  У ответов API свой CSP (печатные формы `default-src 'none'`), nginx его не перекрывает. `add_header` в `location` отменяет заголовки
  уровня `server` — набор повторён в каждом `location`. Проверено: прод-сборка веба под этим CSP (вход, главная, карточка задачи, печать
  счёта) — нарушений нет; в nginx-контейнере не поднималось. Окна печати (`blob:`/`document.write` на origin приложения) получают тот же
  запрет скриптов тегом `<meta>` — `apps/web/src/lib/print-csp.ts`, сторож `print-csp-guard.test.ts`.
- **HTML описаний** (описание задачи вставляется как HTML): очистка по белому списку тегов панели форматирования на записи
  (`sanitizeRichText`, `packages/db/src/rich-text.ts` — API и узел «Создать задачу») и DOMPurify перед вставкой в редакторе
  (`cleanRichText`, `task-drawer/pickers.tsx`). Тест — `apps/api/test/security.test.ts`.
- `docker-compose.yml` — для локального запуска всего стека (порты открыты, пароли по умолчанию), на сервер его не ставить.
- Проверено локально (`DOMAIN=localhost`, Docker Desktop): сборка образов, миграции с нуля, вход через Caddy, CLI оператора. На реальном VPS с
  настоящим доменом не проверялось.

Тесты: `apps/api/test/tenants.test.ts` — пустой и демо-арендатор, два демо подряд, удаление без следов (все таблицы, пользователь, индексы
полей) и без изменения соседей (отпечаток md5 всех таблиц), выгрузка → удаление → загрузка с совпадением отпечатка, сопоставление
владельца по email, очистка просроченных демо и запросов удаления, доступ к `/admin/tenants`.
