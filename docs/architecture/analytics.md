# Аналитика активности (Umami)

Самостоятельная аналитика: кто куда заходил и какие окна открываются чаще. Umami (open source) крутится рядом с приложением, данные
не уходят наружу. Код — `apps/web/src/lib/analytics.ts`, деплой — `docker-compose*.yml`, `docker/nginx.conf`, `docker/Caddyfile`.

## Что собирается
- **Просмотр страницы** при каждой смене маршрута (`AppShell`): путь без query и hash, сегменты-идентификаторы заменены на `:id`
  (UUID, всё с цифрами, длинные хэши): `/documents/:id/print/invoice`, `/crm/companies/:id`.
- **Событие `open`** с полями `kind` и `name`: `window` (`FloatingWindow`, `name="task"`), `drawer` (`EntityDrawer`, имя вроде `crm-deal`,
  `record:<ключ сущности>`), `palette` (`cmd` или `search`). Имя — необязательный проп `trackName` у компонента, константа в месте вызова;
  без него уходит `unnamed` (пробел виден в отчёте). Новая карточка или окно — проставь `trackName`.
- **Кто**: `umami.identify` с id пользователя (UUID, псевдоним) и полями `workspace` (id воркспейса), `role` (owner/admin/member/guest).
- Стандартные поля Umami: экран, язык, страна/город по IP (сам IP не хранится), браузер, ОС.

## Чего нет
- Заголовков страниц (в них имена клиентов, задач), query и hash, текста из полей, названий и данных записей.
- Email и имён пользователей. Последний рубеж — `data-before-send` у скрипта: любая нагрузка, включая `identify`, уходит с нормализованным
  `url`, пустыми `title` и `referrer`.
- Сбор не работает при включённом Do Not Track браузера, при блокировщике и без ID сайта (полный no-op: тесты, dev).

## Как устроено
- Трекер грузится с того же origin: `/stats/m.js`, события — `/stats/api/m`. nginx (`location /stats/`) проксирует на `umami:3000`, отрезая
  `/stats`; CSP остаётся `script-src 'self'`, `connect-src 'self'`. Имена скрипта и точки сбора — `TRACKER_SCRIPT_NAME=m.js`,
  `COLLECT_API_ENDPOINT=/api/m` (не `script.js`/`/api/send`, которые режут блокировщики). Адрес `umami` в nginx — через `resolver` и переменную:
  без сервиса nginx всё равно стартует, `/stats/` отвечает 502. Vite dev-сервер проксирует `/stats` так же (`VITE_UMAMI_PROXY`, по умолчанию `:3100`).
- ID сайта задаётся **без пересборки**: контейнер `web` при старте пишет `/config.js` из `UMAMI_WEBSITE_ID` (`docker/web-config.sh`, допускаются
  только hex и дефис); веб читает `window.__GR8R_CONFIG__`. Запасной вариант на этапе сборки — `VITE_UMAMI_WEBSITE_ID`.
- Образ — `ghcr.io/umami-software/umami:postgresql-v2.19.0` (версия закреплена, обновлять осознанно). База — `umami` в том же Postgres, роль `umami`.
  Её создаёт разовый сервис `umami-init` (`docker/umami-init.sh`, идемпотентно, при каждом `up`; работает и на непустом томе, где скрипты
  `initdb.d` не выполняются; пароль роли синхронизируется с `UMAMI_DB_PASSWORD`). Дамп `backup` снимает только базу приложения: базу `umami`
  при необходимости копировать отдельно (`pg_dump -U postgres -d umami`).
- Сервис `umami` есть во всех трёх compose-файлах. В `docker-compose.yml` панель на `http://localhost:3100`; в prod — поддомен через Caddy
  (`UMAMI_DOMAIN`, по умолчанию `stats.$DOMAIN`, нужна A-запись); в Coolify — домен задаётся у сервиса `umami` (порт 3000).

## Как включить
1. В `.env.prod` (или переменных Coolify): `UMAMI_DB_PASSWORD` и `UMAMI_APP_SECRET` (`openssl rand -hex 24` / `-hex 32`; hex — чтобы не ломать
   URL подключения). Они обязательны: без них compose не стартует.
2. `up -d --build`, открыть панель (`https://stats.$DOMAIN`), войти `admin` / `umami` и **сразу сменить пароль**.
3. Settings → Websites → Add website (имя и домен любые), скопировать ID сайта.
4. Записать его в `UMAMI_WEBSITE_ID` и перезапустить `web` (`up -d web`): пересборка не нужна.

## Как смотреть
Панель Umami → сайт: Realtime, Sessions (кто заходил: id пользователя, воркспейс, роль), Pages (какие экраны), Events → `open` →
Properties `kind` / `name` (какие окна открывают чаще). Фильтр по свойствам сессии `workspace` и `role` — срез по арендатору и роли.

## Проверено и нет
Проверено локально: `docker compose config` для трёх файлов; `umami-init` и Umami v2.19.0 против Postgres 16 (heartbeat, `/m.js`);
nginx `-t` и проксирование `/stats/m.js` и `/stats/api/m` до Umami; формат вызовов трекера (`track`, `identify`, `data-before-send`, `data-host-url`)
сверен с отдаваемым скриптом. Не проверено: полный стек с вебом в браузере и приход событий в панель, Caddy-поддомен с настоящим
сертификатом, Coolify.
