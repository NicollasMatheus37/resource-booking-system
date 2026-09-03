import { Global, Module } from '@nestjs/common';
import { AVAILABILITY_PUBLISHER } from '../../modules/reservations/application/ports';
import { InMemoryAvailabilityPublisher } from './availability.publisher';
import { RealtimeController } from './realtime.controller';

@Global()
@Module({
  controllers: [RealtimeController],
  providers: [
    InMemoryAvailabilityPublisher,
    {
      provide: AVAILABILITY_PUBLISHER,
      useExisting: InMemoryAvailabilityPublisher,
    },
  ],
  exports: [InMemoryAvailabilityPublisher, AVAILABILITY_PUBLISHER],
})
export class RealtimeModule {}
