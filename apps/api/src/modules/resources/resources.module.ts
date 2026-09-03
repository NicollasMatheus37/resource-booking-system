import { Module } from '@nestjs/common';
import { ResourcesQuery } from './application/resources.query';
import { ResourcesController } from './http/resources.controller';

@Module({
  controllers: [ResourcesController],
  providers: [ResourcesQuery],
})
export class ResourcesModule {}
