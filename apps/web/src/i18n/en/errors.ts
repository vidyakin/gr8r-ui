/* Ошибки API по коду (error.code). Параметры берутся из error.details. На английском приоритет у текста сервера —
   он точнее; ключ здесь нужен, чтобы перевести код на другие языки (см. errorMessage в data/api.ts) */
export const errors = {
  unknown: 'Something went wrong',
  network: 'Could not reach the server',
  not_found: 'The record was not found',
  forbidden: 'You do not have permission to do this',
  unauthorized: 'Please sign in again',
  conflict: 'A record with the same unique value already exists',
  invalid_reference: 'The selected record does not exist or is no longer available',
  missing_value: 'A required value is missing',
  check_violation: 'A value is out of the allowed range',
  invalid_value: 'A value has an invalid format',
  invalid_json: 'Request body is not valid JSON',
  internal_error: 'Internal server error',
  rate_limited: 'Too many attempts. Try again in {retryAfterSeconds} s.',
  invalid_credentials: 'Invalid email or password',
  email_taken: 'An account with this email already exists',
  validation_error: 'Check the value of “{path}”',
  company_not_allowed: 'A customer can be set only for a task of the Services module',
};
