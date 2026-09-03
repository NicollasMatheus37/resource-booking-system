/**
 * Contrato de erro compartilhado entre API e frontend.
 *
 * Status HTTP sozinho não basta: dois conflitos distintos retornam 409 e
 * exigem reações diferentes na tela (ADR 0006). O cliente consome SEMPRE o
 * `code` — nunca a `message`, que é texto para humanos e muda com i18n ou
 * reescrita de copy.
 */
export const API_ERROR_CODES = [
  /** O slot esgotou entre a leitura da tela e o envio. A contagem mudou. */
  'SLOT_UNAVAILABLE',
  /** O usuário já tem reserva confirmada neste slot. A contagem NÃO mudou. */
  'ALREADY_RESERVED',
  'SLOT_IN_PAST',
  'SLOT_NOT_FOUND',
  'RESOURCE_INACTIVE',
  'RESOURCE_NOT_FOUND',
  /** Slots de recursos diferentes na mesma reserva, ou lista vazia. */
  'INVALID_SELECTION',
  'TOO_MANY_SLOTS',
  'INVALID_QUANTITY',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'INTERNAL',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiError {
  readonly code: ApiErrorCode;
  readonly message: string;
  /** Contexto para a UI reconciliar — ex.: qual slot causou o conflito. */
  readonly details?: Record<string, unknown>;
}
