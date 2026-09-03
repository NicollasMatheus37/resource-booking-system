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
} from '@nestjs/common';
import type {
  ReservationDto,
  ReservationSummaryDto,
} from '@resource-booking/contracts';
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

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateReservationDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<ReservationDto> {
    const reservation = await this.createReservation.execute({
      resourceId: dto.resourceId,
      userId: user.id,
      slotIds: dto.slotIds,
      quantity: dto.quantity,
      idempotencyKey: idempotencyKey || undefined,
    });

    return {
      id: reservation.id,
      resourceId: reservation.resourceId,
      userId: reservation.userId,
      quantity: reservation.quantity,
      status: 'CONFIRMED',
      slotIds: [...reservation.slotIds],
      createdAt: reservation.createdAt.toISOString(),
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
