import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 lê a connection string daqui, não mais do schema.
 * 12-Factor III: continua vindo do ambiente — este arquivo é só o ponto de
 * leitura para as ferramentas de CLI (migrate, studio).
 */
export default defineConfig({
  schema: 'apps/api/prisma/schema.prisma',
  migrations: {
    path: 'apps/api/prisma/migrations',
    seed: 'node --experimental-strip-types apps/api/prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
