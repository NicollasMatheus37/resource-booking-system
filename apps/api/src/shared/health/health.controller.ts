import { Controller, Get } from '@nestjs/common';

/**
 * 12-Factor IX — Descartabilidade.
 *
 * `/health` (liveness) responde se o processo está vivo e não deve consultar
 * dependências: um banco lento derrubaria o container sem necessidade.
 *
 * `/ready` (readiness) responde se o processo pode receber tráfego, e por isso
 * verifica as dependências. A checagem real do banco entra na Fatia 1, quando
 * o Prisma existir.
 */
@Controller()
export class HealthController {
  @Get('health')
  liveness() {
    return { status: 'ok' };
  }

  @Get('ready')
  readiness() {
    return { status: 'ok', checks: {} };
  }
}
