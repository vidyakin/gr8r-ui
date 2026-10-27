/* zod-схемы серийных номеров, изделий в ремонте и материалов заказчика (задача 1099). */
import { z } from 'zod';
import { SERIAL_STATUSES } from '../serials';
import { clientId, isoDate, listQuery, uuid } from './common';

export const serialText = z.string().trim().min(1).max(100);

export const serialQuery = listQuery.extend({
  productId: uuid.optional(),
  warehouseId: uuid.optional(),
  status: z.enum(SERIAL_STATUSES).optional(),
});
export const serialLookupQuery = z.object({ serial: z.string().trim().min(1).max(100) });
export const serialUpdate = z.object({ warrantyUntil: isoDate.nullish(), note: z.string().max(2000).optional() }).strict();

/** Номера строки документа или материала заказ-наряда: список заменяется целиком */
export const documentSerialsSave = z.object({
  lineId: uuid.optional(),
  materialId: uuid.optional(),
  serials: z.array(serialText).max(2000),
});

export const repairItemSave = z.object({
  productId: uuid.nullish(),
  name: z.string().trim().max(300).default(''),
  serialText: z.string().trim().max(100).default(''),
  defect: z.string().max(5000).default(''),
  completeness: z.string().max(2000).default(''),
  appearance: z.string().max(2000).default(''),
  receivedAt: isoDate.nullish(),
  returnedAt: isoDate.nullish(),
  outsourceCompanyId: uuid.nullish(),
  outsourcedAt: isoDate.nullish(),
  outsourceReturnedAt: isoDate.nullish(),
});
export type RepairItemSave = z.infer<typeof repairItemSave>;

export const customerMaterialInput = z.object({
  id: clientId,
  productId: uuid.nullish(),
  name: z.string().trim().max(300).default(''),
  qty: z.string().regex(/^\d{1,15}(\.\d{1,3})?$/).default('1'),
  comment: z.string().max(2000).default(''),
});
export const customerMaterialsSave = z.object({ materials: z.array(customerMaterialInput).max(200) });

export const repairItemsQuery = listQuery.extend({ open: z.enum(['1', '0']).optional(), kindType: z.enum(['repair', 'warranty']).optional() });
