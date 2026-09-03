import { Module } from '@nestjs/common';
import { CreateReservationUseCase } from './application/create-reservation.usecase';
import {
  CLOCK,
  RESERVATION_REPOSITORY,
  systemClock,
} from './application/ports';
import { PrismaReservationRepository } from './infrastructure/prisma-reservation.repository';
import { ReservationsController } from './http/reservations.controller';

@Module({
  controllers: [ReservationsController],
  providers: [
    CreateReservationUseCase,
    { provide: RESERVATION_REPOSITORY, useClass: PrismaReservationRepository },
    { provide: CLOCK, useValue: systemClock },
  ],
  exports: [CreateReservationUseCase],
})
export class ReservationsModule {}
