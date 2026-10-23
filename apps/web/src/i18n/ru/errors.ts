import type { Widen } from '../types';
import type { errors as E } from '../en/errors';

export const errors: Widen<typeof E> = {
  unknown: 'Что-то пошло не так',
  network: 'Сервер недоступен',
  not_found: 'Запись не найдена',
  forbidden: 'Недостаточно прав для этого действия',
  unauthorized: 'Войдите снова',
  conflict: 'Запись с таким уникальным значением уже есть',
  invalid_reference: 'Выбранная запись не существует или больше недоступна',
  missing_value: 'Не заполнено обязательное значение',
  check_violation: 'Значение вне допустимого диапазона',
  invalid_value: 'Значение в неверном формате',
  invalid_json: 'Тело запроса — некорректный JSON',
  internal_error: 'Внутренняя ошибка сервера',
  rate_limited: 'Слишком много попыток. Повторите через {retryAfterSeconds} с.',
  invalid_credentials: 'Неверный email или пароль',
  email_taken: 'Пользователь с таким email уже есть',
  validation_error: 'Проверьте значение «{path}»',
  company_not_allowed: 'Заказчика можно указать только у задачи модуля «Услуги»',
};
