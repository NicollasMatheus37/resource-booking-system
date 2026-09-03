import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../../config/config.module';
import type { Env } from '../../../config/env.schema';
import { PrismaService } from '../../../database/prisma.service';
import {
  AlreadyReservedError,
  SlotUnavailableError,
} from '../domain/domain-error';
import type {
  ConfirmReservationCommand,
  ConfirmedReservation,
  ReservationRepository,
  ResourceSnapshot,
} from '../application/ports';

/**
 * Conflitos de negócio, vistos por duas lentes.
 *
 * O Prisma nem sempre repassa o SQLSTATE do Postgres: em erros de escrita pela
 * API tipada ele traduz para o código dele (`P2002`) e deixa o SQLSTATE de
 * fora, com o nome da constraint apenas no texto. Em `$executeRaw` o erro do
 * driver `pg` chega cru, com o SQLSTATE. Reconhecemos as duas formas.
 */
const PG_UNIQUE_VIOLATION = '23505';
const PG_EXCLUSION_VIOLATION = '23P01';
const PG_CHECK_VIOLATION = '23514';

const PRISMA_UNIQUE_VIOLATION = 'P2002';

const UNIQUE_PER_USER_INDEX = 'reservation_slots_one_confirmed_per_user';

@Injectable()
export class PrismaReservationRepository implements ReservationRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async findResource(resourceId: string): Promise<ResourceSnapshot | null> {
    const resource = await this.prisma.resource.findUnique({
      where: { id: resourceId },
    });
    if (!resource) return null;

