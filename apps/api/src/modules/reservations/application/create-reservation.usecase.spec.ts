import {
  FakeReservationRepository,
  aResource,
  aSharedResource,
  slotSequence,
} from '@resource-booking/testing';
import { CreateReservationUseCase } from './create-reservation.usecase';
import type {
  AvailabilityPublisher,
  Clock,
  ReservationRepository,
} from './ports';
import type { SlotAvailabilityChanged } from '@resource-booking/contracts';

const NOW = new Date('2026-09-05T08:00:00.000Z');
const clock: Clock = { now: () => NOW };

class RecordingPublisher implements AvailabilityPublisher {
  readonly batches: (readonly SlotAvailabilityChanged[])[] = [];

  publish(events: readonly SlotAvailabilityChanged[]): void {
    this.batches.push(events);
  }
}

function build(
  resources = [aResource()],
  slots = slotSequence(4),
): {
  useCase: CreateReservationUseCase;
  repo: FakeReservationRepository;
  publisher: RecordingPublisher;
} {
  const repo = new FakeReservationRepository(resources, slots);
  const publisher = new RecordingPublisher();
  const useCase = new CreateReservationUseCase(
    repo as unknown as ReservationRepository,
    clock,
    publisher,
  );
  return { useCase, repo, publisher };
}

