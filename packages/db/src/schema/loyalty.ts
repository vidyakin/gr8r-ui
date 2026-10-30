/* Скидки и лояльность (задача 1179): правила автоматических скидок, промокоды, карты лояльности (дисконтные,
   бонусные, накопительные) и журнал движений баллов. Таблицы арендатора (workspace_id + RLS);
   связи — составные внешние ключи (workspace_id, id). Подробности — docs/architecture/loyalty.md. */
import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgTable, text, time, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, money, pk, updatedAt } from './columns';
import { companies } from './crm';
import { productCategories, products } from './catalog';
import { priceKinds } from './pricing';
import { wsCol } from './tenant';
import { documents, documentLines } from './documents';

/** Правило автоматической скидки. Применяется к строкам документов продаж при пересчёте («Пересчитать скидки»),
    не на каждое сохранение. Из подходящих правил применяется наибольший процент; у правил с stackable = true
    процент складывается с лучшей неsuммируемой скидкой. Пустой список ограничения (клиенты/виды цен/товары/категории) — без ограничения. */
export const discountRules = pgTable(
  'discount_rules',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    discountPct: numeric('discount_pct', { precision: 7, scale: 2 }).notNull(),
    /** Суммируется с другими подходящими правилами (а не замещается наибольшим) */
    stackable: boolean('stackable').notNull().default(false),
    /** Только по промокоду: правило не выбирается автоматически без указанного в документе промокода */
    promoOnly: boolean('promo_only').notNull().default(false),
    validFrom: date('valid_from', { mode: 'string' }),
    validTo: date('valid_to', { mode: 'string' }),
    /** Дни недели, когда действует правило (1 = понедельник … 7 = воскресенье); пусто — все дни */
    weekdays: integer('weekdays').array().notNull().default([]),
    /** Часы действия (включительно); null у обоих — весь день */
    timeFrom: time('time_from'),
    timeTo: time('time_to'),
    /** Минимальная сумма документа (net, без НДС), от которой действует правило; 0 — без ограничения */
    minDocumentAmount: money('min_document_amount').notNull().default('0'),
    /** Минимальное количество в строке, от которого действует правило; 0 — без ограничения */
    minLineQty: numeric('min_line_qty', { precision: 18, scale: 3 }).notNull().default('0'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('discount_rules_ws_id_uq').on(t.workspaceId, t.id),
    check('discount_rules_pct_chk', sql`${t.discountPct} >= 0 and ${t.discountPct} <= 100`),
    check('discount_rules_amount_chk', sql`${t.minDocumentAmount} >= 0 and ${t.minLineQty} >= 0`),
    check('discount_rules_period_chk', sql`${t.validFrom} is null or ${t.validTo} is null or ${t.validFrom} <= ${t.validTo}`),
    check('discount_rules_time_chk', sql`(${t.timeFrom} is null) = (${t.timeTo} is null)`),
    uniqueIndex('discount_rules_ws_name_uq').on(t.workspaceId, sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`),
  ],
);

/** Ограничение правила по клиентам (companies). Пустой список для правила — ограничения нет */
export const discountRuleCustomers = pgTable(
  'discount_rule_customers',
  {
    id: pk(),
    workspaceId: wsCol(),
    ruleId: uuid('rule_id').notNull(),
    customerId: uuid('customer_id').notNull(),
  },
  t => [
    unique('discount_rule_customers_rule_customer_uq').on(t.ruleId, t.customerId),
    foreignKey({ columns: [t.workspaceId, t.ruleId], foreignColumns: [discountRules.workspaceId, discountRules.id], name: 'discount_rule_customers_rule_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.customerId], foreignColumns: [companies.workspaceId, companies.id], name: 'discount_rule_customers_customer_fk' }).onDelete('cascade'),
    index('discount_rule_customers_rule_idx').on(t.ruleId),
  ],
);

/** Ограничение правила по видам цен. Пустой список для правила — ограничения нет */
export const discountRulePriceKinds = pgTable(
  'discount_rule_price_kinds',
  {
    id: pk(),
    workspaceId: wsCol(),
    ruleId: uuid('rule_id').notNull(),
    priceKindId: uuid('price_kind_id').notNull(),
  },
  t => [
    unique('discount_rule_price_kinds_rule_kind_uq').on(t.ruleId, t.priceKindId),
    foreignKey({ columns: [t.workspaceId, t.ruleId], foreignColumns: [discountRules.workspaceId, discountRules.id], name: 'discount_rule_price_kinds_rule_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.priceKindId], foreignColumns: [priceKinds.workspaceId, priceKinds.id], name: 'discount_rule_price_kinds_kind_fk' }).onDelete('cascade'),
    index('discount_rule_price_kinds_rule_idx').on(t.ruleId),
  ],
);

/** Ограничение правила по товарам. Пустой список для правила — ограничения нет */
export const discountRuleProducts = pgTable(
  'discount_rule_products',
  {
    id: pk(),
    workspaceId: wsCol(),
    ruleId: uuid('rule_id').notNull(),
    productId: uuid('product_id').notNull(),
  },
  t => [
    unique('discount_rule_products_rule_product_uq').on(t.ruleId, t.productId),
    foreignKey({ columns: [t.workspaceId, t.ruleId], foreignColumns: [discountRules.workspaceId, discountRules.id], name: 'discount_rule_products_rule_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'discount_rule_products_product_fk' }).onDelete('cascade'),
    index('discount_rule_products_rule_idx').on(t.ruleId),
  ],
);

/** Ограничение правила по категориям товаров. Пустой список для правила — ограничения нет */
export const discountRuleCategories = pgTable(
  'discount_rule_categories',
  {
    id: pk(),
    workspaceId: wsCol(),
    ruleId: uuid('rule_id').notNull(),
    categoryId: uuid('category_id').notNull(),
  },
  t => [
    unique('discount_rule_categories_rule_category_uq').on(t.ruleId, t.categoryId),
    foreignKey({ columns: [t.workspaceId, t.ruleId], foreignColumns: [discountRules.workspaceId, discountRules.id], name: 'discount_rule_categories_rule_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.categoryId], foreignColumns: [productCategories.workspaceId, productCategories.id], name: 'discount_rule_categories_category_fk' }).onDelete('cascade'),
    index('discount_rule_categories_rule_idx').on(t.ruleId),
  ],
);

/** Промокод: привязан к правилу скидки, даёт его действие независимо от promo_only. Лимит использований и
    текущий счётчик проверяются и инкрементируются атомарно при проведении документа. */
export const promoCodes = pgTable(
  'promo_codes',
  {
    id: pk(),
    workspaceId: wsCol(),
    code: text('code').notNull(),
    ruleId: uuid('rule_id').notNull(),
    validFrom: date('valid_from', { mode: 'string' }),
    validTo: date('valid_to', { mode: 'string' }),
    /** Лимит использований; null — без ограничения */
    usageLimit: integer('usage_limit'),
    usageCount: integer('usage_count').notNull().default(0),
    createdAt: createdAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('promo_codes_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.ruleId], foreignColumns: [discountRules.workspaceId, discountRules.id], name: 'promo_codes_rule_fk' }),
    check('promo_codes_usage_chk', sql`${t.usageCount} >= 0 and (${t.usageLimit} is null or ${t.usageLimit} >= 0)`),
    check('promo_codes_period_chk', sql`${t.validFrom} is null or ${t.validTo} is null or ${t.validFrom} <= ${t.validTo}`),
    uniqueIndex('promo_codes_ws_code_uq').on(t.workspaceId, sql`lower(${t.code})`),
  ],
);

/** Настройка программы лояльности воркспейса: одна строка на арендатора. */
export const loyaltyPrograms = pgTable(
  'loyalty_programs',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Процент начисления баллов при проведении (от суммы документа за вычетом списанных баллов) */
    accrualPct: numeric('accrual_pct', { precision: 7, scale: 2 }).notNull().default('0'),
    /** Предел списания баллов, % от суммы документа; 1 балл = 1 ₽ */
    redemptionLimitPct: numeric('redemption_limit_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    /** Срок сгорания баллов, дней от начисления; null — не сгорают */
    expirationDays: integer('expiration_days'),
    /** Шкала накопительной карты: [{ fromAmount: string, pct: string }, …] по возрастанию fromAmount */
    cumulativeScale: jsonb('cumulative_scale').$type<Array<{ fromAmount: string; pct: string }>>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('loyalty_programs_ws_uq').on(t.workspaceId),
    check('loyalty_programs_pct_chk', sql`${t.accrualPct} >= 0 and ${t.accrualPct} <= 100`),
    check('loyalty_programs_limit_chk', sql`${t.redemptionLimitPct} >= 0 and ${t.redemptionLimitPct} <= 100`),
    check('loyalty_programs_expiration_chk', sql`${t.expirationDays} is null or ${t.expirationDays} > 0`),
  ],
);

/** Карта лояльности клиента: дисконтная (постоянный процент на карте), бонусная (баллы) или накопительная
    (процент по шкале программы от суммы покупок клиента). */
export const loyaltyCards = pgTable(
  'loyalty_cards',
  {
    id: pk(),
    workspaceId: wsCol(),
    number: text('number').notNull(),
    customerId: uuid('customer_id').notNull(),
    kind: text('kind', { enum: ['discount', 'bonus', 'cumulative'] }).notNull(),
    /** Процент дисконтной карты (только kind = 'discount') */
    discountPct: numeric('discount_pct', { precision: 7, scale: 2 }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('loyalty_cards_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.customerId], foreignColumns: [companies.workspaceId, companies.id], name: 'loyalty_cards_customer_fk' }),
    check('loyalty_cards_kind_chk', sql`${t.kind} in ('discount','bonus','cumulative')`),
    check('loyalty_cards_discount_pct_chk', sql`(${t.kind} = 'discount') = (${t.discountPct} is not null)`),
    check('loyalty_cards_discount_pct_range_chk', sql`${t.discountPct} is null or (${t.discountPct} >= 0 and ${t.discountPct} <= 100)`),
    uniqueIndex('loyalty_cards_ws_number_uq').on(t.workspaceId, sql`lower(${t.number})`),
    index('loyalty_cards_customer_idx').on(t.workspaceId, t.customerId),
  ],
);

/** Журнал движений баллов — только добавление (append-only), история не удаляется и не правится.
    Остаток карты = сумма points по её движениям (accrual и reversal положительные, redemption и expiration отрицательные).
    expiresAt — срок годности начисленных баллов (для сгорания FIFO); у прочих видов движения — null. */
export const loyaltyTransactions = pgTable(
  'loyalty_transactions',
  {
    id: pk(),
    workspaceId: wsCol(),
    cardId: uuid('card_id').notNull(),
    documentId: uuid('document_id'),
    kind: text('kind', { enum: ['accrual', 'redemption', 'expiration', 'reversal'] }).notNull(),
    points: numeric('points', { precision: 18, scale: 2 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    /** Движение, которое это сторнирует (отмена проведения/возврат) — для прослеживаемости, не для расчёта остатка */
    reversesId: uuid('reverses_id'),
    comment: text('comment').notNull().default(''),
    createdAt: createdAt(),
  },
  t => [
    unique('loyalty_transactions_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.cardId], foreignColumns: [loyaltyCards.workspaceId, loyaltyCards.id], name: 'loyalty_transactions_card_fk' }),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'loyalty_transactions_document_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.reversesId], foreignColumns: [t.workspaceId, t.id], name: 'loyalty_transactions_reverses_fk' }).onDelete('set null'),
    check('loyalty_transactions_kind_chk', sql`${t.kind} in ('accrual','redemption','expiration','reversal')`),
    index('loyalty_transactions_card_idx').on(t.workspaceId, t.cardId, t.createdAt),
    index('loyalty_transactions_document_idx').on(t.workspaceId, t.documentId),
    index('loyalty_transactions_expires_idx').on(t.workspaceId, t.kind, t.expiresAt),
  ],
);

/** Лояльность документа: промокод, карта лояльности клиента, списанные баллы. Отдельная таблица 1:1 с documents,
    чтобы не раздувать основную таблицу полями, нужными только документам продаж. */
export const documentLoyalty = pgTable(
  'document_loyalty',
  {
    documentId: uuid('document_id').primaryKey(),
    workspaceId: wsCol(),
    promoCodeId: uuid('promo_code_id'),
    loyaltyCardId: uuid('loyalty_card_id'),
    pointsRedeemed: numeric('points_redeemed', { precision: 18, scale: 2 }).notNull().default('0'),
  },
  t => [
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'document_loyalty_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.promoCodeId], foreignColumns: [promoCodes.workspaceId, promoCodes.id], name: 'document_loyalty_promo_fk' }),
    foreignKey({ columns: [t.workspaceId, t.loyaltyCardId], foreignColumns: [loyaltyCards.workspaceId, loyaltyCards.id], name: 'document_loyalty_card_fk' }),
    check('document_loyalty_points_chk', sql`${t.pointsRedeemed} >= 0`),
    unique('document_loyalty_ws_doc_uq').on(t.workspaceId, t.documentId),
  ],
);

/** Расширение document_lines: источник скидки строки — ручная правка, правило или карта лояльности (дисконтная/накопительная).
    Скидка карты участвует в выборе наибольшей наравне с правилами (задача 1179, решение 1). */
export const documentLineDiscounts = pgTable(
  'document_line_discounts',
  {
    lineId: uuid('line_id').primaryKey(),
    workspaceId: wsCol(),
    source: text('source', { enum: ['manual', 'rule', 'card'] }).notNull().default('manual'),
    ruleId: uuid('rule_id'),
    /** Карта, давшая скидку строки (только source = 'card') */
    cardId: uuid('card_id'),
  },
  t => [
    foreignKey({ columns: [t.workspaceId, t.lineId], foreignColumns: [documentLines.workspaceId, documentLines.id], name: 'document_line_discounts_line_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.ruleId], foreignColumns: [discountRules.workspaceId, discountRules.id], name: 'document_line_discounts_rule_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.cardId], foreignColumns: [loyaltyCards.workspaceId, loyaltyCards.id], name: 'document_line_discounts_card_fk' }).onDelete('set null'),
    check('document_line_discounts_source_chk', sql`${t.source} in ('manual','rule','card')`),
    check('document_line_discounts_rule_src_chk', sql`${t.source} = 'rule' or ${t.ruleId} is null`),
    check('document_line_discounts_card_src_chk', sql`${t.source} = 'card' or ${t.cardId} is null`),
    unique('document_line_discounts_ws_line_uq').on(t.workspaceId, t.lineId),
  ],
);