    return {
      id: resource.id,
      kind: resource.kind,
      unitsPerSlot: resource.unitsPerSlot,
      maxUnitsPerUser: resource.maxUnitsPerUser,
      maxSlotsPerReservation: resource.maxSlotsPerReservation,
      active: resource.active,
    };
  }

  async findSlots(slotIds: readonly string[]) {
    const slots = await this.prisma.slot.findMany({
      where: { id: { in: [...slotIds] } },
    });

    return slots.map((slot) => ({
      id: slot.id,
      resourceId: slot.resourceId,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      unitsPerSlot: slot.unitsPerSlot,
      reservedUnits: slot.reservedUnits,
    }));
  }

  async findByIdempotencyKey(
    userId: string,
    key: string,
  ): Promise<ConfirmedReservation | null> {
    const reservation = await this.prisma.reservation.findFirst({
      where: { userId, idempotencyKey: key, status: 'CONFIRMED' },
      include: { slots: { include: { slot: true } } },
    });
    if (!reservation) return null;

    return {
      id: reservation.id,
      resourceId: reservation.resourceId,
      userId: reservation.userId,
      quantity: reservation.quantity,
      slotIds: reservation.slots.map((s) => s.slotId),
      createdAt: reservation.createdAt,
      updatedSlots: reservation.slots.map((s) => ({
        slotId: s.slotId,
        reservedUnits: s.slot.reservedUnits,
        unitsPerSlot: s.slot.unitsPerSlot,
      })),
    };
  }

  /**
   * A OPERAÇÃO CRÍTICA (ADR 0004).
   *
   * Tudo acontece numa transação curta contendo APENAS escritas no banco —
   * nenhuma chamada externa, nenhum log remoto. O evento de SSE é publicado
   * depois do commit, pelo caso de uso.
   *
   * Os slots chegam aqui já ordenados por `startsAt` pelo use-case. Essa ordem
   * é o que impede deadlock entre transações que disputam os mesmos slots em
   * sentidos opostos (ADR 0011).
   */
  async confirm(
    command: ConfirmReservationCommand,
  ): Promise<ConfirmedReservation> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Admission control: o perdedor de uma disputa falha rápido em vez de
        // segurar uma conexão do pool esperando indefinidamente.
        await tx.$executeRawUnsafe(
          `SET LOCAL lock_timeout = '${this.env.DB_LOCK_TIMEOUT_MS}ms'`,
        );
        await tx.$executeRawUnsafe(
          `SET LOCAL statement_timeout = '${this.env.DB_STATEMENT_TIMEOUT_MS}ms'`,
        );

        const updatedSlots: {
          slotId: string;
          reservedUnits: number;
          unitsPerSlot: number;
        }[] = [];

        for (const slot of command.slots) {
          // UPDATE ATÔMICO CONDICIONAL.
          //
          // A condição e a escrita acontecem no MESMO statement, sob o row
          // lock que o próprio UPDATE adquire. Não existe leitura anterior
          // para ficar obsoleta — portanto não existe janela de corrida.
          //
          // A condição é `+ quantity <=`, não `< units_per_slot`: com
          // quantidade > 1, checar apenas "sobra alguma unidade" deixaria
          // passar um pedido de 4 quando restam 2.
          const affected = await tx.$executeRaw`
            UPDATE slots
               SET reserved_units = reserved_units + ${command.quantity}
             WHERE id = ${slot.id}::uuid
               AND reserved_units + ${command.quantity} <= units_per_slot
          `;

          // rowsAffected = 0 significa que a condição falhou: não há unidades
          // suficientes. É resultado de negócio, não erro técnico.
          if (affected === 0) {
            // Antes de culpar a disputa, distinguir o caso em que o próprio
            // usuário já ocupa este slot.
            //
            // Num recurso EXCLUSIVE o contador chega ao teto com UMA reserva,
            // então o UPDATE falha antes de a constraint de unicidade ser
            // avaliada — e o usuário receberia "alguém foi mais rápido"
            // quando na verdade quem reservou foi ele mesmo. A distinção
            // importa: em ALREADY_RESERVED a contagem está correta e a tela
            // não deve reconciliar nada (ADR 0006).
            //
            // Esta leitura só acontece no caminho de FALHA, e não é a
            // garantia de nada: a constraint única continua sendo a verdade.
            const meu = await tx.reservationSlot.findFirst({
              where: {
                slotId: slot.id,
                userId: command.userId,
                status: 'CONFIRMED',
              },
              select: { reservationId: true },
            });

            throw meu
              ? new AlreadyReservedError(slot.id)
              : new SlotUnavailableError(slot.id);
          }

          const current = await tx.slot.findUniqueOrThrow({
            where: { id: slot.id },
            select: { reservedUnits: true, unitsPerSlot: true },
          });

          updatedSlots.push({
            slotId: slot.id,
            reservedUnits: current.reservedUnits,
            unitsPerSlot: current.unitsPerSlot,
          });
        }

        const reservation = await tx.reservation.create({
          data: {
            resourceId: command.resourceId,
            userId: command.userId,
            quantity: command.quantity,
            status: 'CONFIRMED',
            idempotencyKey: command.idempotencyKey ?? null,
            slots: {
              create: command.slots.map((slot) => ({
                slotId: slot.id,
                resourceId: command.resourceId,
                startsAt: slot.startsAt,
                endsAt: slot.endsAt,
                userId: command.userId,
                status: 'CONFIRMED',
                exclusive: command.exclusive,
              })),
            },
          },
        });

        return {
          id: reservation.id,
          resourceId: reservation.resourceId,
          userId: reservation.userId,
          quantity: reservation.quantity,
          slotIds: command.slots.map((s) => s.id),
          createdAt: reservation.createdAt,
          updatedSlots,
        };
      });
    } catch (error) {
      throw this.translate(error, command);
    }
  }

  /**
   * Traduz violação de constraint em erro de domínio.
   *
   * Sem isso, uma disputa perdida viraria HTTP 500 — quando na verdade é o
   * sistema funcionando exatamente como projetado. O cliente precisa
   * distinguir os dois conflitos para reagir corretamente (ADR 0006).
   */
  private translate(
    error: unknown,
    command: ConfirmReservationCommand,
  ): unknown {
    if (
      error instanceof SlotUnavailableError ||
      error instanceof AlreadyReservedError
    ) {
      return error;
    }

    const code = this.pgErrorCode(error);
    const message = this.pgErrorText(error);

    // Exclusão: outro usuário já ocupa este recurso nesta janela de tempo.
    if (code === PG_EXCLUSION_VIOLATION) {
      return new SlotUnavailableError(this.blame(message, command));
    }

    const isUniqueViolation =
      code === PG_UNIQUE_VIOLATION || code === PRISMA_UNIQUE_VIOLATION;

    if (isUniqueViolation) {
      // Este usuário já tem reserva confirmada num dos slots pedidos.
      // A contagem do slot NÃO mudou — daí o código distinto (ADR 0006).
      if (message.includes(UNIQUE_PER_USER_INDEX)) {
        return new AlreadyReservedError(this.blame(message, command));
      }
      return new SlotUnavailableError(this.blame(message, command));
    }

    // Rede de segurança do CHECK de limites — indica bug na expressão do
    // UPDATE, mas o usuário não deve ver 500 por isso.
    if (code === PG_CHECK_VIOLATION) {
      return new SlotUnavailableError(this.blame(message, command));
    }

    return error;
  }

  /** Extrai o slot culpado da mensagem do Postgres, com fallback. */
  private blame(message: string, command: ConfirmReservationCommand): string {
    const found = command.slots.find((slot) => message.includes(slot.id));
    return found?.id ?? command.slots[0]?.id ?? 'desconhecido';
  }

  /**
   * O código SQLSTATE pode estar no erro do driver `pg` ou dentro do `meta`
   * com que o Prisma o envelopa. Percorremos a cadeia de causas em vez de
   * depender do formato exato — que muda entre versões do Prisma.
   */
  private pgErrorCode(error: unknown): string | undefined {
    let current: unknown = error;

    for (let depth = 0; depth < 5 && current; depth += 1) {
      if (typeof current === 'object' && current !== null) {
        const record = current as Record<string, unknown>;

        const direct = record['code'];
        // SQLSTATE do Postgres (23505) ou código do Prisma (P2002).
        if (
          typeof direct === 'string' &&
          (/^\d{2}[\dA-Z]{3}$/.test(direct) || /^P\d{4}$/.test(direct))
        ) {
          return direct;
        }

        const meta = record['meta'];
        if (typeof meta === 'object' && meta !== null) {
          const metaCode = (meta as Record<string, unknown>)['code'];
          if (typeof metaCode === 'string') return metaCode;
        }

        current = record['cause'];
        continue;
      }
      break;
    }

    return undefined;
  }

  private pgErrorText(error: unknown): string {
    const parts: string[] = [];
    let current: unknown = error;

    for (let depth = 0; depth < 5 && current; depth += 1) {
      if (typeof current === 'object' && current !== null) {
        const record = current as Record<string, unknown>;
        if (typeof record['message'] === 'string') parts.push(record['message']);
        if (record['meta']) parts.push(JSON.stringify(record['meta']));
        if (typeof record['detail'] === 'string') parts.push(record['detail']);
        if (typeof record['constraint'] === 'string') {
          parts.push(record['constraint']);
        }
        current = record['cause'];
        continue;
      }
      break;
    }

    return parts.join(' ');
  }
}
