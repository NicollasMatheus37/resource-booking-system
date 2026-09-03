import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import type { ReservationDto } from '@resource-booking/contracts';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../identity/current-user.decorator';
import { CreateReservationUseCase } from '../application/create-reservation.usecase';
import { CreateReservationDto } from './create-reservation.dto';

@Controller('reservations')
export class ReservationsController {
  constructor(private readonly createReservation: CreateReservationUseCase) {}

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
}
