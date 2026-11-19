# Почта: отправка и входящие (задача 1092, инкременты А и Б)

Решения и план — `docs/plans/2026-11-19-email.md`. Входящие синхронизируются из INBOX через imapflow; MIME разбирается mailparser.
Код: `packages/db/src/email.ts` (ящики, очередь), `email-send.ts` (отправка), `email-transport.ts` (nodemailer, SSRF), `schema/email.ts`;
`packages/shared/src/email.ts`, `schemas/email.ts`, узел `automations/nodes/action-email-send.ts`; `apps/api/src/routes/email.ts`;
задача `email.send` — `apps/worker/src/handlers.ts`; интерфейс — `apps/web/src/app/email/`, `settings/mail.tsx`.

## Данные (миграция 0127)
- `mailboxes`: общий (`kind=shared`, `member_id` пуст, один на воркспейс — частичный уникальный индекс) или личный (один на участника).
  SMTP и IMAP-поля, подпись, статус проверки (`ok|error|unchecked`). Пароль — секрет `mailbox.<id>.password` (`secrets.md`), в таблице и ответах его нет (`hasPassword`).
- `email_messages`: исходящее письмо со статусом `queued → sending → sent | failed` (`received` — для Б), адреса `to`/`cc`, `message_id` (генерируем сами,
  `<uuid@домен ящика>`), `attempts`, `last_error`, привязки `lead_id/contact_id/company_id/deal_id/document_id`, `attachment_ids` (существующие вложения),
  `print_form`/`print_template_id` (PDF документа). `mailbox_id` при удалении ящика обнуляется (история остаётся).
- `crm_activities.email_message_id`: касание типа `email` создаётся вместе с письмом, если есть привязка к лиду, контакту, контрагенту (для документа — контрагент документа) или сделке.

## Права
Общий ящик создаёт и правит admin+, личный — только владелец (чужой личный ящик не виден даже admin: 404). Отправка — member+ (гость 403).
`GET /emails` без фильтра — свои письма (admin — все), с фильтром по записи — вся переписка записи.

## Выбор ящика
`pickMailbox`: явный `mailboxId` (общий или свой личный; чужой личный — 404) → иначе личный ящик автора → иначе общий → иначе 422 `mailbox_required`.
Автоматизация (`queueAutomationEmail`): `mailbox=owner` — личный ящик ответственного, при его отсутствии общий; `mailbox=shared` — общий.
При постановке в очередь проверяются пароль ящика (422 `mailbox_password_missing`), получатели, вложения (права как у объекта, сумма ≤ 20 МБ),
печатная форма документа и суточный лимит воркспейса (`EMAIL_DAILY_LIMIT`, по умолчанию 500, 422 `email_limit_reached`).

## Отправка и повторы
`POST /emails` в одной транзакции пишет письмо, касание, задачу `email.send` (`max_attempts=5`) и события `email.queued` / `crm_activity.created`.
`sendQueuedEmail` в три шага: (1) под RLS — `sending`, чтение ящика, пароля, вложений и PDF формы (`renderDocumentHtml` + Chromium воркера);
(2) SMTP вне транзакции; (3) под RLS — итог. Классификация ошибок (`classifyMailError`): сеть, таймаут, SMTP 4xx — временные;
`EAUTH`/5xx/сбор вложения — окончательные. Временная ошибка возвращает письмо в `queued` с `last_error` и бросает исключение после коммита — очередь `jobs`
повторяет с экспоненциальной паузой (`2^n·5` с, до часа), на пятой попытке письмо становится `failed`. Окончательная — сразу `failed`, у `EAUTH` ящик получает статус `error`.
`POST /emails/:id/retry` (автор или admin+) возвращает `failed` в очередь с нуля. Доставка «минимум один раз»: если воркер упал между SMTP и записью `sent`, письмо уйдёт повторно.

## Защита
`emailRuntime`: адрес SMTP/IMAP проверяется как у HTTP-узла (`shared/automations/net.ts`): частные и служебные адреса, `localhost`, `.local` запрещены (при сохранении ящика —
422 `mail_host_forbidden`, при подключении — DNS-проверка и подключение к проверенному IP с TLS-именем сервера); `EMAIL_ALLOW_PRIVATE=1` или `FLOW_HTTP_ALLOW_PRIVATE=1` снимает запрет (тесты, закрытые установки).
Таймауты 10/10/30 с. Пароль маскируется в сообщениях ошибок. `POST /mailboxes/:id/check` проверяет вход по SMTP (`verify`) и полноценный вход IMAP с тем же паролем приложения; результат пишется в ящик.

