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
}, 180000);

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
  await harness.stop();
});

beforeEach(async () => {
  fx = await seedFixtures(prisma, { users: 3, sharedUnits: 10, slots: 4 });
});

const asUser = (path: string) =>
  request(baseUrl).post(path).set('x-user-id', fx.users[0].id);

describe('Cadastro de recursos', () => {
  it('cria o recurso E a agenda junto', async () => {
    const criado = await asUser('/api/resources').send({
      name: 'Auditório',
      kind: 'EXCLUSIVE',
      unitsPerSlot: 1,
      maxUnitsPerUser: 1,
      maxSlotsPerReservation: 4,
      seats: 120,
    });

    expect(criado.status).toBe(201);

    // Um recurso sem slots não é reservável — gerar junto evita o
    // esquecimento silencioso.
    const slots = await slotsOf(prisma, criado.body.id);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s.reservedUnits === 0)).toBe(true);

    // Nenhuma janela no passado: criar um recurso à tarde não gera horários
    // da manhã do mesmo dia, que ninguém poderia reservar.
    const agora = Date.now();
    expect(slots.every((s) => s.startsAt.getTime() > agora)).toBe(true);

    // E já é reservável de imediato.
    const reserva = await request(baseUrl)
      .post('/api/reservations')
      .set('x-user-id', fx.users[0].id)
      .send({ resourceId: criado.body.id, slotIds: [slots[0].id] });
    expect(reserva.status).toBe(201);
  });

  it('recusa EXCLUSIVE com mais de uma unidade, com mensagem legível', async () => {
    const resposta = await asUser('/api/resources').send({
      name: 'Sala Confusa',
      kind: 'EXCLUSIVE',
      unitsPerSlot: 5,
      maxUnitsPerUser: 1,
      maxSlotsPerReservation: 4,
    });

    // O CHECK do banco também barraria, mas com erro de constraint. A
    // validação de domínio existe para o usuário entender o que errou.
    expect(resposta.status).toBe(422);
    expect(resposta.body.code).toBe('INVALID_RESOURCE_CONFIG');
    expect(resposta.body.message).toMatch(/exclusiv/i);
  });

  it('recusa maxUnitsPerUser acima de unitsPerSlot', async () => {
    const resposta = await asUser('/api/resources').send({
      name: 'Garagem Impossível',
      kind: 'SHARED',
      unitsPerSlot: 3,
      maxUnitsPerUser: 10,
      maxSlotsPerReservation: 4,
    });

    expect(resposta.status).toBe(422);
    expect(resposta.body.code).toBe('INVALID_RESOURCE_CONFIG');
  });

  it('edita campos mutáveis', async () => {
    const resposta = await request(baseUrl)
      .patch(`/api/resources/${fx.sharedResourceId}`)
      .set('x-user-id', fx.users[0].id)
      .send({ name: 'Garagem Renomeada', maxSlotsPerReservation: 2, seats: 8 });

    expect(resposta.status).toBe(200);
    expect(resposta.body.name).toBe('Garagem Renomeada');
    expect(resposta.body.maxSlotsPerReservation).toBe(2);
  });

  it('não permite maxUnitsPerUser acima da capacidade existente', async () => {
    const resposta = await request(baseUrl)
      .patch(`/api/resources/${fx.sharedResourceId}`)
      .set('x-user-id', fx.users[0].id)
      .send({ maxUnitsPerUser: 999 });

    expect(resposta.status).toBe(422);
    expect(resposta.body.code).toBe('INVALID_RESOURCE_CONFIG');
  });

  it('desativar preserva as reservas e some da listagem', async () => {
    const slots = await slotsOf(prisma, fx.exclusiveResourceId);

    const reserva = await request(baseUrl)
      .post('/api/reservations')
      .set('x-user-id', fx.users[0].id)
      .send({ resourceId: fx.exclusiveResourceId, slotIds: [slots[0].id] });
    expect(reserva.status).toBe(201);

    const desativado = await request(baseUrl)
      .delete(`/api/resources/${fx.exclusiveResourceId}`)
      .set('x-user-id', fx.users[0].id);
    expect(desativado.status).toBe(200);
    expect(desativado.body.active).toBe(false);

    // Sai da listagem padrão…
    const lista = await request(baseUrl)
      .get('/api/resources')
      .set('x-user-id', fx.users[0].id);
    expect(lista.body.some((r: { id: string }) => r.id === fx.exclusiveResourceId)).toBe(
      false,
    );

    // …mas a reserva NÃO desaparece. `DELETE` de verdade cascatearia e
    // destruiria o histórico de quem reservou.
    const minhas = await request(baseUrl)
      .get('/api/reservations')
      .set('x-user-id', fx.users[0].id);
    expect(minhas.body).toHaveLength(1);
    expect(minhas.body[0].status).toBe('CONFIRMED');

    // E novas reservas são recusadas pela regra de domínio.
    const nova = await request(baseUrl)
      .post('/api/reservations')
      .set('x-user-id', fx.users[1].id)
      .send({ resourceId: fx.exclusiveResourceId, slotIds: [slots[1].id] });
    expect(nova.status).toBe(422);
    expect(nova.body.code).toBe('RESOURCE_INACTIVE');
  });

  it('recusa payload malformado com VALIDATION_FAILED', async () => {
    const resposta = await asUser('/api/resources').send({
      name: 'x',
      kind: 'OUTRO',
      unitsPerSlot: -1,
      maxUnitsPerUser: 0,
      maxSlotsPerReservation: 0,
    });

    expect(resposta.status).toBe(400);
    expect(resposta.body.code).toBe('VALIDATION_FAILED');
  });
});
