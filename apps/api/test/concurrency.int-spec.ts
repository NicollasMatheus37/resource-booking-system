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
 * A PROVA DO ADR 0004.
 *
 * Este é o teste mais importante do repositório. Ele dispara requisições
 * genuinamente simultâneas contra a aplicação Nest completa e um Postgres
 * real, e afirma que a invariante se mantém.
 *
 * O N é alto de propósito. Um teste de concorrência que não gera contenção
 * passa por acidente.
 */
const N = 200;

const harness = new DatabaseHarness();
let app: INestApplication;
let baseUrl: string;
let prisma: PrismaClient;
let databaseUrl: string;

beforeAll(async () => {
  databaseUrl = await harness.start();
  prisma = rawClient(databaseUrl);
  app = await createApp(databaseUrl);
  baseUrl = await app.getUrl();
}, 180000);

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
  await harness.stop();
});

function reserve(
  userId: string,
  resourceId: string,
  slotIds: string[],
  quantity?: number,
) {
  return request(baseUrl)
    .post('/api/reservations')
    .set('x-user-id', userId)
    .send({ resourceId, slotIds, ...(quantity ? { quantity } : {}) });
}

describe('Condição de corrida na reserva', () => {
  describe(`EXCLUSIVE: ${N} usuários disputando o mesmo slot`, () => {
    let fx: Fixtures;

    beforeAll(async () => {
      fx = await seedFixtures(prisma, { users: N, sharedUnits: 30, slots: 8 });
    });

    it('exatamente 1 vence, os demais recebem 409 SLOT_UNAVAILABLE', async () => {
      const slots = await slotsOf(prisma, fx.exclusiveResourceId);
      const alvo = slots[0];

      const responses = await Promise.all(
        fx.users.map((user) =>
          reserve(user.id, fx.exclusiveResourceId, [alvo.id]),
        ),
      );

      const criados = responses.filter((r) => r.status === 201);
      const conflitos = responses.filter((r) => r.status === 409);

      expect(criados).toHaveLength(1);
      expect(conflitos).toHaveLength(N - 1);

      // Todo perdedor recebe um código semântico, nunca 500.
      for (const r of conflitos) {
        expect(r.body.code).toBe('SLOT_UNAVAILABLE');
      }

      // Nenhuma resposta pode ser erro técnico.
      expect(responses.filter((r) => r.status >= 500)).toHaveLength(0);

      const depois = await prisma.slot.findUniqueOrThrow({
        where: { id: alvo.id },
      });
      expect(depois.reservedUnits).toBe(1);

      const confirmadas = await prisma.reservationSlot.count({
        where: { slotId: alvo.id, status: 'CONFIRMED' },
      });
      expect(confirmadas).toBe(1);
    });
  });

  describe('SHARED: disputa por unidades com quantidade variada', () => {
    const UNIDADES = 30;
    let fx: Fixtures;

    beforeAll(async () => {
      fx = await seedFixtures(prisma, {
        users: N,
        sharedUnits: UNIDADES,
        slots: 8,
      });
    });

    it('nunca vende mais que a capacidade, e o contador bate com o confirmado', async () => {
      const slots = await slotsOf(prisma, fx.sharedResourceId);
      const alvo = slots[0];

      // Quantidades variadas: 1 a 4 unidades por pedido. Isso testa a condição
      // `reserved_units + qty <= units_per_slot` — um `< units_per_slot`
      // ingênuo deixaria passar um pedido de 4 quando restam 2.
      const responses = await Promise.all(
        fx.users.map((user, i) =>
          reserve(user.id, fx.sharedResourceId, [alvo.id], (i % 4) + 1),
        ),
      );

      const criados = responses.filter((r) => r.status === 201);
      expect(responses.filter((r) => r.status >= 500)).toHaveLength(0);

      const somaConfirmada = criados.reduce(
        (total, r) => total + r.body.quantity,
        0,
      );

      const depois = await prisma.slot.findUniqueOrThrow({
        where: { id: alvo.id },
      });

      expect(somaConfirmada).toBeLessThanOrEqual(UNIDADES);
      expect(depois.reservedUnits).toBe(somaConfirmada);
      expect(depois.reservedUnits).toBeLessThanOrEqual(UNIDADES);
    });
  });

  describe('Multi-slot: atomicidade e ausência de deadlock (ADR 0011)', () => {
    let fx: Fixtures;

    beforeAll(async () => {
      fx = await seedFixtures(prisma, { users: 60, sharedUnits: 30, slots: 6 });
    });

    it('não produz sucesso parcial nem deadlock com intervalos sobrepostos', async () => {
      const slots = await slotsOf(prisma, fx.exclusiveResourceId);

      // Janelas deslizantes que se sobrepõem entre si. Sem a ordenação por
      // startsAt do ADR 0011, transações concorrentes travariam os mesmos
      // slots em sentidos opostos e o Postgres abortaria por deadlock.
      const pedidos = fx.users.map((user, i) => {
        const inicio = i % 3;
        const janela = slots.slice(inicio, inicio + 3).map((s) => s.id);
        // Metade envia em ordem invertida, para provar que a ordenação
        // acontece no servidor e não depende do cliente.
        const slotIds = i % 2 === 0 ? janela : [...janela].reverse();
        return reserve(user.id, fx.exclusiveResourceId, slotIds);
      });

      const responses = await Promise.all(pedidos);

      // Nenhum deadlock: o Postgres retornaria 40P01, que viraria 500.
      const erros5xx = responses.filter((r) => r.status >= 500);
      expect(erros5xx.map((r) => r.body)).toEqual([]);

      const criados = responses.filter((r) => r.status === 201);

      // Atomicidade: cada reserva criada tem TODOS os seus slots gravados.
      for (const r of criados) {
        const gravados = await prisma.reservationSlot.count({
          where: { reservationId: r.body.id, status: 'CONFIRMED' },
        });
        expect(gravados).toBe(r.body.slotIds.length);
      }

      // E nenhum slot exclusivo ficou com mais de uma reserva confirmada.
      const contagens = await prisma.slot.findMany({
        where: { resourceId: fx.exclusiveResourceId },
        select: { reservedUnits: true },
      });
      for (const slot of contagens) {
        expect(slot.reservedUnits).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('Idempotência por usuário', () => {
    let fx: Fixtures;

    beforeAll(async () => {
      fx = await seedFixtures(prisma, { users: 2, sharedUnits: 30, slots: 4 });
    });

    it('o mesmo usuário no mesmo slot recebe 409 ALREADY_RESERVED', async () => {
      const slots = await slotsOf(prisma, fx.sharedResourceId);
      const alvo = slots[0];
      const user = fx.users[0];

      const primeira = await reserve(user.id, fx.sharedResourceId, [alvo.id]);
      expect(primeira.status).toBe(201);

      const antes = await prisma.slot.findUniqueOrThrow({
        where: { id: alvo.id },
      });

      const segunda = await reserve(user.id, fx.sharedResourceId, [alvo.id]);
      expect(segunda.status).toBe(409);
      expect(segunda.body.code).toBe('ALREADY_RESERVED');

      // A contagem NÃO pode ter mudado: é exatamente essa a diferença entre
      // ALREADY_RESERVED e SLOT_UNAVAILABLE no ADR 0006.
      const depois = await prisma.slot.findUniqueOrThrow({
        where: { id: alvo.id },
      });
      expect(depois.reservedUnits).toBe(antes.reservedUnits);
    });

    it('distingue os dois 409 também em recurso EXCLUSIVE', async () => {
      // Caso sutil: num recurso exclusivo o contador atinge o teto com UMA
      // reserva, então o UPDATE atômico falha ANTES de a constraint de
      // unicidade ser avaliada. Sem tratamento específico, o próprio dono da
      // reserva receberia "alguém foi mais rápido".
      const slots = await slotsOf(prisma, fx.exclusiveResourceId);
      const alvo = slots[1];
      const [dono, outro] = fx.users;

      const primeira = await reserve(dono.id, fx.exclusiveResourceId, [
        alvo.id,
      ]);
      expect(primeira.status).toBe(201);

      const repetida = await reserve(dono.id, fx.exclusiveResourceId, [
        alvo.id,
      ]);
      expect(repetida.status).toBe(409);
      expect(repetida.body.code).toBe('ALREADY_RESERVED');

      const terceiro = await reserve(outro.id, fx.exclusiveResourceId, [
        alvo.id,
      ]);
      expect(terceiro.status).toBe(409);
      expect(terceiro.body.code).toBe('SLOT_UNAVAILABLE');
    });
  });
});
