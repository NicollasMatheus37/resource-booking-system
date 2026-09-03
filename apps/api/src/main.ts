import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DomainErrorFilter } from './shared/filters/domain-error.filter';
import { loadEnv } from './config/env.schema';

async function bootstrap() {
  // 12-Factor III: a configuração é validada ANTES de qualquer coisa subir.
  // Fazer isso fora do container de DI é deliberado — um erro aqui produz uma
  // mensagem legível apontando a variável, em vez de um stack trace de injeção.
  const env = loadEnv();

  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  app.setGlobalPrefix('api');
  app.enableCors({ origin: env.CORS_ORIGINS });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Erro de domínio vira status + code semântico, nunca 500 (ADR 0004).
  app.useGlobalFilters(new DomainErrorFilter());

  // 12-Factor IX: encerra conexões e drena o processo em SIGTERM/SIGINT.
  app.enableShutdownHooks();

  await app.listen(env.PORT, '0.0.0.0');
  Logger.log(`API ouvindo em http://localhost:${env.PORT}/api`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  // Falhar no boot é melhor que falhar na primeira requisição (ADR 0010).
  console.error(
    `\n[boot] ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
