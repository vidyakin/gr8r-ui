import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Склейка классов; tailwind-merge снимает конфликты утилит (нужно и для shadcn-компонентов). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
