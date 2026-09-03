import { Global, Module } from '@nestjs/common';
import { loadEnv, type Env } from './env.schema';

export const ENV = Symbol('ENV');

/**
 * Expõe a configuração validada por injeção de dependência.
 *
 * Nenhum outro módulo lê `process.env`: quem precisa de configuração injeta
 * `@Inject(ENV)`. Isso mantém a leitura num ponto só e torna qualquer serviço
 * testável com um ambiente falso, sem mexer em variáveis globais.
 */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => loadEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
