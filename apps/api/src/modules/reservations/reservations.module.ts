import { Module } from '@nestjs/common';
import { CancelReservationUseCase } from './application/cancel-reservation.usecase';
import { CreateReservationUseCase } from './application/create-reservation.usecase';
import {
  CLOCK,
  RESERVATION_REPOSITORY,
  systemClock,
} from './application/ports';
import { PrismaReservationRepository } from './infrastructure/prisma-reservation.repository';
import { ReservationsController } from './http/reservations.controller';
import { ReservationsQuery } from './http/reservations.query';

@Module({
  controllers: [ReservationsController],
  providers: [
    CreateReservationUseCase,
    CancelReservationUseCase,
    ReservationsQuery,
    { provide: RESERVATION_REPOSITORY, useClass: PrismaReservationRepository },
    { provide: CLOCK, useValue: systemClock },
  ],
  exports: [CreateReservationUseCase, CancelReservationUseCase],
})
export class ReservationsModule {}
