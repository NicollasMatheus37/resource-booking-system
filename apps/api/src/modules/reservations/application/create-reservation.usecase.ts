import { Inject, Injectable } from '@nestjs/common';
import {
  InvalidQuantityError,
  InvalidSelectionError,
  ResourceInactiveError,
  ResourceNotFoundError,
  SlotInPastError,
  SlotNotFoundError,
  TooManySlotsError,
} from '../domain/domain-error';
import {
  AVAILABILITY_PUBLISHER,
  CLOCK,
  RESERVATION_REPOSITORY,
  type AvailabilityPublisher,
  type Clock,
  type ConfirmedReservation,
  type ReservationRepository,
} from './ports';

export interface CreateReservationInput {
  readonly resourceId: string;
  readonly userId: string;
  readonly slotIds: readonly string[];
  readonly quantity?: number;
  readonly idempotencyKey?: string;
}

/**
 * Regra de negócio da reserva.
 *
 * Este caso de uso não conhece Prisma, HTTP nem NestJS além do decorator de
 * injeção: tudo que ele toca são as ports. É isso que torna as regras abaixo
 * testáveis em milissegundos, sem Docker (ADR 0009).
 *
 * O que ele NÃO faz é igualmente importante: não verifica disponibilidade
 * lendo o contador. Ler para depois escrever é exatamente a janela de corrida
 * que o ADR 0004 elimina. A decisão de "cabe ou não cabe" pertence ao banco,
 * dentro do mesmo statement que escreve.
 */
@Injectable()
export class CreateReservationUseCase {
  constructor(
    @Inject(RESERVATION_REPOSITORY)
    private readonly repository: ReservationRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AVAILABILITY_PUBLISHER)
    private readonly publisher: AvailabilityPublisher,
  ) {}

  async execute(input: CreateReservationInput): Promise<ConfirmedReservation> {
    const quantity = input.quantity ?? 1;

    if (input.idempotencyKey) {
      const existing = await this.repository.findByIdempotencyKey(
        input.userId,
        input.idempotencyKey,
      );
      if (existing) return existing;
    }

    if (input.slotIds.length === 0) {
      throw new InvalidSelectionError('Selecione ao menos um horário.');
    }

    const uniqueSlotIds = [...new Set(input.slotIds)];
    if (uniqueSlotIds.length !== input.slotIds.length) {
      throw new InvalidSelectionError('Há horários repetidos na seleção.');
    }

    const resource = await this.repository.findResource(input.resourceId);
    if (!resource) throw new ResourceNotFoundError(input.resourceId);
    if (!resource.active) throw new ResourceInactiveError(resource.id);

    if (uniqueSlotIds.length > resource.maxSlotsPerReservation) {
      throw new TooManySlotsError(
        uniqueSlotIds.length,
        resource.maxSlotsPerReservation,
      );
    }

    this.assertQuantity(quantity, resource);

    const slots = await this.repository.findSlots(uniqueSlotIds);
    if (slots.length !== uniqueSlotIds.length) {
      const found = new Set(slots.map((s) => s.id));
      throw new SlotNotFoundError(uniqueSlotIds.filter((id) => !found.has(id)));
    }

    // Invariante 7 do ADR 0003: uma reserva agrupa slots de um recurso só.
    const foreign = slots.find((slot) => slot.resourceId !== resource.id);
    if (foreign) {
      throw new InvalidSelectionError(
        'Todos os horários devem pertencer ao mesmo recurso.',
        { slotId: foreign.id, resourceId: resource.id },
      );
    }

    const now = this.clock.now();
    const past = slots.find((slot) => slot.startsAt.getTime() <= now.getTime());
    if (past) throw new SlotInPastError(past.id);

    // ORDENAÇÃO ANTI-DEADLOCK — não remover.
    //
    // Toda transação grava os slots na MESMA ordem global (startsAt
    // ascendente). Sem isso, duas reservas de intervalos que se cruzam em
    // sentidos opostos travam uma à outra e o Postgres aborta uma delas por
    // deadlock. Com ordem consistente, o ciclo é impossível por construção.
    // Ver ADR 0011 — há um teste dedicado que falha se este sort sumir.
    const ordered = [...slots].sort(
      (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
    );

    const reservation = await this.repository.confirm({
      resourceId: resource.id,
      userId: input.userId,
      quantity,
      exclusive: resource.kind === 'EXCLUSIVE',
      slots: ordered,
      idempotencyKey: input.idempotencyKey,
    });

    // APÓS o commit (ADR 0005). `confirm` só resolve quando a transação
    // fechou; publicar antes anunciaria disponibilidade sujeita a rollback.
    this.publisher.publish(
      reservation.updatedSlots.map((slot) => ({
        type: 'slot-availability-changed' as const,
        slotId: slot.slotId,
        resourceId: resource.id,
        reservedUnits: slot.reservedUnits,
        unitsPerSlot: slot.unitsPerSlot,
      })),
    );

    return reservation;
  }

  private assertQuantity(
    quantity: number,
    resource: {
      kind: string;
      maxUnitsPerUser: number;
      unitsPerSlot: number;
    },
  ): void {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new InvalidQuantityError('A quantidade deve ser um inteiro ≥ 1.', {
        quantity,
      });
    }

    if (resource.kind === 'EXCLUSIVE' && quantity !== 1) {
      throw new InvalidQuantityError(
        'Recursos de uso exclusivo aceitam apenas uma unidade por reserva.',
        { quantity },
      );
    }

    if (quantity > resource.maxUnitsPerUser) {
      throw new InvalidQuantityError(
        `Máximo de ${resource.maxUnitsPerUser} unidade(s) por usuário neste recurso.`,
        { quantity, max: resource.maxUnitsPerUser },
      );
    }
  }
}

