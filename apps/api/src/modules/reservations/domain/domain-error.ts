import type { ApiErrorCode } from '@resource-booking/contracts';

/**
 * Erro de regra de negócio. O domínio não conhece HTTP: quem traduz `code`
 * para status é o exception filter (ADR 0004).
 */
export class DomainError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** O slot esgotou. A contagem mudou e o cliente precisa reconciliar. */
export class SlotUnavailableError extends DomainError {
  constructor(slotId: string) {
    super('SLOT_UNAVAILABLE', 'Este horário já foi reservado.', { slotId });
  }
}

/** O usuário já tem reserva neste slot. A contagem NÃO mudou. */
export class AlreadyReservedError extends DomainError {
  constructor(slotId: string) {
    super('ALREADY_RESERVED', 'Você já tem uma reserva neste horário.', {
      slotId,
    });
  }
}

export class SlotInPastError extends DomainError {
  constructor(slotId: string) {
    super('SLOT_IN_PAST', 'Não é possível reservar um horário que já passou.', {
      slotId,
    });
  }
}

export class SlotNotFoundError extends DomainError {
  constructor(slotIds: readonly string[]) {
    super('SLOT_NOT_FOUND', 'Horário inexistente.', { slotIds });
  }
}

export class ResourceInactiveError extends DomainError {
  constructor(resourceId: string) {
    super('RESOURCE_INACTIVE', 'Este recurso não está disponível.', {
      resourceId,
    });
  }
}

export class ResourceNotFoundError extends DomainError {
  constructor(resourceId: string) {
    super('RESOURCE_NOT_FOUND', 'Recurso inexistente.', { resourceId });
  }
}

export class InvalidSelectionError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('INVALID_SELECTION', message, details);
  }
}

export class TooManySlotsError extends DomainError {
  constructor(requested: number, max: number) {
    super(
      'TOO_MANY_SLOTS',
      `Esta reserva permite no máximo ${max} horário(s); foram pedidos ${requested}.`,
      { requested, max },
    );
  }
}

export class InvalidQuantityError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('INVALID_QUANTITY', message, details);
  }
}
