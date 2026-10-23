/* Типы словаря: форма ru выводится из en без литеральных строк */

/** Формы множественного числа: en — one/other, ru — one/few/many/other */
export interface Plural {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export type Widen<T> = T extends string ? string : T extends { other: string } ? Plural : { [K in keyof T]: Widen<T[K]> };
