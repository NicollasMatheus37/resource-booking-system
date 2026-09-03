import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiError, ApiErrorCode } from '@resource-booking/contracts';
import type { Response } from 'express';
import { DomainError } from '../../modules/reservations/domain/domain-error';

/**
 * Traduz erro de domínio para HTTP (ADR 0004).
 *
 * Os dois conflitos compartilham o status 409 mas têm `code` distinto, porque
 * exigem reações diferentes na tela: em SLOT_UNAVAILABLE a contagem do slot
 * mudou e o cliente precisa reconciliar; em ALREADY_RESERVED a contagem está
 * correta e mexer nela introduziria o erro que se queria evitar (ADR 0006).
 */
const STATUS_BY_CODE: Record<ApiErrorCode, HttpStatus> = {
  SLOT_UNAVAILABLE: HttpStatus.CONFLICT,
  ALREADY_RESERVED: HttpStatus.CONFLICT,
  SLOT_IN_PAST: HttpStatus.UNPROCESSABLE_ENTITY,
  RESOURCE_INACTIVE: HttpStatus.UNPROCESSABLE_ENTITY,
  INVALID_SELECTION: HttpStatus.UNPROCESSABLE_ENTITY,
  TOO_MANY_SLOTS: HttpStatus.UNPROCESSABLE_ENTITY,
  INVALID_QUANTITY: HttpStatus.UNPROCESSABLE_ENTITY,
  SLOT_NOT_FOUND: HttpStatus.NOT_FOUND,
  RESOURCE_NOT_FOUND: HttpStatus.NOT_FOUND,
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  INTERNAL: HttpStatus.INTERNAL_SERVER_ERROR,
};

@Catch()
export class DomainErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof DomainError) {
      const status = STATUS_BY_CODE[exception.code];
      const body: ApiError = {
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
      response.status(status).json(body);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const body: ApiError = {
        code:
          status === HttpStatus.UNAUTHORIZED
            ? 'UNAUTHENTICATED'
            : status === HttpStatus.BAD_REQUEST
              ? 'VALIDATION_FAILED'
              : 'INTERNAL',
        message:
          typeof payload === 'string'
            ? payload
            : ((payload as { message?: string | string[] }).message ??
                exception.message).toString(),
        details:
          typeof payload === 'object' ? (payload as Record<string, unknown>) : undefined,
      };
      response.status(status).json(body);
      return;
    }

    // Só chega aqui o que é genuinamente inesperado.
    this.logger.error(exception);
    const body: ApiError = {
      code: 'INTERNAL',
      message: 'Erro interno.',
    };
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body);
  }
}
