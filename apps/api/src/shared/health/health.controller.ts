import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Public } from '../../modules/identity/public.decorator';

/**
 * 12-Factor IX — Descartabilidade.
 *
 * `/health` (liveness) responde se o processo está vivo e NÃO consulta
 * dependências: um banco lento derrubaria o container sem necessidade.
 *
 * `/ready` (readiness) responde se o processo pode receber tráfego, e por isso
 * verifica o banco.
 */
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('health')
  liveness() {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  async readiness() {
    try {
      await this.prisma.ping();
    } catch {
      throw new ServiceUnavailableException('Banco indisponível.');
    }
    return { status: 'ok', checks: { database: 'ok' } };
  }
}
