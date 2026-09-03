import { Injectable } from '@nestjs/common';
import type { ReservationSummaryDto } from '@resource-booking/contracts';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class ReservationsQuery {
  constructor(private readonly prisma: PrismaService) {}

  async listMine(userId: string): Promise<ReservationSummaryDto[]> {
    const reservations = await this.prisma.reservation.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        resource: { select: { id: true, name: true, kind: true } },
        slots: {
          orderBy: { startsAt: 'asc' },
          select: { slotId: true, startsAt: true, endsAt: true },
        },
      },
    });

    return reservations.map((r) => ({
      id: r.id,
      status: r.status,
      quantity: r.quantity,
      createdAt: r.createdAt.toISOString(),
      resource: r.resource,
      slots: r.slots.map((s) => ({
        id: s.slotId,
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
      })),
    }));
  }
}
