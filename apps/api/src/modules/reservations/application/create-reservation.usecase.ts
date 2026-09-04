import { Inject, Injectable } from '@nestjs/common';
import {
  DomainError,
  InvalidQuantityError,
  InvalidSelectionError,
  ResourceInactiveError,
  ResourceNotFoundError,
  SlotInPastError,
  SlotNotFoundError,
  TooManySlotsError,
} from '../domain/domain-error';
import { groupContiguous } from '../domain/contiguous-blocks';
import {
  AVAILABILITY_PUBLISHER,
  CLOCK,
  RESERVATION_REPOSITORY,
  type AvailabilityPublisher,
  type Clock,
  type ConfirmedReservation,
  type ReservationRepository,
  type SlotSnapshot,
} from './ports';

export interface CreateReservationInput {
  readonly resourceId: string;
  readonly userId: string;
  readonly slotIds: readonly string[];
  readonly quantity?: number;
  readonly idempotencyKey?: string;
}

export interface RejectedBlockResult {
  readonly slotIds: readonly string[];
  readonly code: string;
  readonly message: string;
}

export interface CreateReservationResult {
  readonly created: readonly ConfirmedReservation[];
  readonly rejected: readonly RejectedBlockResult[];
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
 *
 * Uma seleção com lacunas vira VÁRIAS reservas, uma por bloco contíguo
 * (ADR 0011). Cada bloco é atômico por si; blocos diferentes são
 * independentes, e por isso o resultado pode ser parcial.
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

  async execute(input: CreateReservationInput): Promise<CreateReservationResult> {
    const quantity = input.quantity ?? 1;

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

    // Os blocos saem ordenados por início, e os slots dentro de cada bloco
    // também. ESSA ORDENAÇÃO É ANTI-DEADLOCK — não remover.
    //
    // Toda transação grava os slots na mesma ordem global. Sem isso, duas
    // reservas de intervalos que se cruzam em sentidos opostos travam uma à
    // outra e o Postgres aborta uma delas. Ver ADR 0011: há um teste dedicado
    // que falha se a ordenação sumir.
    const blocos = groupContiguous(slots);

    const created: ConfirmedReservation[] = [];
    const rejected: RejectedBlockResult[] = [];

    for (const bloco of blocos) {
      const resultado = await this.reserveBlock(
        bloco,
        resource,
        quantity,
        input,
      );

      if ('error' in resultado) rejected.push(resultado.error);
      else created.push(resultado.reservation);
    }

    // APÓS o commit de cada bloco (ADR 0005). Um único lote de eventos, para
    // que a tela dos outros usuários reconcilie uma vez só.
    const deltas = created.flatMap((reservation) =>
      reservation.updatedSlots.map((slot) => ({
        type: 'slot-availability-changed' as const,
        slotId: slot.slotId,
        resourceId: resource.id,
        reservedUnits: slot.reservedUnits,
        unitsPerSlot: slot.unitsPerSlot,
      })),
    );
    if (deltas.length > 0) this.publisher.publish(deltas);

    return { created, rejected };
  }

  private async reserveBlock(
    bloco: readonly SlotSnapshot[],
    resource: { id: string; kind: string; maxSlotsPerReservation: number },
    quantity: number,
    input: CreateReservationInput,
  ): Promise<
    { reservation: ConfirmedReservation } | { error: RejectedBlockResult }
  > {
    const slotIds = bloco.map((s) => s.id);

    try {
      // O limite de horários por reserva agora vale POR BLOCO: cada bloco é
      // uma reserva, e é a reserva que tem teto.
      if (bloco.length > resource.maxSlotsPerReservation) {
        throw new TooManySlotsError(
          bloco.length,
          resource.maxSlotsPerReservation,
        );
      }

      const now = this.clock.now();
      const past = bloco.find(
        (slot) => slot.startsAt.getTime() <= now.getTime(),
      );
      if (past) throw new SlotInPastError(past.id);

      // Chave por bloco: um retry de rede precisa reencontrar a reserva
      // daquele bloco especificamente, não a do primeiro.
      const idempotencyKey = input.idempotencyKey
        ? `${input.idempotencyKey}:${slotIds[0]}`
        : undefined;

      if (idempotencyKey) {
        const existing = await this.repository.findByIdempotencyKey(
          input.userId,
          idempotencyKey,
        );
        if (existing) return { reservation: existing };
      }

      const reservation = await this.repository.confirm({
        resourceId: resource.id,
        userId: input.userId,
        quantity,
        exclusive: resource.kind === 'EXCLUSIVE',
        slots: bloco,
        idempotencyKey,
      });

      return { reservation };
    } catch (error) {
      // Falha de UM bloco não derruba os outros: eles são reservas
      // independentes. Erro técnico continua subindo.
      if (error instanceof DomainError) {
        return {
          error: { slotIds, code: error.code, message: error.message },
        };
      }
      throw error;
    }
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