## События и realtime
`mailbox.created/updated/deleted/checked/synced` (entity `mailbox`), `email.queued/sent/failed/updated/received` (entity `email`): `app/data/realtime.ts` сбрасывает ключи `['ws', id, 'email']` и `'leads'`.

## Тесты
`apps/api/test/email.test.ts` (ящики, права, пароль, RLS, очередь, повторы, касание, PDF, узел), `packages/shared/test/email.test.ts`, `apps/web/src/app/email/EmailStatus.test.tsx`.
SMTP в тестах — подмена `emailRuntime.transportFor` (фейк и stream-транспорт nodemailer), сети нет.

## Входящие (миграция 0128)

`email-sync.ts` экспортирует `syncMailbox`, `parseInboundEmail`; `email-transport.ts` — `openImap` и подменяемый `emailRuntime.imapFor`.
`mailboxes` получает `imap_uid_validity text`, `imap_last_uid bigint` (0) и `create_lead_from_unmatched boolean` (false, только общий ящик).
У входящего `email_messages` сохраняются `imap_uid_validity` и `imap_uid`; уникальный индекс `(workspace_id, mailbox_id, imap_uid_validity, imap_uid)` защищает от повторов.

Планировщик `apps/worker/src/email-sync.ts` раз в три минуты ставит `email.sync` для настроенных IMAP-ящиков. Внутри каждого арендатора,
под `app_user`, блокирует строку ящика и пропускает ожидающую/исполняемую или недавно созданную задачу. Ручной `POST /mailboxes/:id/sync`
доступен member+ для общего и своего личного ящика и использует ту же блокировку и проверку очереди.

Воркер читает ящик и секрет под RLS, затем вне транзакции открывает INBOX read-only. Получает снимок UIDVALIDITY/UIDNEXT и до 100 UID за проход.
При новой UIDVALIDITY чтение начинается с 1, история сохраняется. Письма с уже известным Message-ID того же ящика пропускаются (в том числе после смены UIDVALIDITY);
без Message-ID защита действует только в пределах UIDVALIDITY. После сетевого чтения транзакция блокирует ящик, проверяет неизменность конфигурации и исходного курсора,
создаёт письма/вложения/касания/уведомления/события и двигает курсор атомарно. Устаревший конкурентный снимок отбрасывается.
Неполная пачка по лимиту памяти продвигает курсор только до последнего полученного UID; пустой диапазон — до его верхней границы.

Сопоставление: In-Reply-To → References (от ближайшего предка) → отправленное `sent` письмо с привязками → его связи;
иначе нормализованный адрес → неархивный контакт и его контрагент → неархивный лид. Если совпадений нет и флажок общего ящика включён,
`insertLead` создаёт лид; иначе письмо остаётся без связей. Касание типа email создаётся для связанного письма, направление читается из `email_messages.direction`.
Ответственный лида/контакта/сделки/контрагента (в таком порядке) получает уведомление; иначе — владелец личного ящика.

MIME разбирается `mailparser`, HTML очищается существующим `sanitizeRichText`. Сырой MIME ограничен 30 МиБ; слишком большое письмо сохраняется как
пустое `received` с предупреждением. Сумма принимаемых вложений — 20 МиБ; превышающие лимит пропускаются с предупреждением `last_error`.
Остальные проходят `createInboundAttachment`: `attachments.entity_type=email`, обычные лимиты файла, квота и лицензия, FileStore, автор null.
Ошибка хранилища или квоты откатывает письмо и курсор: задача повторится, осиротевшие объекты убирает существующий GC.

`trigger.email_received` реагирует только на `email.received`, необязательный фильтр mailboxId. `trigger.entity/recordId/record` — связанная CRM-запись,
иначе само письмо; `trigger.email` содержит письмо, в том числе mailboxId, fromEmail и subject. Повтор события защищён существующим `(flow_id,event_id)`.

## Экран и доступ к входящим

`GET /emails?direction=in&unlinked=true` и `GET /emails/:id` показывают только общий и собственный личный ящик, включая запросы с фильтром записи или ids.
Вложения наследуют те же права. `POST /emails/:id/link {contactId|leadId}` (ровно одно поле) проверяет запись под RLS, обновляет связи письма и касания
или создаёт касание, пишет realtime-события. `/email` зарегистрирован в SECTIONS; текст показывается обычным экранированным bodyText, вложения — через AttachmentsPanel readOnly.

Тесты Б: `apps/api/test/email-inbound.test.ts`, `email-sync.test.ts`, `packages/db/test/email-parser.test.ts`,
`packages/shared/test/email-received-node.test.ts`, `apps/web/src/app/email/EmailPage.test.tsx`. IMAP полностью фейковый, внешней сети нет.
