import type {
  ResourceKind,
  SlotAvailabilityChanged,
} from '@resource-booking/contracts';

/** Visão mínima do recurso que o use-case precisa para decidir. */
export interface ResourceSnapshot {
  readonly id: string;
  readonly kind: ResourceKind;
  readonly unitsPerSlot: number;
  readonly maxUnitsPerUser: number;
  readonly maxSlotsPerReservation: number;
  readonly active: boolean;
}

export interface SlotSnapshot {
  readonly id: string;
  readonly resourceId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly unitsPerSlot: number;
  readonly reservedUnits: number;
}

export interface ConfirmReservationCommand {
  readonly resourceId: string;
  readonly userId: string;
  readonly quantity: number;
  readonly exclusive: boolean;
  /** Já ordenados por `startsAt` ascendente pelo use-case (ADR 0011). */
  readonly slots: readonly SlotSnapshot[];
  readonly idempotencyKey?: string;
}

export interface ConfirmedReservation {
  readonly id: string;
  readonly resourceId: string;
  readonly userId: string;
  readonly quantity: number;
  readonly slotIds: readonly string[];
  readonly createdAt: Date;
  /** Contagem pós-commit de cada slot, para publicar o delta de SSE. */
  readonly updatedSlots: readonly {
    slotId: string;
    reservedUnits: number;
    unitsPerSlot: number;
  }[];
}

export interface CancelledReservation {
  readonly id: string;
  readonly resourceId: string;
  /** Vazio quando a reserva já estava cancelada — nada foi devolvido. */
  readonly releasedSlots: readonly {
    slotId: string;
    reservedUnits: number;
    unitsPerSlot: number;
  }[];
  /** `false` quando a chamada não teve efeito: cancelar é idempotente. */
  readonly changed: boolean;
}

/**
 * Port de persistência. O use-case depende desta interface, nunca do Prisma.
 *
 * `confirm` é a operação crítica: recebe tudo já validado e deve executar a
 * reserva dos N slots numa ÚNICA transação, tudo ou nada. As garantias de
 * concorrência são responsabilidade do adapter (ADR 0004) — o use-case não
 * sabe como elas são obtidas, só que os erros de domínio corretos são lançados.
 */
export interface ReservationRepository {
  findResource(resourceId: string): Promise<ResourceSnapshot | null>;
  findSlots(slotIds: readonly string[]): Promise<SlotSnapshot[]>;
  findByIdempotencyKey(
    userId: string,
    key: string,
  ): Promise<ConfirmedReservation | null>;
  confirm(command: ConfirmReservationCommand): Promise<ConfirmedReservation>;

  /**
   * Cancela e devolve as unidades de todos os slots do grupo.
   *
   * Precisa ser IDEMPOTENTE: duas chamadas simultâneas não podem devolver
   * unidades duas vezes. Cancelar é o caminho inverso da concorrência e é
   * onde a invariante fura em sentido contrário — contador negativo, ou
   * unidade devolvida em dobro.
   */
  cancel(reservationId: string, userId: string): Promise<CancelledReservation>;
}

export const RESERVATION_REPOSITORY = Symbol('ReservationRepository');

/**
 * Publicação de mudanças de disponibilidade (ADR 0005).
 *
 * O use-case depende desta interface e não sabe que o transporte é SSE —
 * trocar por WebSocket ou por um barramento entre réplicas não toca em regra
 * de negócio.
 *
 * CONTRATO IMPORTANTE: só é chamado DEPOIS do commit. Publicar dentro da
 * transação anunciaria uma disponibilidade que ainda pode sofrer rollback.
 */
export interface AvailabilityPublisher {
  publish(events: readonly SlotAvailabilityChanged[]): void;
}

export const AVAILABILITY_PUBLISHER = Symbol('AvailabilityPublisher');

/** Injetável para tornar "agora" determinístico nos testes. */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('Clock');

export const systemClock: Clock = { now: () => new Date() };
