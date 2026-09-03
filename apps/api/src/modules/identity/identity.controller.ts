import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Public } from './public.decorator';

/**
 * Lista os usuários do seed para o seletor do dashboard (ADR 0008).
 * Público porque é o que permite escolher uma identidade — é o análogo da
 * tela de login neste MVP.
 */
@Controller('users')
export class IdentityController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  list() {
    return this.prisma.user.findMany({
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });
  }
}
