import { Module } from '@nestjs/common';
import { ManageResourcesUseCase } from './application/manage-resources.usecase';
import { ResourcesQuery } from './application/resources.query';
import { ResourcesController } from './http/resources.controller';

@Module({
  controllers: [ResourcesController],
  providers: [ResourcesQuery, ManageResourcesUseCase],
})
export class ResourcesModule {}
