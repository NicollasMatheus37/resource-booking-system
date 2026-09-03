import {
  FakeReservationRepository,
  aResource,
  aSharedResource,
  slotSequence,
} from '@resource-booking/testing';
import { CreateReservationUseCase } from './create-reservation.usecase';
import type { Clock, ReservationRepository } from './ports';

const NOW = new Date('2026-09-05T08:00:00.000Z');
const clock: Clock = { now: () => NOW };

function build(
  resources = [aResource()],
  slots = slotSequence(4),
): { useCase: CreateReservationUseCase; repo: FakeReservationRepository } {
  const repo = new FakeReservationRepository(resources, slots);
  const useCase = new CreateReservationUseCase(
    repo as unknown as ReservationRepository,
    clock,
  );
  return { useCase, repo };
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

      expect(result.slotIds).toEqual(['slot-1']);
      expect(result.quantity).toBe(1);
    });

    it('reserva 4 slots em sequência — as 2h do ADR 0011', async () => {
      const { useCase } = build();

      const result = await useCase.execute({
        resourceId: 'resource-1',
        userId: 'user-1',
        slotIds: ['slot-1', 'slot-2', 'slot-3', 'slot-4'],
      });

      expect(result.slotIds).toHaveLength(4);
    });

    it('aceita seleção não-contígua', async () => {
      const { useCase } = build();

      const result = await useCase.execute({
        resourceId: 'resource-1',
        userId: 'user-1',
        slotIds: ['slot-1', 'slot-4'],
      });

      expect(result.slotIds).toEqual(['slot-1', 'slot-4']);
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

    it('recusa slot no passado', async () => {
      const passado = slotSequence(1, {
        start: new Date('2026-09-05T07:00:00.000Z'),
      });
      const { useCase } = build([aResource()], passado);

      await expect(
        useCase.execute({
          resourceId: 'resource-1',
          userId: 'user-1',
          slotIds: ['slot-1'],
        }),
      ).rejects.toMatchObject({ code: 'SLOT_IN_PAST' });
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

    it('recusa mais slots que maxSlotsPerReservation', async () => {
      const { useCase } = build(
        [aResource({ maxSlotsPerReservation: 2 })],
        slotSequence(4),
      );

      await expect(
        useCase.execute({
          resourceId: 'resource-1',
          userId: 'user-1',
          slotIds: ['slot-1', 'slot-2', 'slot-3'],
        }),
      ).rejects.toMatchObject({ code: 'TOO_MANY_SLOTS' });
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

      expect(result.quantity).toBe(4);
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

      expect(second.id).toBe(first.id);
      expect(repo.confirmed).toHaveLength(1);
    });
  });
});
