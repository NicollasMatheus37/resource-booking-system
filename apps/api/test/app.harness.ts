import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { DomainErrorFilter } from '../src/shared/filters/domain-error.filter';

export interface Fixtures {
  users: { id: string; name: string }[];
  exclusiveResourceId: string;
  sharedResourceId: string;
  slots: { id: string; startsAt: Date }[];
}

/** Sobe a aplicação Nest COMPLETA contra o banco do container. */
export async function createApp(
  databaseUrl: string,
): Promise<INestApplication> {
  process.env.DATABASE_URL = databaseUrl;
  process.env.NODE_ENV = 'test';
  // Pool folgado: o teste dispara centenas de requisições de uma vez, e
  // exaustão de pool mascararia o que estamos medindo.
  process.env.DATABASE_POOL_MAX = '40';

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new DomainErrorFilter());

  // Escuta UMA vez numa porta efêmera. Se cada requisição do supertest
  // levantasse seu próprio servidor, centenas de disparos simultâneos
  // esgotariam o backlog e o teste falharia por ECONNRESET — medindo o
  // cliente de teste, não a concorrência do sistema.
  await app.listen(0, '127.0.0.1');

  return app;
}

export function rawClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
}

/**
 * Fixtures determinísticas: N usuários reais, um recurso de cada `kind`, e
 * uma sequência de slots de 30min começando daqui a uma hora.
 */
export async function seedFixtures(
  prisma: PrismaClient,
  options: { users: number; sharedUnits: number; slots: number },
): Promise<Fixtures> {
  await prisma.reservationSlot.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.slot.deleteMany();
  await prisma.resource.deleteMany();
  await prisma.user.deleteMany();

  const users = await Promise.all(
    Array.from({ length: options.users }, (_, i) =>
      prisma.user.create({
        data: { name: `Usuário ${i + 1}`, email: `user${i + 1}@teste.com` },
        select: { id: true, name: true },
      }),
    ),
  );

  const exclusive = await prisma.resource.create({
    data: {
      name: 'Sala de Teste',
      kind: 'EXCLUSIVE',
      unitsPerSlot: 1,
      maxUnitsPerUser: 1,
      maxSlotsPerReservation: 4,
    },
  });

  const shared = await prisma.resource.create({
    data: {
      name: 'Garagem de Teste',
      kind: 'SHARED',
      unitsPerSlot: options.sharedUnits,
      maxUnitsPerUser: 4,
      maxSlotsPerReservation: 4,
    },
  });

  const base = new Date(Date.now() + 60 * 60 * 1000);
  base.setUTCMinutes(0, 0, 0);

  for (const resource of [exclusive, shared]) {
    await prisma.slot.createMany({
      data: Array.from({ length: options.slots }, (_, i) => {
        const startsAt = new Date(base.getTime() + i * 30 * 60_000);
        return {
          resourceId: resource.id,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 30 * 60_000),
          unitsPerSlot: resource.unitsPerSlot,
        };
      }),
    });
  }

  const slots = await prisma.slot.findMany({
    orderBy: { startsAt: 'asc' },
    select: { id: true, startsAt: true, resourceId: true },
  });

  return {
    users,
    exclusiveResourceId: exclusive.id,
    sharedResourceId: shared.id,
    slots,
  };
}

export async function slotsOf(
  prisma: PrismaClient,
  resourceId: string,
): Promise<{ id: string; startsAt: Date; reservedUnits: number }[]> {
  return prisma.slot.findMany({
    where: { resourceId },
    orderBy: { startsAt: 'asc' },
    select: { id: true, startsAt: true, reservedUnits: true },
  });
}