describe('CreateReservationUseCase', () => {
  describe('caminho feliz', () => {
    it('reserva um único slot', async () => {
      const { useCase } = build();

      const result = await useCase.execute({
        resourceId: 'resource-1',
        userId: 'user-1',
        slotIds: ['slot-1'],
      });

      expect(result.created).toHaveLength(1);
      expect(result.created[0].slotIds).toEqual(['slot-1']);
      expect(result.created[0].quantity).toBe(1);
      expect(result.rejected).toEqual([]);
    });

    it('reserva 4 slots em sequência — as 2h do ADR 0011', async () => {
      const { useCase } = build();

      const result = await useCase.execute({
        resourceId: 'resource-1',
        userId: 'user-1',
        slotIds: ['slot-1', 'slot-2', 'slot-3', 'slot-4'],
      });

      // Contíguos: UMA reserva com os quatro horários.
      expect(result.created).toHaveLength(1);
      expect(result.created[0].slotIds).toHaveLength(4);
    });

    it('seleção não-contígua produz UMA RESERVA POR BLOCO (ADR 0011)', async () => {
      const { useCase } = build();

      const result = await useCase.execute({
        resourceId: 'resource-1',
        userId: 'user-1',
        slotIds: ['slot-1', 'slot-4'],
      });

      // Duas reservas independentes, cada uma cancelável sozinha.
      expect(result.created).toHaveLength(2);
      expect(result.created[0].slotIds).toEqual(['slot-1']);
      expect(result.created[1].slotIds).toEqual(['slot-4']);
      expect(result.rejected).toEqual([]);
    });

    it('agrupa blocos mistos: dois contíguos + um avulso', async () => {
      const { useCase } = build();

      const result = await useCase.execute({
        resourceId: 'resource-1',
        userId: 'user-1',
        slotIds: ['slot-1', 'slot-2', 'slot-4'],
      });

      expect(result.created).toHaveLength(2);
      expect(result.created[0].slotIds).toEqual(['slot-1', 'slot-2']);
      expect(result.created[1].slotIds).toEqual(['slot-4']);
    });
  });

  describe('ordenação anti-deadlock (ADR 0011)', () => {
    it('entrega os slots ao adapter ordenados por startsAt, não na ordem do cliente', async () => {
      const { useCase, repo } = build();

      await useCase.execute({
        resourceId: 'resource-1',
        userId: 'user-1',
        slotIds: ['slot-4', 'slot-1', 'slot-3', 'slot-2'],
      });

      expect(repo.lastConfirmedSlotOrder).toEqual([
        'slot-1',
        'slot-2',
        'slot-3',
        'slot-4',
      ]);
    });

    it('mantém a ordem mesmo quando o cliente envia em ordem decrescente', async () => {
      const { useCase, repo } = build();

      await useCase.execute({
        resourceId: 'resource-1',
        userId: 'user-1',
        slotIds: ['slot-3', 'slot-2'],
      });

      expect(repo.lastConfirmedSlotOrder).toEqual(['slot-2', 'slot-3']);
    });
  });

  describe('regras de domínio', () => {
    it('recusa seleção vazia', async () => {
      const { useCase } = build();

      await expect(
        useCase.execute({
          resourceId: 'resource-1',
          userId: 'user-1',
          slotIds: [],
        }),
      ).rejects.toMatchObject({ code: 'INVALID_SELECTION' });
    });

    it('recusa slots repetidos', async () => {
      const { useCase } = build();

      await expect(
        useCase.execute({
          resourceId: 'resource-1',
          userId: 'user-1',
          slotIds: ['slot-1', 'slot-1'],
        }),
      ).rejects.toMatchObject({ code: 'INVALID_SELECTION' });
    });

    it('recusa recurso inativo', async () => {
      const { useCase } = build([aResource({ active: false })]);

      await expect(
        useCase.execute({
          resourceId: 'resource-1',
          userId: 'user-1',
          slotIds: ['slot-1'],
        }),
      ).rejects.toMatchObject({ code: 'RESOURCE_INACTIVE' });
    });

    it('recusa recurso inexistente', async () => {
      const { useCase } = build();

      await expect(
        useCase.execute({
          resourceId: 'fantasma',
          userId: 'user-1',
          slotIds: ['slot-1'],
        }),
      ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    });

    it('recusa slot inexistente', async () => {
      const { useCase } = build();

      await expect(
        useCase.execute({
          resourceId: 'resource-1',
          userId: 'user-1',
          slotIds: ['slot-1', 'fantasma'],
        }),
      ).rejects.toMatchObject({ code: 'SLOT_NOT_FOUND' });
    });

    it('rejeita o bloco com slot no passado', async () => {
      const passado = slotSequence(1, {
        start: new Date('2026-09-05T07:00:00.000Z'),
      });
      const { useCase } = build([aResource()], passado);

      const result = await useCase.execute({
        resourceId: 'resource-1',
        userId: 'user-1',
        slotIds: ['slot-1'],
      });

      expect(result.created).toEqual([]);
      expect(result.rejected[0].code).toBe('SLOT_IN_PAST');
    });

    it('recusa slot de outro recurso na mesma reserva', async () => {
      const slots = [
        ...slotSequence(1),
        ...slotSequence(1, { resourceId: 'resource-2' }).map((s) => ({
          ...s,
          id: 'slot-outro',
        })),
      ];
      const { useCase } = build([aResource()], slots);

      await expect(
        useCase.execute({
          resourceId: 'resource-1',
          userId: 'user-1',
          slotIds: ['slot-1', 'slot-outro'],
        }),
      ).rejects.toMatchObject({ code: 'INVALID_SELECTION' });
    });

    it('rejeita o BLOCO que excede maxSlotsPerReservation', async () => {
      const { useCase } = build(
        [aResource({ maxSlotsPerReservation: 2 })],
        slotSequence(4),
      );

      const result = await useCase.execute({
        resourceId: 'resource-1',
        userId: 'user-1',
        slotIds: ['slot-1', 'slot-2', 'slot-3'],
      });

      // O limite vale por reserva, e cada bloco é uma reserva.
      expect(result.created).toEqual([]);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].code).toBe('TOO_MANY_SLOTS');
    });

    it('um bloco inválido não derruba os outros', async () => {
      const { useCase } = build(
        [aResource({ maxSlotsPerReservation: 2 })],
        slotSequence(6),
      );

      const result = await useCase.execute({
        resourceId: 'resource-1',
        userId: 'user-1',
        // Bloco A tem 3 slots (excede); bloco B tem 1 (cabe).
        slotIds: ['slot-1', 'slot-2', 'slot-3', 'slot-6'],
      });

      expect(result.created).toHaveLength(1);
      expect(result.created[0].slotIds).toEqual(['slot-6']);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].slotIds).toEqual([
        'slot-1',
        'slot-2',
        'slot-3',
      ]);
    });
  });

  describe('quantidade', () => {
    it('recusa quantidade > 1 em recurso EXCLUSIVE', async () => {
      const { useCase } = build();

      await expect(
        useCase.execute({
          resourceId: 'resource-1',
          userId: 'user-1',
          slotIds: ['slot-1'],
          quantity: 2,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_QUANTITY' });
    });

    it('aceita quantidade > 1 em recurso SHARED', async () => {
      const { useCase } = build(
        [aSharedResource()],
        slotSequence(4, { unitsPerSlot: 30 }),
      );

      const result = await useCase.execute({
        resourceId: 'resource-1',
        userId: 'user-1',
        slotIds: ['slot-1'],
        quantity: 4,
      });

      expect(result.created[0].quantity).toBe(4);
    });

    it('recusa quantidade acima de maxUnitsPerUser', async () => {
      const { useCase } = build(
        [aSharedResource({ maxUnitsPerUser: 2 })],
        slotSequence(4, { unitsPerSlot: 30 }),
      );

      await expect(
        useCase.execute({
          resourceId: 'resource-1',
          userId: 'user-1',
          slotIds: ['slot-1'],
          quantity: 3,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_QUANTITY' });
    });

    it('recusa quantidade não inteira', async () => {
      const { useCase } = build(
        [aSharedResource()],
        slotSequence(4, { unitsPerSlot: 30 }),
      );

      await expect(
        useCase.execute({
          resourceId: 'resource-1',
          userId: 'user-1',
          slotIds: ['slot-1'],
          quantity: 1.5,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_QUANTITY' });
    });
  });

  describe('publicação de disponibilidade (ADR 0005)', () => {
    it('publica um delta por slot reservado', async () => {
      const { useCase, publisher } = build();

      await useCase.execute({
        resourceId: 'resource-1',
        userId: 'user-1',
        slotIds: ['slot-1', 'slot-2'],
      });

      expect(publisher.batches).toHaveLength(1);
      expect(publisher.batches[0]).toEqual([
        {
          type: 'slot-availability-changed',
          slotId: 'slot-1',
          resourceId: 'resource-1',
          reservedUnits: 1,
          unitsPerSlot: 1,
        },
        {
          type: 'slot-availability-changed',
          slotId: 'slot-2',
          resourceId: 'resource-1',
          reservedUnits: 1,
          unitsPerSlot: 1,
        },
      ]);
    });

    it('não publica quando a reserva é recusada', async () => {
      const { useCase, publisher } = build([aResource({ active: false })]);

      await expect(
        useCase.execute({
          resourceId: 'resource-1',
          userId: 'user-1',
          slotIds: ['slot-1'],
        }),
      ).rejects.toBeDefined();

      expect(publisher.batches).toHaveLength(0);
    });
  });

  describe('idempotência', () => {
    it('retorna a reserva existente em vez de criar outra', async () => {
      const { useCase, repo } = build();

      const first = await useCase.execute({
        resourceId: 'resource-1',
        userId: 'user-1',
        slotIds: ['slot-1'],
        idempotencyKey: 'chave-1',
      });
      const second = await useCase.execute({
        resourceId: 'resource-1',
        userId: 'user-1',
        slotIds: ['slot-1'],
        idempotencyKey: 'chave-1',
      });

      expect(second.created[0].id).toBe(first.created[0].id);
      expect(repo.confirmed).toHaveLength(1);
    });
  });
});
