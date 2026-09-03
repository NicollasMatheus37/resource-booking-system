import { Inject, Injectable } from '@nestjs/common';
import {
  AVAILABILITY_PUBLISHER,
  RESERVATION_REPOSITORY,
  type AvailabilityPublisher,
  type CancelledReservation,
  type ReservationRepository,
} from './ports';

/**
 * Cancelamento (Fatia 4 do plano).
 *
 * A regra de negócio é curta de propósito: toda a dificuldade está na
 * atomicidade da devolução, que pertence ao adapter. O que este caso de uso
 * garante é o contrato observável — idempotência e publicação pós-commit.
 */
@Injectable()
export class CancelReservationUseCase {
  constructor(
    @Inject(RESERVATION_REPOSITORY)
    private readonly repository: ReservationRepository,
    @Inject(AVAILABILITY_PUBLISHER)
    private readonly publisher: AvailabilityPublisher,
  ) {}

  async execute(
    reservationId: string,
    userId: string,
  ): Promise<CancelledReservation> {
    const result = await this.repository.cancel(reservationId, userId);

    // Só anuncia se algo mudou de fato. Um cancelamento repetido não liberou
    // nada, e emitir evento faria todas as abas refazerem trabalho à toa.
    if (result.changed && result.releasedSlots.length > 0) {
      this.publisher.publish(
        result.releasedSlots.map((slot) => ({
          type: 'slot-availability-changed' as const,
          slotId: slot.slotId,
          resourceId: result.resourceId,
          reservedUnits: slot.reservedUnits,
          unitsPerSlot: slot.unitsPerSlot,
        })),
      );
    }

    return result;
  }
}
