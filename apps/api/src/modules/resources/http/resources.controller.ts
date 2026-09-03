import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { ResourceDto, SlotDto } from '@resource-booking/contracts';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../identity/current-user.decorator';
import { ManageResourcesUseCase } from '../application/manage-resources.usecase';
import { ResourcesQuery } from '../application/resources.query';
import { CreateResourceDto, UpdateResourceDto } from './resource.dto';

@Controller('resources')
export class ResourcesController {
  constructor(
    private readonly query: ResourcesQuery,
    private readonly manage: ManageResourcesUseCase,
  ) {}

  @Get()
  listResources(
    @Query('includeInactive') includeInactive?: string,
  ): Promise<ResourceDto[]> {
    return this.query.listResources(includeInactive === 'true');
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

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateResourceDto) {
    return this.manage.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateResourceDto,
  ) {
    return this.manage.update(id, dto);
  }

  /** Desativa: `DELETE` de verdade destruiria o histórico de reservas. */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.manage.deactivate(id);
  }
}
