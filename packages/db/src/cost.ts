/* Стоимость (себестоимость, цены затрат, цена оприходования) видят только admin и owner — единая точка маскирования.
   Количество участник видит всегда: маскируется только цена. Этапы 2+ пользуются той же функцией. */
import type { Role } from '@gr8r/shared';

/** Есть ли у участника право видеть стоимость */
export const canSeeCost = (role: Role | undefined): boolean => role === 'owner' || role === 'admin';

/** Прячет значение стоимости от участников без права видеть её */
export const maskCost = <T>(value: T | null | undefined, role: Role | undefined): T | null => (canSeeCost(role) ? (value ?? null) : null);
