import { execSync } from 'node:child_process';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

/**
 * Postgres REAL para os testes de integração (ADR 0009).
 *
 * Testcontainers em vez do banco do compose porque o teste passa a ser
 * auto-contido: sem estado compartilhado entre execuções, sem "funciona na
 * minha máquina", e roda igual em CI.
 *
 * Mockar o banco aqui não provaria nada. Um repositório falso não tem MVCC,
 * não tem row lock e não tem constraint de exclusão — ele passaria com uma
 * implementação incorreta.
 */
export class DatabaseHarness {
  private container?: StartedPostgreSqlContainer;

  async start(): Promise<string> {
    this.container = await new PostgreSqlContainer('postgres:18-alpine')
      .withDatabase('booking_test')
      .withUsername('booking')
      .withPassword('booking')
      .start();

    const url = this.container.getConnectionUri();

    // As constraints críticas vivem na migration SQL manual, então rodar as
    // migrations de verdade é parte do que está sendo testado.
    execSync('pnpm exec prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    });

    return url;
  }

  async stop(): Promise<void> {
    await this.container?.stop();
  }
}
