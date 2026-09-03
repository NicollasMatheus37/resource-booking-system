import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { IdentityGuard } from './identity.guard';
import { IdentityController } from './identity.controller';

@Module({
  controllers: [IdentityController],
  providers: [{ provide: APP_GUARD, useClass: IdentityGuard }],
})
export class IdentityModule {}
