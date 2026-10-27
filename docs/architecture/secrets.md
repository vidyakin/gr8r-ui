# Хранилище секретов (задача 1174а)

Код: `packages/db/src/secrets.ts`, `packages/db/src/schema/secrets.ts`, `packages/shared/src/schemas/secrets.ts`, `apps/api/src/routes/secrets.ts`, `apps/web/src/app/settings/integrations.tsx`.

## Данные (миграция 0040)
- `workspace_secrets (workspace_id, key, ciphertext, created_by, created_at, updated_at)`, ключ `(workspace_id, key)`, RLS (`app_secure_tenant_table`).
- `key` — имя секрета: `^[a-z][a-z0-9._-]{0,63}$` (`SECRET_KEY_RE`), например `yookassa.api_key`.
- `created_by` — `members.id` без FK (удаление участника не должно трогать запись).

## Шифрование
- AES-256-GCM, ключ `SECRETS_KEY` из окружения: 32 байта (64 hex-символа или base64). Генерация: `openssl rand -hex 32`.
- Формат `ciphertext`: `v1:` + base64(iv 12 байт ‖ tag 16 байт ‖ шифртекст). AAD = `workspaceId:key`: строку нельзя перенести в другой воркспейс или под другое имя.
- Нет ключа или он неверной длины — 422 `secrets_unavailable` (запись и чтение), `GET /secrets` отдаёт `available: false`, интерфейс показывает предупреждение.
- Ключ не расшифровывает (сменили `SECRETS_KEY`) — 422 `secret_corrupted`. Смена ключа с перешифровкой пока не сделана: старые секреты надо ввести заново.

## Доступ
- `readSecret(db, workspaceId, key)` — единственный путь к открытому значению, только для воркера и серверного кода (внутри `withContext`, роль `app_worker` или `app_user`); `null`, если секрета нет.
  Результат нельзя класть в ответы API, события, журналы шагов автоматизаций и сообщения ошибок.
- API (`/secrets`, все маршруты admin и owner): `GET` — `{ available, items: [{ key, updatedAt, createdBy }] }`; `PUT /secrets/:key {value}` — создать или заменить; `DELETE /secrets/:key`. Значение и шифртекст не возвращаются.
- События `secret.updated` / `secret.deleted` (entity `secret`) несут только имя секрета; фронтенд по ним обновляет список.

## Интерфейс
Настройки → Интеграции (`integrations`): список имён с датой обновления, добавление, замена, удаление; значение вводится в поле пароля и больше не показывается. Не-admin видит пояснение.

## Дальше
Потребители секретов — подключения банков и ЮКассы (1174д, `payments.md`, «Интеграции»; части ключа `<префикс>.<часть>`, ввод на том же экране) и отложенные почта/SMS (задача 1092, этап 6 услуг). Подстановка секрета в параметры HTTP-узла автоматизаций (вместо заголовка `Authorization` в параметрах flow) не сделана.
