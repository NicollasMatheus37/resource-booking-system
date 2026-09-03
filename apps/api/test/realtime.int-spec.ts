import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { SlotAvailabilityChanged } from '@resource-booking/contracts';
import { DatabaseHarness } from './database.harness';
import {
  createApp,
  rawClient,
  seedFixtures,
  slotsOf,
  type Fixtures,
} from './app.harness';

/**
 * ADR 0005 — o evento chega ao cliente depois do commit, com o delta correto.
 *
 * O consumo é feito com `fetch` e leitura do corpo em stream, e não com uma
 * biblioteca de cliente SSE: assim o teste verifica o formato do protocolo na
 * saída real (`event:`, `id:`, `data:`), não a interpretação de um cliente.
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
  fx = await seedFixtures(prisma, { users: 2, sharedUnits: 30, slots: 4 });
}, 180000);

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
  await harness.stop();
});

interface ParsedEvent {
  id?: string;
  event?: string;
  data?: unknown;
}

/** Lê o stream até coletar `count` eventos do tipo pedido. */
async function collect(
  signal: AbortSignal,
  count: number,
  wanted: string,
): Promise<ParsedEvent[]> {
  const response = await fetch(`${baseUrl}/api/events/availability`, {
    headers: { accept: 'text/event-stream' },
    signal,
  });

  expect(response.headers.get('content-type')).toContain('text/event-stream');

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const collected: ParsedEvent[] = [];
  let buffer = '';

  while (collected.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';

    for (const block of blocks) {
      const parsed: ParsedEvent = {};
      for (const line of block.split('\n')) {
        if (line.startsWith('id:')) parsed.id = line.slice(3).trim();
        if (line.startsWith('event:')) parsed.event = line.slice(6).trim();
        if (line.startsWith('data:')) {
          parsed.data = JSON.parse(line.slice(5).trim());
        }
      }
      if (parsed.event === wanted) collected.push(parsed);
    }
  }

  await reader.cancel().catch(() => undefined);
  return collected;
}

describe('SSE de disponibilidade', () => {
  it('entrega um delta por slot após a reserva ser confirmada', async () => {
    const slots = await slotsOf(prisma, fx.sharedResourceId);
    const alvo = [slots[0], slots[1]];

    const controller = new AbortController();
    const eventos = collect(controller.signal, 2, 'availability');

    // Pequena espera para o stream estar aberto antes de disparar a escrita.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const response = await fetch(`${baseUrl}/api/reservations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': fx.users[0].id,
      },
      body: JSON.stringify({
        resourceId: fx.sharedResourceId,
        slotIds: alvo.map((s) => s.id),
        quantity: 3,
      }),
    });
    expect(response.status).toBe(201);

    const recebidos = await eventos;
    controller.abort();

    expect(recebidos).toHaveLength(2);

    for (const evento of recebidos) {
      const payload = evento.data as SlotAvailabilityChanged;
      expect(payload.type).toBe('slot-availability-changed');
      expect(payload.resourceId).toBe(fx.sharedResourceId);
      // O delta reflete o estado PÓS-COMMIT, não o anterior.
      expect(payload.reservedUnits).toBe(3);
      expect(payload.unitsPerSlot).toBe(30);
      // Todo evento carrega id, para o Last-Event-ID na reconexão.
      expect(evento.id).toMatch(/^\d+$/);
    }

    expect(recebidos.map((e) => (e.data as SlotAvailabilityChanged).slotId))
      .toEqual(alvo.map((s) => s.id));
  }, 60000);

  it('não emite evento quando a reserva é recusada', async () => {
    const slots = await slotsOf(prisma, fx.exclusiveResourceId);
    const alvo = slots[0];

    // Primeiro ocupa o slot.
    const primeira = await fetch(`${baseUrl}/api/reservations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': fx.users[0].id,
      },
      body: JSON.stringify({
        resourceId: fx.exclusiveResourceId,
        slotIds: [alvo.id],
      }),
    });
    expect(primeira.status).toBe(201);

    const controller = new AbortController();
    let recebeu = false;
    const escuta = collect(controller.signal, 1, 'availability').then(() => {
      recebeu = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 300));

    const recusada = await fetch(`${baseUrl}/api/reservations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': fx.users[1].id,
      },
      body: JSON.stringify({
        resourceId: fx.exclusiveResourceId,
        slotIds: [alvo.id],
      }),
    });
    expect(recusada.status).toBe(409);

    await new Promise((resolve) => setTimeout(resolve, 600));
    controller.abort();
    await escuta.catch(() => undefined);

    // Uma disputa perdida não muda disponibilidade: anunciar mudança faria
    // todas as outras abas refazerem trabalho à toa.
    expect(recebeu).toBe(false);
  }, 60000);
});
