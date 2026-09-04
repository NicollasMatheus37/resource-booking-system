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
 * Uma reserva cobre um BLOCO CONTÍGUO (ADR 0011, revisado).
 *
 * Uma seleção com lacunas produz reservas independentes, uma por bloco, cada
 * uma cancelável sozinha — e o resultado pode ser PARCIAL, porque cada bloco é
 * atômico por si mas blocos diferentes não têm relação entre si.
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
}, 180000);

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
  await harness.stop();
});

beforeEach(async () => {
  fx = await seedFixtures(prisma, { users: 3, sharedUnits: 10, slots: 10 });
});

const reserve = (userId: string, resourceId: string, slotIds: string[]) =>
  request(baseUrl)
    .post('/api/reservations')
    .set('x-user-id', userId)
    .send({ resourceId, slotIds });

describe('Blocos contíguos', () => {
  it('slots seguidos viram UMA reserva', async () => {
    const slots = await slotsOf(prisma, fx.exclusiveResourceId);

    const r = await reserve(
      fx.users[0].id,
      fx.exclusiveResourceId,
      slots.slice(0, 4).map((s) => s.id),
    );

    expect(r.status).toBe(201);
    expect(r.body.created).toHaveLength(1);
    expect(r.body.created[0].slotIds).toHaveLength(4);
  });

  it('seleção com lacuna vira reservas INDEPENDENTES', async () => {
    const slots = await slotsOf(prisma, fx.exclusiveResourceId);

    const r = await reserve(fx.users[0].id, fx.exclusiveResourceId, [
      slots[0].id,
      slots[1].id,
      slots[5].id,
    ]);

    expect(r.status).toBe(201);
    expect(r.body.created).toHaveLength(2);
    expect(r.body.created[0].slotIds).toEqual([slots[0].id, slots[1].id]);
    expect(r.body.created[1].slotIds).toEqual([slots[5].id]);

    // Duas reservas na lista do usuário, não uma.
    const minhas = await request(baseUrl)
      .get('/api/reservations')
      .set('x-user-id', fx.users[0].id);
    expect(minhas.body).toHaveLength(2);
  });

  it('cada bloco é cancelável sozinho', async () => {
    const slots = await slotsOf(prisma, fx.exclusiveResourceId);

    const r = await reserve(fx.users[0].id, fx.exclusiveResourceId, [
      slots[0].id,
      slots[5].id,
    ]);
    const [primeira, segunda] = r.body.created;

    const cancelada = await request(baseUrl)
      .delete(`/api/reservations/${primeira.id}`)
      .set('x-user-id', fx.users[0].id);
    expect(cancelada.status).toBe(200);

    // O primeiro bloco liberou; o segundo continua reservado.
    const depois = await slotsOf(prisma, fx.exclusiveResourceId);
    expect(depois.find((s) => s.id === slots[0].id)?.reservedUnits).toBe(0);
    expect(depois.find((s) => s.id === slots[5].id)?.reservedUnits).toBe(1);

    const minhas = await request(baseUrl)
      .get('/api/reservations')
      .set('x-user-id', fx.users[0].id);
    const confirmadas = minhas.body.filter(
      (x: { status: string }) => x.status === 'CONFIRMED',
    );
    expect(confirmadas).toHaveLength(1);
    expect(confirmadas[0].id).toBe(segunda.id);
  });

  it('resultado PARCIAL devolve 207 com os dois lados', async () => {
    const slots = await slotsOf(prisma, fx.exclusiveResourceId);

    // Outro usuário toma o slot que será o segundo bloco.
    const tomado = await reserve(fx.users[1].id, fx.exclusiveResourceId, [
      slots[5].id,
    ]);
    expect(tomado.status).toBe(201);

    const r = await reserve(fx.users[0].id, fx.exclusiveResourceId, [
      slots[0].id,
      slots[1].id,
      slots[5].id,
    ]);

    expect(r.status).toBe(207);
    expect(r.body.created).toHaveLength(1);
    expect(r.body.created[0].slotIds).toEqual([slots[0].id, slots[1].id]);
    expect(r.body.rejected).toHaveLength(1);
    expect(r.body.rejected[0].slotIds).toEqual([slots[5].id]);
    expect(r.body.rejected[0].code).toBe('SLOT_UNAVAILABLE');

    // O bloco que passou está de fato gravado — não houve rollback global.
    const depois = await slotsOf(prisma, fx.exclusiveResourceId);
    expect(depois.find((s) => s.id === slots[0].id)?.reservedUnits).toBe(1);
  });

  it('nada criado devolve 409', async () => {
    const slots = await slotsOf(prisma, fx.exclusiveResourceId);

    await reserve(fx.users[1].id, fx.exclusiveResourceId, [slots[0].id]);
    await reserve(fx.users[1].id, fx.exclusiveResourceId, [slots[5].id]);

    const r = await reserve(fx.users[0].id, fx.exclusiveResourceId, [
      slots[0].id,
      slots[5].id,
    ]);

    expect(r.status).toBe(409);
    expect(r.body.created).toEqual([]);
    expect(r.body.rejected).toHaveLength(2);
  });

  it('um bloco parcialmente tomado falha INTEIRO — atomicidade por bloco', async () => {
    const slots = await slotsOf(prisma, fx.exclusiveResourceId);

    // Terceiro slot de um bloco de quatro já está tomado.
    await reserve(fx.users[1].id, fx.exclusiveResourceId, [slots[2].id]);

    const r = await reserve(
      fx.users[0].id,
      fx.exclusiveResourceId,
      slots.slice(0, 4).map((s) => s.id),
    );

    expect(r.status).toBe(409);
    expect(r.body.created).toEqual([]);

    // Nenhum slot do bloco ficou reservado para o perdedor: uma reunião de 2h
    // com um buraco no meio não serve para nada.
    const depois = await slotsOf(prisma, fx.exclusiveResourceId);
    expect(depois.find((s) => s.id === slots[0].id)?.reservedUnits).toBe(0);
    expect(depois.find((s) => s.id === slots[1].id)?.reservedUnits).toBe(0);
    expect(depois.find((s) => s.id === slots[3].id)?.reservedUnits).toBe(0);
  });

  it('idempotência é por bloco', async () => {
    const slots = await slotsOf(prisma, fx.exclusiveResourceId);
    const ids = [slots[0].id, slots[5].id];

    const primeira = await request(baseUrl)
      .post('/api/reservations')
      .set('x-user-id', fx.users[0].id)
      .set('idempotency-key', 'chave-unica')
      .send({ resourceId: fx.exclusiveResourceId, slotIds: ids });
    expect(primeira.status).toBe(201);
    expect(primeira.body.created).toHaveLength(2);

    // Retry de rede: reencontra AS DUAS reservas, não cria nenhuma nova.
    const repetida = await request(baseUrl)
      .post('/api/reservations')
      .set('x-user-id', fx.users[0].id)
      .set('idempotency-key', 'chave-unica')
      .send({ resourceId: fx.exclusiveResourceId, slotIds: ids });

    expect(repetida.status).toBe(201);
    expect(repetida.body.created.map((r: { id: string }) => r.id).sort()).toEqual(
      primeira.body.created.map((r: { id: string }) => r.id).sort(),
    );

    const total = await prisma.reservation.count({
      where: { userId: fx.users[0].id, status: 'CONFIRMED' },
    });
    expect(total).toBe(2);
  });
});
