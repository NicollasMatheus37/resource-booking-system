import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env.schema';

/**
 * 12-Factor IV — o Postgres é um recurso anexado, alcançado apenas por
 * `DATABASE_URL`. Trocar o container local por um RDS gerenciado é trocar uma
 * string de ambiente; nenhuma linha de código muda.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Inject(ENV) env: Env) {
    super({
      adapter: new PrismaPg({
        connectionString: env.DATABASE_URL,
        // Teto explícito de conexões: sob contenção, requisições esperando
        // ocupam conexão. Sem teto, o Postgres cai por exaustão antes de cair
        // por lock (ADR 0004, admission control).
        max: env.DATABASE_POOL_MAX,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Conectado ao Postgres');
  }

  async onModuleDestroy(): Promise<void> {
    // 12-Factor IX: drena o pool antes de encerrar.
    await this.$disconnect();
  }

  /** Usado pelo /ready — readiness verifica dependências, liveness não. */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
