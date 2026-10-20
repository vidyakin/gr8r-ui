/* Ошибка предметной области: бросается сервисами документов и склада, API превращает её в ответ с тем же статусом и кодом. */
export class DomainError extends Error {
  constructor(
    public status: 400 | 404 | 409 | 422,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
