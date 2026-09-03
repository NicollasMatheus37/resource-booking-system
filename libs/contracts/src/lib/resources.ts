export type ResourceKind = 'EXCLUSIVE' | 'SHARED';

export interface ResourceDto {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly kind: ResourceKind;
  /** Reservas simultâneas aceitas por slot. Sempre 1 quando EXCLUSIVE. */
  readonly unitsPerSlot: number;
  readonly maxUnitsPerUser: number;
  readonly maxSlotsPerReservation: number;
  /** Descritivo: quantas pessoas cabem. Não entra em disponibilidade. */
  readonly seats: number | null;
  readonly active: boolean;
}

export interface SlotDto {
  readonly id: string;
  readonly resourceId: string;
  /** ISO 8601. */
  readonly startsAt: string;
  readonly endsAt: string;
  readonly unitsPerSlot: number;
  readonly reservedUnits: number;
  /** Derivado: `unitsPerSlot - reservedUnits`. */
  readonly availableUnits: number;
  /** Se o usuário corrente já tem reserva confirmada neste slot. */
  readonly reservedByMe: boolean;
}

export interface CreateResourceRequest {
  readonly name: string;
  readonly description?: string | null;
  readonly kind: ResourceKind;
  /**
   * Reservas simultâneas por slot. Obrigatoriamente 1 em EXCLUSIVE.
   * IMUTÁVEL após a criação — ver ADR de cadastros no README.
   */
  readonly unitsPerSlot: number;
  readonly maxUnitsPerUser: number;
  readonly maxSlotsPerReservation: number;
  readonly seats?: number | null;
}

/** `kind` e `unitsPerSlot` não aparecem aqui: são imutáveis. */
export interface UpdateResourceRequest {
  readonly name?: string;
  readonly description?: string | null;
  readonly maxUnitsPerUser?: number;
  readonly maxSlotsPerReservation?: number;
  readonly seats?: number | null;
  readonly active?: boolean;
}
