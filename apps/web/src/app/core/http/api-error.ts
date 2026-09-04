import { HttpErrorResponse } from '@angular/common/http';
import type {
  ApiError,
  ApiErrorCode,
  CreateReservationResponse,
} from '@resource-booking/contracts';

/**
 * Extrai o contrato de erro da resposta.
 *
 * O cliente decide pelo `code`, NUNCA pela mensagem: texto muda com i18n e
 * com reescrita de copy, e status HTTP sozinho não distingue os dois 409
 * (ADR 0006).
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as Partial<ApiError> | null;

    if (body && typeof body.code === 'string') {
      return {
        code: body.code as ApiErrorCode,
        message: body.message ?? 'Não foi possível concluir a operação.',
        details: body.details,
      };
    }

    // Sem corpo estruturado: rede caiu, proxy respondeu, servidor morreu.
    return {
      code: error.status === 0 ? 'INTERNAL' : 'INTERNAL',
      message:
        error.status === 0
          ? 'Sem conexão com o servidor.'
          : 'Erro inesperado no servidor.',
    };
  }

  return { code: 'INTERNAL', message: 'Erro inesperado.' };
}

/** Qual slot causou o conflito, quando a API informa. */
export function blamedSlotId(error: ApiError): string | undefined {
  const slotId = error.details?.['slotId'];
  return typeof slotId === 'string' ? slotId : undefined;
}

/**
 * Um `409` de reserva não é falha de transporte: é o contrato de resultado com
 * `created` vazio. O Angular manda status de erro pelo canal de erro
 * independentemente do `observe`, então desembrulhamos aqui em vez de espalhar
 * essa peculiaridade pelo store.
 *
 * Devolve `null` quando o erro é outra coisa — rede caída, 500, 422.
 */
export function asReservationResult(
  error: unknown,
): CreateReservationResponse | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 409) {
    return null;
  }

  const body = error.error as Partial<CreateReservationResponse> | null;
  if (!body || !Array.isArray(body.rejected)) return null;

  return { created: body.created ?? [], rejected: body.rejected };
}
