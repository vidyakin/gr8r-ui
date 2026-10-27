/* zod-схемы хранилища секретов (задача 1174а, docs/architecture/secrets.md). */
import { z } from 'zod';

/** Имя секрета: латиница нижнего регистра, цифры, . _ - ; например `yookassa.api_key` */
export const SECRET_KEY_RE = /^[a-z][a-z0-9._-]{0,63}$/;

export const secretKeyParam = z.object({ key: z.string().regex(SECRET_KEY_RE) });
export const secretSet = z.object({ value: z.string().min(1).max(8192) });
