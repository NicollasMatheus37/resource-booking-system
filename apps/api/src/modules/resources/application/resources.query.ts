import { Injectable } from '@nestjs/common';
import type { ResourceDto, SlotDto } from '@resource-booking/contracts';
import { PrismaService } from '../../../database/prisma.service';

/**
 * Leituras do dashboard.
 *
 * Separado do caso de uso de escrita de propósito: consultas não têm invariante
 * a proteger e não precisam da cerimônia de ports e domínio. Forçar tudo pelo
 * mesmo caminho adicionaria camada sem adicionar segurança.
 */
@Injectable()
export class ResourcesQuery {
  constructor(private readonly prisma: PrismaService) {}

  async listResources(includeInactive = false): Promise<ResourceDto[]> {
    const resources = await this.prisma.resource.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });

    return resources.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      kind: r.kind,
      unitsPerSlot: r.unitsPerSlot,
      maxUnitsPerUser: r.maxUnitsPerUser,
      maxSlotsPerReservation: r.maxSlotsPerReservation,
      seats: r.seats,
      active: r.active,
    }));
  }

  async listSlots(
    resourceId: string,
    userId: string,
    range: { from?: string; to?: string },
  ): Promise<SlotDto[]> {
    const from = range.from ? new Date(range.from) : new Date();
    const to = range.to
      ? new Date(range.to)
      : new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);

    const slots = await this.prisma.slot.findMany({
      where: { resourceId, startsAt: { gte: from, lt: to } },
      orderBy: { startsAt: 'asc' },
      include: {
        reservationSlots: {
          where: { userId, status: 'CONFIRMED' },
          select: { reservationId: true },
        },
      },
    });

    return slots.map((slot) => ({
      id: slot.id,
      resourceId: slot.resourceId,
      startsAt: slot.startsAt.toISOString(),
      endsAt: slot.endsAt.toISOString(),
      unitsPerSlot: slot.unitsPerSlot,
      reservedUnits: slot.reservedUnits,
      availableUnits: slot.unitsPerSlot - slot.reservedUnits,
      reservedByMe: slot.reservationSlots.length > 0,
    }));
  }
}
