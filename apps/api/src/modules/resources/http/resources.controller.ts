import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import type { ResourceDto, SlotDto } from '@resource-booking/contracts';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../identity/current-user.decorator';
import { ResourcesQuery } from '../application/resources.query';

@Controller('resources')
export class ResourcesController {
  constructor(private readonly query: ResourcesQuery) {}

  @Get()
  listResources(): Promise<ResourceDto[]> {
    return this.query.listResources();
  }

  @Get(':id/slots')
  listSlots(
    @Param('id', ParseUUIDPipe) resourceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<SlotDto[]> {
    return this.query.listSlots(resourceId, user.id, { from, to });
  }
}
