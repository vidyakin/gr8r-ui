# Обращения клиентов

Решения и план — `docs/plans/2026-11-19-cases.md`. Поддержка и сервис: письма, форма сайта и ручной ввод; сроки SLA по приоритету; заказ-наряд из обращения.
Код: `packages/db/src/schema/cases.ts` (миграция `0129_cases.sql`), сервис `packages/db/src/cases.ts`, приём почты `email-sync.ts` (`routeToCase`),
ответ `email.ts` (`replyToCase`, `queueEmail` с `caseId`), чистые правила `packages/shared/src/cases.ts`, схемы `schemas/cases.ts`,
API `apps/api/src/routes/cases.ts` и `routes/hooks.ts` (`POST /hooks/cases/:token`), проход SLA `apps/worker/src/case-sla.ts`,
узлы `trigger-case-*.ts`, интерфейс `apps/web/src/app/cases/`, `settings/cases.tsx`.

## Данные (миграция 0129)
Все таблицы под RLS (`app_secure_tenant_table`), ссылки составные.
- `cases` — номер `ОБ-<год>-NNNNN` (уникален в воркспейсе), тема, описание, статус, приоритет, канал, клиент (`company_id`, `contact_id`, `lead_id`), ответственный,
  сделка, заказ-наряд (`work_order_id`), ящик, форма, сроки (`first_response_due_at`, `resolve_due_at`), факты (`first_responded_at`, `resolved_at`, `closed_at`),
  отметки нарушений (`first_response_breached_at`, `resolve_breached_at`), `custom` (системная сущность конструктора `case`).
- `case_counters` (воркспейс, год) — счётчик номеров в транзакции создания: откат не оставляет пропуска. `case_assign_cursor` — курсор «по кругу».
- `case_sla_rules` (воркспейс, приоритет) — часы; нет строки — значение по умолчанию (`DEFAULT_CASE_SLA`: urgent 1/8, high 4/24, normal 8/72, low 24/168).
  `GET /case-sla-rules` отдаёт все четыре приоритета, `PUT` (admin) записывает их разом.
- `case_forms` — форма сайта: секрет `token`, ответственный по умолчанию, `enabled`.
- Привязки: `email_messages.case_id`, `crm_activities.case_id` (каскадом), `documents.case_id` (заказ-наряд из обращения), `mailboxes.create_cases_from_mail` и `case_owner_id`.

## Статусы
`new → in_progress → waiting → resolved → closed`. Первый исходящий ответ (письмо из обращения, или касание «звонок/письмо» с `response: true`, созданное сотрудником)
ставит `first_responded_at` и переводит `new` в `in_progress` (`markFirstResponse`; письма автоматизаций не считаются). `waiting` задаёт сотрудник вручную; входящий ответ клиента
возвращает `waiting` в `in_progress`. `resolved` ставит `resolved_at`; ответ клиента в течение 7 дней (`CASE_REOPEN_DAYS`) возвращает обращение в `in_progress`, позже —
создаёт новое обращение (с системной заметкой «Follows case …»). `closed` — финал: правка и письма запрещены (409 `case_closed`), касания допускаются только заметками,
ответ клиента создаёт новое обращение. Смена статуса и приоритета из автоматизации («Изменить поле» с сущностью `case`) идёт через `updateCase`, а не прямой записью.

## SLA
Сроки считаются календарными часами от `created_at` по правилу приоритета. Смена приоритета пересчитывает оба срока от создания; если новый срок в будущем,
отметка нарушения сбрасывается (событие можно объявить снова). Метка в интерфейсе — `caseSlaState` (общий код): красная — срок нарушен, жёлтая — осталось меньше 20 %,
показывается срок первого ответа, пока ответа нет, затем срок решения. Паузы по статусу `waiting` нет.
Проход `runCaseSlaOnce` раз в минуту (`apps/worker/src/index.ts`) по воркспейсам с модулем `crm`, под `app_user` с `app.workspace_id`: просроченные открытые обращения
(`new | in_progress | waiting`) получают отметку `*_breached_at`, событие `case.sla_breached` (`payload.kind`: `first_response` | `resolve`) и уведомление ответственному.
Отметка и событие пишутся в одной транзакции, выборка — `FOR UPDATE SKIP LOCKED`: повтор прохода ничего не создаёт.

