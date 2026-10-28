# packages/shared — общие типы, zod-схемы и чистые расчёты

Используется API, воркером и фронтендом. Правила областей — по оглавлению `docs/architecture.md`.

## Экспорты
- `@gr8r/shared` (`src/index.ts`) — всё, кроме демо.
- `@gr8r/shared/demo` — демо-данные для локального режима фронтенда и сида БД.

## Структура `src/`
- `schemas/*.ts` — zod-схемы запросов и ответов API по областям.
- `domain.ts`, `constants.ts` — типы и константы (роли, статусы, приоритеты 1–10, ставки НДС, единицы ОКЕИ), подписи `*_LABELS`.
- `decimal.ts` — десятичная арифметика на BigInt (масштаб 10⁻⁶): деньги и количества.
- `documents.ts` — `computeDocument`, `DOCUMENT_META`: суммы, НДС, итоги. Ту же функцию вызывают сервер при проведении и форма в интерфейсе.
- `bom.ts`, `parameters.ts`, `expr.ts` — спецификации, параметры, безопасный вычислитель выражений без eval (`docs/architecture/production-parametric.md`).
- `planning.ts`, `replenishment.ts`, `supply.ts`, `cost-closing.ts`, `billing.ts` — чистые расчёты планирования, пополнения, закрытия месяца, биллинга.
- `fields.ts` — типы полей конструктора и `buildRecordSchema` (`docs/architecture/metadata.md`).
- `automations/` — типы, граф, cron, шаблоны `{{…}}`, проверки сети (SSRF); `automations/nodes/` — реестр узлов, один файл на узел.
- `print/` — печатные формы (счёт, УПД, акт, ТОРГ-12, спецификация), `ru.ts` — ИНН, сумма прописью.
- `i18n.ts` — список языков (`LOCALES`). Сами переводы — во фронтенде.
- `demo/` — демо-данные, по-русски.

## Куда класть новое
- Схема API — `schemas/<область>.ts`; расчёт, который нужен и серверу, и интерфейсу, — отдельный модуль здесь, без БД.
- Узел автоматизации — `automations/nodes/<вид>-<имя>.ts` + строка в `nodes/index.ts` (README, «Автоматизации»).

## Правила
- Зависимости: `zod` и `qrcode-generator` (чистый JS без своих зависимостей — QR-код в печатных формах, `src/qr.ts`). Не импортировать `@gr8r/db`, `@gr8r/api`, React и Node-API: модуль работает и в браузере.
- Деньги и количества — строки + `decimal.ts`, без `Number`/float.
- Подписи для интерфейса — ключи словаря `enums.*` во фронтенде (`apps/web/src/i18n`); `*_LABELS` остаются английскими по умолчанию.
- Печатные формы и демо-данные — по-русски, без перевода.

## Команды
- Typecheck: `bun run --filter @gr8r/shared typecheck`.
- Тесты из корня: `bun test packages/shared/test/<файл>.test.ts` (БД не нужна, но preload из `bunfig.toml` всё равно ждёт Postgres).
