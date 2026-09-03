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
 * Cancelamento é o CAMINHO INVERSO da concorrência.
 *
 * Aqui a invariante fura em sentido contrário: contador abaixo de zero, ou
 * unidade devolvida duas vezes porque dois cliques chegaram juntos. Estes
 * testes cobrem exatamente isso.
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
  fx = await seedFixtures(prisma, { users: 30, sharedUnits: 10, slots: 6 });
});

const reserve = (userId: string, resourceId: string, slotIds: string[], quantity?: number) =>
  request(baseUrl)
    .post('/api/reservations')
    .set('x-user-id', userId)
    .send({ resourceId, slotIds, ...(quantity ? { quantity } : {}) });

const cancel = (userId: string, reservationId: string) =>
  request(baseUrl).delete(`/api/reservations/${reservationId}`).set('x-user-id', userId);

describe('Cancelamento', () => {
  it('devolve as unidades de todos os slots do grupo', async () => {
    const slots = await slotsOf(prisma, fx.sharedResourceId);
    const alvo = slots.slice(0, 3);

    const criada = await reserve(
      fx.users[0].id,
      fx.sharedResourceId,
      alvo.map((s) => s.id),
      4,
    );
    expect(criada.status).toBe(201);

    for (const slot of await slotsOf(prisma, fx.sharedResourceId)) {
      if (alvo.some((a) => a.id === slot.id)) {
        expect(slot.reservedUnits).toBe(4);
      }
    }

    const cancelada = await cancel(fx.users[0].id, criada.body.id);
    expect(cancelada.status).toBe(200);
    expect(cancelada.body.changed).toBe(true);

    // Tudo devolvido, em todos os slots do grupo.
    for (const slot of await slotsOf(prisma, fx.sharedResourceId)) {
      expect(slot.reservedUnits).toBe(0);
    }
  });

  it('é idempotente sob cancelamentos SIMULTÂNEOS', async () => {
    const slots = await slotsOf(prisma, fx.sharedResourceId);
    const alvo = slots[0];

    const criada = await reserve(
      fx.users[0].id,
      fx.sharedResourceId,
      [alvo.id],
      3,
    );
    expect(criada.status).toBe(201);

    // 20 cancelamentos ao mesmo tempo. Sem o portão atômico, cada um
    // devolveria 3 unidades e o contador iria a -57.
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => cancel(fx.users[0].id, criada.body.id)),
    );

    expect(responses.filter((r) => r.status >= 500)).toHaveLength(0);
    expect(responses.every((r) => r.status === 200)).toBe(true);

    // Exatamente UM cancelamento teve efeito.
    const efetivos = responses.filter((r) => r.body.changed === true);
    expect(efetivos).toHaveLength(1);

    const depois = await prisma.slot.findUniqueOrThrow({
      where: { id: alvo.id },
    });
    expect(depois.reservedUnits).toBe(0);
  });

  it('libera o slot para reserva imediata, inclusive pelo mesmo usuário', async () => {
    const slots = await slotsOf(prisma, fx.exclusiveResourceId);
    const alvo = slots[0];
    const [dono, outro] = fx.users;

    const primeira = await reserve(dono.id, fx.exclusiveResourceId, [alvo.id]);
    expect(primeira.status).toBe(201);

    // Enquanto confirmada, ninguém entra.
    expect((await reserve(outro.id, fx.exclusiveResourceId, [alvo.id])).status)
      .toBe(409);

    await cancel(dono.id, primeira.body.id);

    // A constraint de exclusão e o índice único parcial são liberados ao
    // mudar o status em reservation_slots — sem isso, o slot ficaria
    // permanentemente bloqueado após um cancelamento.
    const outroAgora = await reserve(outro.id, fx.exclusiveResourceId, [alvo.id]);
    expect(outroAgora.status).toBe(201);

    await cancel(outro.id, outroAgora.body.id);

    const donoDeNovo = await reserve(dono.id, fx.exclusiveResourceId, [alvo.id]);
    expect(donoDeNovo.status).toBe(201);
  });

  it('cancelamento e novas reservas concorrendo pelo mesmo slot mantêm o contador coerente', async () => {
    const UNIDADES = 10;
    const slots = await slotsOf(prisma, fx.sharedResourceId);
    const alvo = slots[0];

    // Enche o slot com reservas de 1 unidade de usuários distintos.
    const iniciais = await Promise.all(
      fx.users
        .slice(0, UNIDADES)
        .map((u) => reserve(u.id, fx.sharedResourceId, [alvo.id], 1)),
    );
    const confirmadas = iniciais.filter((r) => r.status === 201);
    expect(confirmadas).toHaveLength(UNIDADES);

    // Metade cancela ENQUANTO os usuários restantes tentam entrar.
    const cancelamentos = confirmadas
      .slice(0, 5)
      .map((r, i) => cancel(fx.users[i].id, r.body.id));

    const novas = fx.users
      .slice(UNIDADES, UNIDADES + 15)
      .map((u) => reserve(u.id, fx.sharedResourceId, [alvo.id], 1));

    const todas = await Promise.all([...cancelamentos, ...novas]);
    expect(todas.filter((r) => r.status >= 500)).toHaveLength(0);

    // A verdade final: o contador tem que bater exatamente com o número de
    // reservas confirmadas, e nunca passar da capacidade.
    const confirmadasNoBanco = await prisma.reservationSlot.count({
      where: { slotId: alvo.id, status: 'CONFIRMED' },
    });
    const depois = await prisma.slot.findUniqueOrThrow({
      where: { id: alvo.id },
    });

    expect(depois.reservedUnits).toBe(confirmadasNoBanco);
    expect(depois.reservedUnits).toBeGreaterThanOrEqual(0);
    expect(depois.reservedUnits).toBeLessThanOrEqual(UNIDADES);
  });

  it('recusa cancelar reserva de outro usuário', async () => {
    const slots = await slotsOf(prisma, fx.exclusiveResourceId);
    const criada = await reserve(fx.users[0].id, fx.exclusiveResourceId, [
      slots[0].id,
    ]);

    const alheio = await cancel(fx.users[1].id, criada.body.id);
    expect(alheio.status).toBe(404);
    expect(alheio.body.code).toBe('RESERVATION_NOT_FOUND');

    // E a reserva continua de pé.
    const slot = await prisma.slot.findUniqueOrThrow({
      where: { id: slots[0].id },
    });
    expect(slot.reservedUnits).toBe(1);
  });

  it('lista as reservas do usuário com seus slots', async () => {
    const slots = await slotsOf(prisma, fx.exclusiveResourceId);
    await reserve(fx.users[0].id, fx.exclusiveResourceId, [
      slots[0].id,
      slots[1].id,
    ]);

    const minhas = await request(baseUrl)
      .get('/api/reservations')
      .set('x-user-id', fx.users[0].id);

    expect(minhas.status).toBe(200);
    expect(minhas.body).toHaveLength(1);
    expect(minhas.body[0].slots).toHaveLength(2);
    expect(minhas.body[0].status).toBe('CONFIRMED');

    // Não enxerga reserva de terceiro.
    const outras = await request(baseUrl)
      .get('/api/reservations')
      .set('x-user-id', fx.users[1].id);
    expect(outras.body).toHaveLength(0);
  });
});
