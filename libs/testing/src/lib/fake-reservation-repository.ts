import type { ResourceLike, SlotLike } from './builders';

interface ConfirmCommandLike {
  resourceId: string;
  userId: string;
  quantity: number;
  exclusive: boolean;
  slots: readonly SlotLike[];
  idempotencyKey?: string;
}

/**
 * Repositório em memória para os testes UNITÁRIOS do use-case.
 *
 * Atenção ao que este fake NÃO faz: ele não simula MVCC, row lock nem
 * constraint de exclusão. Ele existe para testar as regras que independem do
 * banco (slot no passado, recurso inativo, quantidade, limite de slots).
 *
 * Concorrência NÃO se testa aqui — um fake passaria com uma implementação
 * incorreta. Isso é responsabilidade dos testes de integração com Postgres
 * real (ADR 0009).
 */
export class FakeReservationRepository {
  readonly confirmed: ConfirmCommandLike[] = [];

  constructor(
    private readonly resources: ResourceLike[] = [],
    private readonly slots: SlotLike[] = [],
  ) {}

  async findResource(resourceId: string) {
    return this.resources.find((r) => r.id === resourceId) ?? null;
  }

  async findSlots(slotIds: readonly string[]) {
    return this.slots.filter((s) => slotIds.includes(s.id));
  }

  async findByIdempotencyKey(userId: string, key: string) {
    const found = this.confirmed.find(
      (c) => c.userId === userId && c.idempotencyKey === key,
    );
    return found ? this.toReservation(found) : null;
  }

  async confirm(command: ConfirmCommandLike) {
    this.confirmed.push(command);
    return this.toReservation(command);
  }

  /** Ordem em que os slots chegaram ao adapter — prova o sort anti-deadlock. */
  get lastConfirmedSlotOrder(): string[] {
    const last = this.confirmed.at(-1);
    return last ? last.slots.map((s) => s.id) : [];
  }

  private toReservation(command: ConfirmCommandLike) {
    return {
      id: `reservation-${this.confirmed.length}`,
      resourceId: command.resourceId,
      userId: command.userId,
      quantity: command.quantity,
      slotIds: command.slots.map((s) => s.id),
      createdAt: new Date('2026-09-04T00:00:00.000Z'),
      updatedSlots: command.slots.map((s) => ({
        slotId: s.id,
        reservedUnits: s.reservedUnits + command.quantity,
        unitsPerSlot: s.unitsPerSlot,
      })),
    };
  }
}
