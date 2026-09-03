import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateResourceRequest,
  UpdateResourceRequest,
} from '@resource-booking/contracts';
import { ENV } from '../../../config/config.module';
import type { Env } from '../../../config/env.schema';
import { PrismaService } from '../../../database/prisma.service';
import {
  InvalidResourceConfigError,
  ResourceNotFoundError,
} from '../../reservations/domain/domain-error';
import { generateSchedule } from '../domain/schedule';

/**
 * Cadastro de recursos.
 *
 * As mesmas invariantes que o banco impõe por CHECK são validadas aqui, com
 * mensagem legível. Não é duplicação inútil: o CHECK protege contra qualquer
 * escrita, inclusive manual; a validação aqui existe para o usuário entender o
 * que errou, em vez de receber um erro de constraint.
 */
@Injectable()
export class ManageResourcesUseCase {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async create(input: CreateResourceRequest) {
    this.assertConfig(input);

    return this.prisma.$transaction(async (tx) => {
      const resource = await tx.resource.create({
        data: {
          name: input.name.trim(),
          description: input.description?.trim() || null,
          kind: input.kind,
          unitsPerSlot: input.unitsPerSlot,
          maxUnitsPerUser: input.maxUnitsPerUser,
          maxSlotsPerReservation: input.maxSlotsPerReservation,
          seats: input.seats ?? null,
        },
      });

      // A agenda é gerada junto: um recurso sem slots não é reservável, e
      // deixar isso como passo separado convida ao esquecimento.
      const janelas = generateSchedule(new Date(), {
        slotMinutes: this.env.SLOT_DURATION_MINUTES,
        horizonDays: this.env.SCHEDULE_HORIZON_DAYS,
      });

      await tx.slot.createMany({
        data: janelas.map((janela) => ({
          resourceId: resource.id,
          startsAt: janela.startsAt,
          endsAt: janela.endsAt,
          unitsPerSlot: resource.unitsPerSlot,
        })),
      });

      return resource;
    });
  }

  async update(id: string, input: UpdateResourceRequest) {
    const existente = await this.prisma.resource.findUnique({ where: { id } });
    if (!existente) throw new ResourceNotFoundError(id);

    // `kind` e `unitsPerSlot` são IMUTÁVEIS por decisão explícita.
    //
    // Reduzir `unitsPerSlot` com reservas confirmadas deixaria slots acima da
    // nova capacidade — um overbooking criado por edição de cadastro, que é
    // exatamente o que o resto do sistema existe para impedir. Aumentar seria
    // seguro, mas a assimetria confunde mais do que ajuda. Para mudar a
    // capacidade, cria-se outro recurso e desativa-se este.
    if (
      input.maxUnitsPerUser !== undefined &&
      input.maxUnitsPerUser > existente.unitsPerSlot
    ) {
      throw new InvalidResourceConfigError(
        `maxUnitsPerUser não pode exceder as ${existente.unitsPerSlot} unidade(s) do slot.`,
        { maxUnitsPerUser: input.maxUnitsPerUser },
      );
    }

    if (existente.kind === 'EXCLUSIVE' && input.maxUnitsPerUser !== undefined) {
      if (input.maxUnitsPerUser !== 1) {
        throw new InvalidResourceConfigError(
          'Recursos de uso exclusivo aceitam apenas uma unidade por usuário.',
        );
      }
    }

    return this.prisma.resource.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined
          ? { description: input.description?.trim() || null }
          : {}),
        ...(input.maxUnitsPerUser !== undefined
          ? { maxUnitsPerUser: input.maxUnitsPerUser }
          : {}),
        ...(input.maxSlotsPerReservation !== undefined
          ? { maxSlotsPerReservation: input.maxSlotsPerReservation }
          : {}),
        ...(input.seats !== undefined ? { seats: input.seats } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });
  }

  /**
   * Desativa em vez de apagar.
   *
   * `DELETE` de verdade cascatearia para slots e reservas, destruindo o
   * histórico de quem reservou. Desativar tira o recurso da lista e impede
   * novas reservas (regra 5 do ADR 0003) sem apagar nada.
   */
  async deactivate(id: string) {
    const existente = await this.prisma.resource.findUnique({ where: { id } });
    if (!existente) throw new ResourceNotFoundError(id);

    return this.prisma.resource.update({
      where: { id },
      data: { active: false },
    });
  }

  private assertConfig(input: CreateResourceRequest): void {
    if (!input.name?.trim()) {
      throw new InvalidResourceConfigError('O nome é obrigatório.');
    }

    if (input.kind === 'EXCLUSIVE') {
      if (input.unitsPerSlot !== 1 || input.maxUnitsPerUser !== 1) {
        throw new InvalidResourceConfigError(
          'Uso exclusivo significa uma unidade por slot e por usuário.',
          {
            unitsPerSlot: input.unitsPerSlot,
            maxUnitsPerUser: input.maxUnitsPerUser,
          },
        );
      }
    }

    if (input.unitsPerSlot < 1) {
      throw new InvalidResourceConfigError('unitsPerSlot deve ser ≥ 1.');
    }

    if (input.maxUnitsPerUser < 1) {
      throw new InvalidResourceConfigError('maxUnitsPerUser deve ser ≥ 1.');
    }

    if (input.maxUnitsPerUser > input.unitsPerSlot) {
      throw new InvalidResourceConfigError(
        'maxUnitsPerUser não pode exceder unitsPerSlot.',
      );
    }

    if (input.maxSlotsPerReservation < 1) {
      throw new InvalidResourceConfigError(
        'maxSlotsPerReservation deve ser ≥ 1.',
      );
    }
  }
}
