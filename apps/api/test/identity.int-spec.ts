import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { DatabaseHarness } from './database.harness';
import {
  createApp,
  rawClient,
  seedFixtures,
  slotsOf,
  type Fixtures,
} from './app.harness';

/**
 * O guard de identidade é GLOBAL e o padrão é FECHADO (ADR 0008).
 *
 * Abrir um endpoint exige `@Public()`, um ato explícito e visível em code
 * review. Estes testes existem para que a lista de endpoints públicos não
 * cresça por acidente: adicionar `@Public()` sem pensar quebra o primeiro
 * teste abaixo.
 */
const harness = new DatabaseHarness();
let app: INestApplication;
let baseUrl: string;
let prisma: PrismaClient;
let fx: Fixtures;

beforeAll(async () => {
  const url = await harness.start();
  prisma = rawClient(url);
  app = await createApp(url);
  baseUrl = await app.getUrl();
  fx = await seedFixtures(prisma, { users: 2, sharedUnits: 10, slots: 4 });
}, 180000);

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
  await harness.stop();
});

describe('Guard de identidade', () => {
  it('só estes endpoints são públicos', async () => {
    const publicos: [string, string][] = [
      ['get', '/api/health'],
      ['get', '/api/ready'],
      ['get', '/api/users'],
    ];

    for (const [method, path] of publicos) {
      const resposta = await (request(baseUrl) as never as Record<
        string,
        (p: string) => request.Test
      >)[method](path);
      expect([200, 204]).toContain(resposta.status);
    }
  });

  it('recusa endpoints protegidos sem identidade', async () => {
    const protegidos: [string, string][] = [
      ['get', '/api/resources'],
      ['get', '/api/reservations'],
    ];

    for (const [method, path] of protegidos) {
      const resposta = await (request(baseUrl) as never as Record<
        string,
        (p: string) => request.Test
      >)[method](path);

      expect(resposta.status).toBe(401);
      expect(resposta.body.code).toBe('UNAUTHENTICATED');
    }
  });

  it('recusa identidade desconhecida', async () => {
    const resposta = await request(baseUrl)
      .get('/api/resources')
      .set('x-user-id', '00000000-0000-4000-8000-000000000000');

    expect(resposta.status).toBe(401);
  });

  it('o userId vem do header, NUNCA do corpo da requisição', async () => {
    const slots = await slotsOf(prisma, fx.exclusiveResourceId);
    const [ana, bruno] = fx.users;

    // Tentativa de reservar em nome de outra pessoa.
    const resposta = await request(baseUrl)
      .post('/api/reservations')
      .set('x-user-id', ana.id)
      .send({
        resourceId: fx.exclusiveResourceId,
        slotIds: [slots[0].id],
        userId: bruno.id,
      });

    expect(resposta.status).toBe(201);
    // A reserva é de quem enviou o header, não de quem o corpo indicava.
    expect(resposta.body.userId).toBe(ana.id);

    const doBruno = await request(baseUrl)
      .get('/api/reservations')
      .set('x-user-id', bruno.id);
    expect(doBruno.body).toHaveLength(0);
  });
});
