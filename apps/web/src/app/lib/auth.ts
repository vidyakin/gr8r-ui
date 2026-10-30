/* Помощники экранов входа. Сама сессия — в data/session.tsx (настоящая авторизация через /auth/*). */

export const EMAIL_RE = /^\S+@\S+\.\S+$/;
/** Правило пароля из оригинала: от 10 символов и цифра или символ */
export const pwWeak = (pw: string) => pw.length < 10 || !/[0-9\W]/.test(pw);

/** Данные форм, общие для экранов входа (S.ui.af в оригинале) */
export const authForm = { email: '', name: '' };

/** Токен приглашения, с которым человека отправили входить или регистрироваться: после входа возвращаем на /join/:token */
const INVITE_KEY = 'gr8r-ui.pending-invite';
export const pendingInvite = {
  get(): string | null {
    try {
      return sessionStorage.getItem(INVITE_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null) {
    try {
      if (token) sessionStorage.setItem(INVITE_KEY, token);
      else sessionStorage.removeItem(INVITE_KEY);
    } catch {
      /* хранилище недоступно */
    }
  },
};
