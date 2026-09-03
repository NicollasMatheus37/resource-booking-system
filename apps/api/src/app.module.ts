import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { IdentityModule } from './modules/identity/identity.module';
import { ReservationsModule } from './modules/reservations/reservations.module';
import { ResourcesModule } from './modules/resources/resources.module';
import { HealthModule } from './shared/health/health.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    IdentityModule,
    HealthModule,
    ResourcesModule,
    ReservationsModule,
  ],
})
export class AppModule {}
