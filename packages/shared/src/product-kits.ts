/* Комплекты товаров (наборы как в УНФ): распределение цены/выручки по составляющим с точностью до копейки
   и проверка ацикличности состава комплекта. Чистые функции на BigInt без float. */
import { dec, div, fmt, roundDiv, type Dec } from './decimal';
import { fmtKop, toKop } from './documents';

export interface KitComponentInput {
  productId: string;
  /** Количество составляющей на 1 базовую единицу комплекта */
  qty: string;
  /** Явная доля цены/веса (необязательна); пусто — берётся каталожная цена × количество */
  priceShare?: string | null;
  /** Каталожная цена продажи единицы составляющей (используется, если не заданы явные доли) */
  catalogPrice?: string | null;
}

export interface KitDistributedItem {
  productId: string;
  qtyPerKit: string;
  totalQty: string;
  /** Использованный вес доли, % (2 знака, сумма = 100.00 при положительной базе) */
  weightSharePct: string;
  /** Явная доля (или null, если распределялось по ценам/количеству) */
  priceShare: string | null;
  /** Расчётная цена за базовую единицу составляющей */
  unitPrice: string;
  net: string;
  vatAmount: string;
  total: string;
}

/** Пропорциональное распределение целых копеек методом наибольших остатков (Гамильтона).
    Гарантирует: сумма результата строго равна amountKop; элементы с нулевым весом всегда получают 0. */
export function apportionKop(amountKop: bigint, weights: readonly bigint[]): bigint[] {
  if (!weights.length) return [];
  const totalWeight = weights.reduce((s, w) => s + (w > 0n ? w : 0n), 0n);
  if (amountKop === 0n || totalWeight <= 0n) return weights.map(() => 0n);

  const neg = amountKop < 0n;
  const absAmount = neg ? -amountKop : amountKop;
  const base: bigint[] = [];
  const rems: { idx: number; rem: bigint; weight: bigint }[] = [];
  let assigned = 0n;

  for (let i = 0; i < weights.length; i++) {
    const w = weights[i]! > 0n ? weights[i]! : 0n;
    if (w === 0n) {
      base.push(0n);
      continue;
    }
    const prod = absAmount * w;
    const q = prod / totalWeight;
    const rem = prod % totalWeight;
    base.push(q);
    assigned += q;
    rems.push({ idx: i, rem, weight: w });
  }

  let left = absAmount - assigned;
  rems.sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : b.weight > a.weight ? 1 : b.weight < a.weight ? -1 : a.idx - b.idx));
  for (let k = 0; k < rems.length && left > 0n; k++) {
    base[rems[k]!.idx]! += 1n;
    left -= 1n;
  }

  return neg ? base.map(v => -v) : base;
}

/** Вычисляет веса для составляющих комплекта:
    1) явные доли priceShare (если заданы и сумма > 0);
    2) каталожные цены (qty × catalogPrice, если сумма > 0);
    3) пропорционально количеству (или поровну, если количества равны). */
export function resolveKitWeights(components: readonly KitComponentInput[]): { weights: bigint[]; mode: 'share' | 'catalog' | 'qty' } {
  if (!components.length) return { weights: [], mode: 'qty' };

  const hasExplicit = components.some(c => c.priceShare !== null && c.priceShare !== undefined && c.priceShare !== '');
  if (hasExplicit) {
    const shareWeights = components.map(c => {
      if (c.priceShare === null || c.priceShare === undefined || c.priceShare === '') return 0n;
      const d = dec(c.priceShare);
      return d > 0n ? d : 0n;
    });
    if (shareWeights.some(w => w > 0n)) return { weights: shareWeights, mode: 'share' };
  }

  const catalogWeights = components.map(c => {
    const q = dec(c.qty);
    const p = dec(c.catalogPrice ?? '0');
    return q > 0n && p > 0n ? q * p : 0n;
  });
  if (catalogWeights.some(w => w > 0n)) return { weights: catalogWeights, mode: 'catalog' };

  const qtyWeights = components.map(c => {
    const q = dec(c.qty);
    return q > 0n ? q : 1n;
  });
  return { weights: qtyWeights, mode: 'qty' };
}

/** Распределяет суммы строки комплекта (net, vatAmount, total) по составляющим с точностью до копейки.
    Сумма net, сумма vatAmount и сумма total по составляющим строго равны суммам строки комплекта,
    причём для каждой составляющей выполняется net + vatAmount = total. */
export function distributeKitLine(opts: {
  lineQty: string;
  lineNet: string;
  lineVat: string;
  lineTotal: string;
  priceIncludesVat: boolean;
  components: readonly KitComponentInput[];
}): KitDistributedItem[] {
  const { components } = opts;
  if (!components.length) return [];

  const { weights } = resolveKitWeights(components);
  const totalWeight = weights.reduce((s, w) => s + w, 0n);
  const lineQtyDec = dec(opts.lineQty);

  const totalKop = toKop(opts.lineTotal);
  const vatKop = toKop(opts.lineVat);
  const totals = apportionKop(totalKop, weights);
  const vats = apportionKop(vatKop, weights);

  // Для каждой строки гарантируем 0 <= vat <= total (при обычных ставках НДС это выполняется автоматически,
  // но на 1 копейке при экстремальной ставке страхуемся переносом).
  for (let i = 0; i < components.length; i++) {
    if (totalKop >= 0n && vats[i]! > totals[i]!) {
      vats[i] = totals[i]!;
    }
  }
  let vatDiff = vatKop - vats.reduce((s, v) => s + v, 0n);
  if (vatDiff > 0n) {
    for (let i = 0; i < components.length && vatDiff > 0n; i++) {
      const room = totals[i]! - vats[i]!;
      if (room > 0n && weights[i]! > 0n) {
        const take = room < vatDiff ? room : vatDiff;
        vats[i]! += take;
        vatDiff -= take;
      }
    }
  }

  const sharePcts = apportionKop(10_000n, weights); // 100.00% в сотых долях процента

  return components.map((c, i) => {
    const qtyPerKitDec = dec(c.qty);
    const totalQtyDec: Dec = roundDiv(lineQtyDec * qtyPerKitDec, 1_000_000n);
    const totalVal = totals[i]!;
    const vatVal = vats[i]!;
    const netVal = totalVal - vatVal;
    const baseAmount = opts.priceIncludesVat ? totalVal : netVal;
    const unitPrice = totalQtyDec > 0n ? fmt(div(dec(fmtKop(baseAmount)), totalQtyDec), 2) : '0.00';
    return {
      productId: c.productId,
      qtyPerKit: fmt(qtyPerKitDec, 3),
      totalQty: fmt(totalQtyDec, 3),
      weightSharePct: totalWeight > 0n ? fmtKop(sharePcts[i]!) : '0.00',
      priceShare: c.priceShare !== null && c.priceShare !== undefined && c.priceShare !== '' ? fmt(dec(c.priceShare), 4) : null,
      unitPrice,
      net: fmtKop(netVal),
      vatAmount: fmtKop(vatVal),
      total: fmtKop(totalVal),
    };
  });
}

/** Проверка циклов в графе комплектов: если из любого предложенного компонента достижим rootId, будет цикл. */
export function detectKitCycle(rootId: string, edges: ReadonlyMap<string, readonly string[]>, proposedComponentIds: readonly string[]): boolean {
  const visited = new Set<string>();
  const stack = [...proposedComponentIds];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === rootId) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const next of edges.get(cur) ?? []) {
      if (!visited.has(next)) stack.push(next);
    }
  }
  return false;
}
