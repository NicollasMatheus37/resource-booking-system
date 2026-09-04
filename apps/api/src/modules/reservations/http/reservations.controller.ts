import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type {
  CreateReservationResponse,
  ReservationSummaryDto,
} from '@resource-booking/contracts';
import type { Response } from 'express';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../identity/current-user.decorator';
import { CancelReservationUseCase } from '../application/cancel-reservation.usecase';
import { CreateReservationUseCase } from '../application/create-reservation.usecase';
import { CreateReservationDto } from './create-reservation.dto';
import { ReservationsQuery } from './reservations.query';

@Controller('reservations')
export class ReservationsController {
  constructor(
    private readonly createReservation: CreateReservationUseCase,
    private readonly cancelReservation: CancelReservationUseCase,
    private readonly query: ReservationsQuery,
  ) {}

  @Get()
  listMine(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReservationSummaryDto[]> {
    return this.query.listMine(user.id);
  }

  /**
   * Cria uma reserva por bloco contíguo da seleção (ADR 0011).
   *
   * O resultado pode ser PARCIAL: cada bloco é atômico por si, mas blocos
   * diferentes são reservas independentes. O status reflete isso —
   * `201` tudo criado, `207` parte criada, `409` nada criado. O corpo tem o
   * mesmo formato nos três casos, para que o cliente decida sempre pelo
   * mesmo caminho (ADR 0006).
   */
  @Post()
  async create(
    @Body() dto: CreateReservationDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<CreateReservationResponse> {
    const { created, rejected } = await this.createReservation.execute({
      resourceId: dto.resourceId,
      userId: user.id,
      slotIds: dto.slotIds,
      quantity: dto.quantity,
      idempotencyKey: idempotencyKey || undefined,
    });

    response.status(
      created.length === 0
        ? HttpStatus.CONFLICT
        : rejected.length === 0
          ? HttpStatus.CREATED
          : HttpStatus.MULTI_STATUS,
    );

    return {
      created: created.map((reservation) => ({
        id: reservation.id,
        resourceId: reservation.resourceId,
        userId: reservation.userId,
        quantity: reservation.quantity,
        status: 'CONFIRMED' as const,
        slotIds: [...reservation.slotIds],
        createdAt: reservation.createdAt.toISOString(),
      })),
      rejected: rejected.map((block) => ({
        slotIds: [...block.slotIds],
        code: block.code,
        message: block.message,
      })),
    };
  }

  /**
   * Cancelar é IDEMPOTENTE: repetir devolve 200 com `changed: false` em vez de
   * erro. Cancelar duas vezes é uma coisa razoável de o usuário fazer, e o
   * resultado desejado já é o vigente.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ id: string; status: 'CANCELLED'; changed: boolean }> {
    const result = await this.cancelReservation.execute(id, user.id);
    return { id: result.id, status: 'CANCELLED', changed: result.changed };
  }
}