## Приём из почты
Флажок ящика `create_cases_from_mail` (любой ящик с IMAP, не только общий). В `syncMailbox` после сопоставления с CRM (`matchIncoming`) письмо маршрутизируется (`routeToCase`):
1. In-Reply-To/References → письмо с `case_id` (любое направление); 2. номер `[ОБ-…]` в теме; найденное обращение: `applyClientReply` (waiting → in_progress; resolved ≤ 7 дней → открыто снова;
   закрыто или решено давно → новое обращение); 3. иначе — новое обращение (тема, текст, клиент из сопоставления, `mailbox_id`, ответственный — `case_owner_id` ящика, иначе по кругу).
Письма с адреса самого ящика и `mailer-daemon@` / `postmaster@` обращений не создают. Защита от дублей — прежняя (UID, Message-ID): повторная синхронизация обращение не плодит.
Новое обращение уведомляет ответственного при создании; ответ в существующее — уведомлением «Получено письмо» ответственному обращения. Событие `email.received` несёт `caseId`,
а `trigger.email_received` берёт обращение контекстной записью (раньше лида/контакта).
Исходящее письмо с `caseId` (`POST /cases/:id/reply` или `POST /emails`) получает в тему `[ОБ-…]`, привязку к обращению и его клиенту; `inReplyTo` — последнее входящее письмо обращения.

## Форма сайта
`POST /hooks/cases/:token` — как формы лидов (`leads.md`): токен `<workspace_id>.<секрет>`, любая ошибка токена — 404, лимит частоты `case-hook:ip:` / `case-hook:form:`,
CORS любых сайтов, тело ≤ 32 КБ (JSON или form). Поля `name`, `email`, `phone`, `company`, `subject`, `message`, `priority`; нужны тема или сообщение и имя, email или телефон. Поле-ловушка `case_forms.honeypot_field` — как у форм лидов (`leads.md`).
Клиент — контакт по email/телефону, затем лид, иначе создаётся лид (источник — название формы). Ответственный: форма → по кругу.

## Распределение
Ответственный: явный → по умолчанию (ящик, форма) → по кругу среди активных участников с функцией `support_agent` (`positions.md`; если такой должности нет, подходят все).

## Заказ-наряд
`POST /cases/:id/work-order` (`createWorkOrderFromCase`): документ `work_order` с контрагентом обращения и комментарием «номер: тема + описание», `documents.case_id` и `cases.work_order_id`.
422 `case_company_required` — нет контрагента, 409 `case_work_order_exists` — уже создан.

## API
`/cases` (список: `status`, `open`, `priority`, `ownerId`, `channel`, `companyId`, `contactId`, `overdue`, `q`), `/cases/summary` (счётчики), `GET/PATCH /cases/:id` (с письмами и касаниями),
`POST /cases/:id/work-order`, `POST /cases/:id/reply`, `/case-sla-rules`, `/case-forms` (+ `POST /:id/rotate`; запись и токен — admin), `GET /crm-activities?caseId=`,
`POST /crm-activities {caseId, response?}`. Корневые пути входят в раздел `crm` (`SECTION_OF_API_PATH`) и в модуль `crm` (лицензирование). События `case.*`, `case_form.*`
(клиент обновляет по ним ключ кэша `['ws', id, 'cases', …]`, `app/data/realtime.ts`).

## Автоматизации
Триггеры `trigger.case_created`, `trigger.case_status_changed` (необязательный статус), `trigger.case_sla_breached` (необязательный срок); сущность `case` — для «Запись создана/изменена»
и «Изменить поле» (поля: тема, описание, статус, приоритет, ответственный). Все узлы входят в модуль `crm`.

## Интерфейс
CRM → «Обращения» (`/crm/cases`, `/crm/cases/:id`): таблица и доска, счётчики, метка SLA, фильтры; карточка `CaseCard`; вкладка «Обращения» у контрагента и контакта; «Настройки» → «Обращения»
(сроки, формы), флажок и ответственный в настройках ящика. Тексты — `cases.*`.

## Тесты
`apps/api/test/cases.test.ts` (создание, номера, SLA, приём из почты на подставном IMAP, форма сайта, автоматизации через `processEventsOnce`, заказ-наряд, права, RLS),
`packages/shared/test/cases.test.ts`.

## Фактическая реализация
См. раздел «Фактическая реализация» в `docs/plans/2026-11-19-cases.md`.
