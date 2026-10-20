/* Состояние «вошёл» — упрощённый порт S.ui.auth из оригинала: флаг в localStorage, по умолчанию пользователь вошёл */
import * as React from 'react';

const KEY = 'gr8r-auth';
const subs = new Set<() => void>();

// Запасное значение на случай, когда localStorage недоступен
let mem = true;

function read(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? true : v === '1';
  } catch {
    return mem;
  }
}

export function setSignedIn(v: boolean) {
  mem = v;
  try {
    localStorage.setItem(KEY, v ? '1' : '0');
  } catch {
    /* хранилище недоступно */
  }
  subs.forEach(f => f());
}

export function useSignedIn() {
  return React.useSyncExternalStore(
    cb => {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
    read,
    () => true,
  );
}

export const EMAIL_RE = /^\S+@\S+\.\S+$/;
/** Правило пароля из оригинала: от 10 символов и цифра или символ */
export const pwWeak = (pw: string) => pw.length < 10 || !/[0-9\W]/.test(pw);

/** Данные форм, общие для экранов входа (S.ui.af в оригинале) */
export const authForm = { email: 'hello@gr8rstudio.com', name: '' };
