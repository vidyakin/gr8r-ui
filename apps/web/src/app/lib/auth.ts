/* Помощники экранов входа. Сама сессия — в data/session.tsx (настоящая авторизация через /auth/*). */

export const EMAIL_RE = /^\S+@\S+\.\S+$/;
/** Правило пароля из оригинала: от 10 символов и цифра или символ */
export const pwWeak = (pw: string) => pw.length < 10 || !/[0-9\W]/.test(pw);

/** Данные форм, общие для экранов входа (S.ui.af в оригинале) */
export const authForm = { email: '', name: '' };
