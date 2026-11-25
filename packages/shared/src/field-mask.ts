const SYSTEM_FIELDS: Readonly<Record<string, readonly string[]>> = {
  'deal.amount': ['amount', 'weighted', 'weightedAmount'],
  'deal.probability': ['probability', 'weighted', 'weightedAmount'],
  'contact.phone': ['phone'],
  'contact.email': ['email'],
  'lead.phone': ['phone', 'phoneNorm'],
  'lead.email': ['email', 'emailNorm'],
  'company.requisites': ['country', 'requisites', 'kind', 'inn', 'kpp', 'ogrn', 'legalAddress', 'actualAddress'],
  'company.bankAccounts': ['bankAccounts'],
  'document.total': ['total', 'amountNet', 'amountVat', 'vatTotal', 'net', 'vat', 'vatAmount', 'price', 'amount', 'cost', 'costTotal', 'serviceCost', 'payment', 'sum', 'totals', 'loyalty', 'discount', 'grossProfit', 'revenue'],
};

const DOCUMENT_CHILDREN = ['lines', 'variants', 'children', 'basedOn', 'derived', 'related', 'relatedDocuments', 'documents'] as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function project<T extends object>(entity: string, row: T, hiddenFields: readonly string[]): T {
  const result = { ...row } as Record<string, unknown>;
  const prefix = `custom:${entity}.`;
  for (const key of hiddenFields) {
    if (key.startsWith(prefix)) {
      for (const container of ['custom', 'data']) {
        const values = record(result[container]);
        const name = key.slice(prefix.length);
        if (!values || !Object.hasOwn(values, name)) continue;
        const copy = { ...values };
        delete copy[name];
        result[container] = copy;
      }
    } else if (key.startsWith(`${entity}.`)) {
      for (const name of SYSTEM_FIELDS[key] ?? []) delete result[name];
    }
  }
  if (entity === 'document' && hiddenFields.includes('document.total')) {
    for (const key of DOCUMENT_CHILDREN) {
      const value = result[key];
      if (Array.isArray(value)) {
        result[key] = value.map((child: unknown) => {
          const nested = record(child);
          return nested ? project(entity, nested, hiddenFields) : child;
        });
      } else {
        const nested = record(value);
        if (nested) result[key] = project(entity, nested, hiddenFields);
      }
    }
  }
  if (entity === 'document') {
    const counterparty = record(result.counterparty);
    if (counterparty) result.counterparty = project('company', counterparty, hiddenFields);
  }
  // Сохраняем форму типизированного клиента. Ограничения чтения учитывает useHiddenFields.
  return result as T;
}

export function maskFields<T extends object>(entity: string, row: T, hiddenFields: readonly string[]): T {
  return hiddenFields.length ? project(entity, row, hiddenFields) : row;
}

export function maskRows<T extends object>(entity: string, rows: T[], hiddenFields: readonly string[]): T[] {
  return hiddenFields.length ? rows.map(row => maskFields(entity, row, hiddenFields)) : rows;
}

export function assertNoHiddenFieldWrite(entity: string, payload: unknown, hiddenFields: readonly string[]): string[] {
  const body = record(payload);
  if (!body) return [];
  const prefix = `custom:${entity}.`;
  const has = (obj: Record<string, unknown> | undefined, key: string) => !!obj && Object.hasOwn(obj, key) && obj[key] !== undefined;
  return hiddenFields.filter(key => {
    if (key.startsWith(prefix)) {
      const name = key.slice(prefix.length);
      return has(record(body.custom), name) || has(record(body.data), name);
    }
    if (!key.startsWith(`${entity}.`)) return false;
    const names = SYSTEM_FIELDS[key] ?? [];
    if (names.some(name => has(body, name))) return true;
    return key === 'document.total' && ['lines', 'priceKindId', 'priceIncludesVat'].some(name => has(body, name));
  });
}

/** Снимки и патчи в журнале остаются полными для системных потребителей. */
export function maskEventFields(entity: string, payload: Record<string, unknown>, hiddenFields: readonly string[]): Record<string, unknown> {
  if (!hiddenFields.length) return payload;
  const snapshot = maskFields(entity, payload, hiddenFields);
  const row = record(payload.record);
  if (row) snapshot.record = maskFields(entity, row, hiddenFields);
  const data = record(payload.data);
  if (data) snapshot.data = maskFields(entity, { data }, hiddenFields).data;
  const delta = record(payload.changes);
  if (delta) {
    const changes = entity === 'record' || typeof payload.entityKey === 'string'
      ? maskFields(entity, { data: delta }, hiddenFields).data
      : maskFields(entity, delta, hiddenFields);
    const custom = record(delta.custom);
    if (custom) {
      const filtered = { ...custom };
      for (const key of ['from', 'to']) {
        const values = record(custom[key]);
        if (values) filtered[key] = maskFields(entity, { custom: values }, hiddenFields).custom;
      }
      snapshot.changes = { ...changes, custom: filtered };
    } else {
      snapshot.changes = changes;
    }
  }
  return snapshot;
}
