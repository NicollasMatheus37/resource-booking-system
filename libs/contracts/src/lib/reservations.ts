export interface CreateReservationRequest {
  readonly resourceId: string;
  /** Não precisa ser contíguo (ADR 0011). Ordem é irrelevante para o cliente. */
  readonly slotIds: readonly string[];
  /** Unidades por slot. Omitido equivale a 1. Sempre 1 em EXCLUSIVE. */
  readonly quantity?: number;
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
