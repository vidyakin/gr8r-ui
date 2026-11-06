# Рейтинг поставщиков

Реализовано в задаче 1276. Код: `packages/db/src/supplier-rating.ts`, `packages/shared/src/supplier-rating.ts`, API `apps/api/src/routes/supplier-ratings.ts`.

- Расчёт на лету по проведённым документам (без таблицы фактов). Период по умолчанию 12 месяцев.
- Показатели: сроки, полнота, качество. Итог 0–100 — средневзвешенное с перераспределением весов при отсутствии данных; нет данных — null. Уровень A/B/C/D.
- Настройки в колонках `workspaces`: `supplier_rating_weights jsonb`, `supplier_rating_d_policy text` (none|warn|block). Миграция `0094_supplier_rating.sql`.
- Политика при уровне D проверяется при проведении `supplier_order`: block → 422 `supplier_rating_blocked`, warn → 200 с `warnings`.
- Путь `/supplier-ratings` в `TENANT_PATHS` и модуле `trade`. Раздел меню `supplierRatings`.
