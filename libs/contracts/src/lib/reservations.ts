export interface CreateReservationRequest {
  readonly resourceId: string;
  /**
   * Pode conter lacunas. O servidor agrupa em blocos contíguos e cria UMA
   * reserva por bloco, cada uma independente (ADR 0011). Ordem é irrelevante.
   */
  readonly slotIds: readonly string[];
  /** Unidades por slot. Omitido equivale a 1. Sempre 1 em EXCLUSIVE. */
  readonly quantity?: number;
}

export interface RejectedBlock {
  readonly slotIds: readonly string[];
  readonly code: string;
  readonly message: string;
}

/**
 * Resultado de um pedido de reserva.
 *
 * Uma seleção com lacunas produz vários blocos, e cada bloco é atômico por si
 * — então o resultado pode ser parcial. O status HTTP reflete isso: `201`
 * quando tudo passou, `207` quando parte passou, `409` quando nada passou.
 */
export interface CreateReservationResponse {
  readonly created: readonly ReservationDto[];
  readonly rejected: readonly RejectedBlock[];
}

export type ReservationStatus = 'CONFIRMED' | 'CANCELLED';

export interface ReservationDto {
  readonly id: string;
  readonly resourceId: string;
  readonly userId: string;
  readonly quantity: number;
  readonly status: ReservationStatus;
  readonly slotIds: readonly string[];
  readonly createdAt: string;
}

/** Uma reserva do usuário, como aparece em "minhas reservas". */
export interface ReservationSummaryDto {
  readonly id: string;
  readonly status: ReservationStatus;
  readonly quantity: number;
  readonly createdAt: string;
  readonly resource: {
    readonly id: string;
    readonly name: string;
    readonly kind: 'EXCLUSIVE' | 'SHARED';
  };
  /** Ordenados por início. Uma reserva agrupa 1..N slots (ADR 0011). */
  readonly slots: readonly {
    readonly id: string;
    readonly startsAt: string;
    readonly endsAt: string;
  }[];
}
