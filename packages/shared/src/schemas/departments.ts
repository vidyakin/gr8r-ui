/* zod-схемы подразделений (оргструктура, docs/architecture/departments.md). */
import { z } from 'zod';
import { uuid } from './common';

const name = z.string().trim().min(1).max(120);
const sortOrder = z.number().int().min(0).max(1_000_000);

export const departmentSave = z.object({ name, parentId: uuid.nullable().optional(), headMemberId: uuid.nullable().optional(), sortOrder: sortOrder.optional() });
// у обновления значений по умолчанию нет: непришедшее поле не меняется (undefined — не трогать, null — очистить)
export const departmentUpdate = z.object({ name: name.optional(), parentId: uuid.nullable().optional(), headMemberId: uuid.nullable().optional(), sortOrder: sortOrder.optional() });

/** Назначить подразделение участнику; null — убрать из подразделения */
export const memberDepartmentSet = z.object({ departmentId: uuid.nullable() });