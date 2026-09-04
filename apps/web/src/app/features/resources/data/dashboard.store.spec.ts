import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { ResourceDto, SlotDto } from '@resource-booking/contracts';
import { Subject } from 'rxjs';
import { APP_CONFIG } from '../../../core/config/app-config';
import { IdentityStore } from '../../../core/identity/identity.store';
import {
  AvailabilityStream,
  type StreamMessage,
} from '../../../core/realtime/availability.stream';
import { DashboardStore } from './dashboard.store';

const API = 'http://api.test/api';

const recurso: ResourceDto = {
  id: 'r1',
  name: 'Sala Azul',
  description: null,
  kind: 'EXCLUSIVE',
  unitsPerSlot: 1,
  maxUnitsPerUser: 1,
  maxSlotsPerReservation: 4,
  seats: null,
  active: true,
};

function slot(id: string, over: Partial<SlotDto> = {}): SlotDto {
  return {
    id,
    resourceId: 'r1',
    startsAt: '2026-09-05T09:00:00.000Z',
    endsAt: '2026-09-05T09:30:00.000Z',
    unitsPerSlot: 1,
    reservedUnits: 0,
    availableUnits: 1,
    reservedByMe: false,
    ...over,
  };
}

describe('DashboardStore', () => {
  let store: DashboardStore;
  let http: HttpTestingController;
  let sse: Subject<StreamMessage>;

  beforeEach(() => {
    sse = new Subject<StreamMessage>();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        DashboardStore,
        { provide: APP_CONFIG, useValue: { apiUrl: API } },
        { provide: AvailabilityStream, useValue: { connect: () => sse } },
        {
          provide: IdentityStore,
          useValue: { currentId: () => 'user-1' },
        },
      ],
    });

    store = TestBed.inject(DashboardStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function carregar(slots: SlotDto[] = [slot('s1'), slot('s2')]) {
    const pronto = store.init();
    http.expectOne(`${API}/resources`).flush([recurso]);
    await Promise.resolve();
    http.expectOne(`${API}/resources/r1/slots`).flush(slots);
    http.expectOne(`${API}/reservations`).flush([]);
    await pronto;
  }

  /**
   * Descarrega o que sobrou na fila.
   *
   * `TestBed.tick()` executa os `effect`s, e um deles reage à identidade
   * disparando refetch de grade e reservas. Isso é comportamento correto do
   * store; nos testes que precisam de `tick` para medir tempo, a fila é
   * drenada no fim.
   */
  function drenar() {
    // `switchMap` cancela o fetch anterior ao trocar de recurso, e requisição
    // cancelada não aceita flush.
    for (const req of http.match(() => true)) {
      if (!req.cancelled) req.flush([]);
    }
  }

  const reserva = (id = 'res-1') => ({
    id,
    status: 'CONFIRMED' as const,
    quantity: 1,
    createdAt: '2026-09-04T00:00:00.000Z',
    resource: { id: 'r1', name: 'Sala Azul', kind: 'EXCLUSIVE' as const },
    slots: [
      {
        id: 's1',
        startsAt: '2026-09-05T09:00:00.000Z',
        endsAt: '2026-09-05T09:30:00.000Z',
      },
    ],
  });

  it('carrega recursos e a grade do primeiro', async () => {
    await carregar();

    expect(store.resources()).toHaveLength(1);
    expect(store.slots()).toHaveLength(2);
    expect(store.status()).toBe('ready');
  });

  it('aplica delta de SSE sem refetch', async () => {
    await carregar();

    sse.next({
      kind: 'change',
      payload: {
        type: 'slot-availability-changed',
        slotId: 's1',
        resourceId: 'r1',
        reservedUnits: 1,
        unitsPerSlot: 1,
      },
    });

    expect(store.slots()[0].availableUnits).toBe(0);
    // Nenhuma requisição: o delta basta.
    http.expectNone(`${API}/resources/r1/slots`);
  });

  it('marca a conexão como ao vivo e refaz o snapshot ao reconectar', async () => {
    await carregar();

    sse.next({ kind: 'open' });
    expect(store.connection()).toBe('live');

    // Reconexão refaz o snapshot: pode ter havido mudança com o stream caído.
    http.expectOne(`${API}/resources/r1/slots`).flush([slot('s1')]);
    expect(store.slots()).toHaveLength(1);

    sse.next({ kind: 'error' });
    expect(store.connection()).toBe('offline');
  });

  describe('reserva', () => {
    it('descarta cliques repetidos enquanto há requisição em voo', async () => {
      await carregar();
      store.toggleSlot('s1');

      store.submit();
      store.submit();
      store.submit();

      // exhaustMap: uma requisição só, mesmo com três cliques.
      const pedidos = http.match(`${API}/reservations`);
      expect(pedidos).toHaveLength(1);

      pedidos[0].flush({
        created: [
          {
            id: 'res-1',
            resourceId: 'r1',
            userId: 'user-1',
            quantity: 1,
            status: 'CONFIRMED',
            slotIds: ['s1'],
            createdAt: '2026-09-04T00:00:00.000Z',
          },
        ],
        rejected: [],
      });

      http.expectOne(`${API}/resources/r1/slots`).flush([
        slot('s1', { reservedUnits: 1, availableUnits: 0, reservedByMe: true }),
      ]);
      http.expectOne(`${API}/reservations`).flush([reserva()]);

      expect(store.selection()).toEqual([]);
      expect(store.notice()?.tone).toBe('success');
      expect(store.myReservations()).toHaveLength(1);
    });

    it('409 traz o MESMO contrato pelo canal de erro e reconcilia', async () => {
      await carregar();
      store.toggleSlot('s1');
      store.submit();

      // O Angular manda 409 pelo canal de erro, mas o corpo é o contrato de
      // resultado com `created` vazio.
      http.expectOne(`${API}/reservations`).flush(
        {
          created: [],
          rejected: [
            {
              slotIds: ['s1'],
              code: 'SLOT_UNAVAILABLE',
              message: 'Este horário já foi reservado.',
            },
          ],
        },
        { status: 409, statusText: 'Conflict' },
      );

      http.expectOne(`${API}/resources/r1/slots`).flush([
        slot('s1', { reservedUnits: 1, availableUnits: 0 }),
      ]);
      http.expectOne(`${API}/reservations`).flush([]);

      expect(store.notice()?.code).toBe('SLOT_UNAVAILABLE');
      expect(store.submitting()).toBe(false);
      // Seleção preservada para o usuário ajustar.
      expect(store.selection()).toEqual(['s1']);
    });

    it('207 parcial: mantém na seleção apenas o bloco recusado', async () => {
      await carregar([slot('s1'), slot('s2'), slot('s3')]);
      store.toggleSlot('s1');
      store.toggleSlot('s3');
      store.submit();

      http.expectOne(`${API}/reservations`).flush(
        {
          created: [
            {
              id: 'res-1',
              resourceId: 'r1',
              userId: 'user-1',
              quantity: 1,
              status: 'CONFIRMED',
              slotIds: ['s1'],
              createdAt: '2026-09-04T00:00:00.000Z',
            },
          ],
          rejected: [
            {
              slotIds: ['s3'],
              code: 'SLOT_UNAVAILABLE',
              message: 'Este horário já foi reservado.',
            },
          ],
        },
        { status: 207, statusText: 'Multi-Status' },
      );

      // O refetch devolve a grade inteira: s3 continua existindo, agora
      // ocupado por outra pessoa.
      http.expectOne(`${API}/resources/r1/slots`).flush([
        slot('s1', { reservedUnits: 1, availableUnits: 0, reservedByMe: true }),
        slot('s2'),
        slot('s3', { reservedUnits: 1, availableUnits: 0 }),
      ]);
      http.expectOne(`${API}/reservations`).flush([]);

      expect(store.notice()?.tone).toBe('warning');
      expect(store.selection()).toEqual(['s3']);
    });

    it('falha de rede NÃO altera o estado local nem refaz fetch', async () => {
      await carregar();
      store.toggleSlot('s1');
      // A identidade que importa é a do mapa normalizado no estado — a
      // projeção `slots()` é um computed que recria o array a cada leitura.
      const antes = store.state().slots;

      store.submit();
      http
        .expectOne(`${API}/reservations`)
        .error(new ProgressEvent('network'), { status: 0 });

      // Não sabemos o que aconteceu do outro lado: mexer seria inventar.
      expect(store.state().slots).toBe(antes);
      expect(store.selection()).toEqual(['s1']);
      expect(store.notice()?.tone).toBe('error');
      http.expectNone(`${API}/resources/r1/slots`);
    });
  });

  describe('descarte automático do aviso', () => {
    it('sucesso desaparece sozinho', async () => {
      jest.useFakeTimers();
      try {
        await carregar();
        store.toggleSlot('s1');
        store.submit();

        http.expectOne(`${API}/reservations`).flush({
          created: [
            {
              id: 'res-1',
              resourceId: 'r1',
              userId: 'user-1',
              quantity: 1,
              status: 'CONFIRMED',
              slotIds: ['s1'],
              createdAt: '2026-09-04T00:00:00.000Z',
            },
          ],
          rejected: [],
        });
        http.expectOne(`${API}/resources/r1/slots`).flush([slot('s1')]);
        http.expectOne(`${API}/reservations`).flush([]);

        TestBed.tick();
        expect(store.notice()?.tone).toBe('success');

        jest.advanceTimersByTime(5000);
        TestBed.tick();
        expect(store.notice()).toBeNull();

        drenar();
      } finally {
        jest.useRealTimers();
      }
    });

    it('aviso de falha PERMANECE — o usuário precisa ler antes de decidir', async () => {
      jest.useFakeTimers();
      try {
        await carregar();
        store.toggleSlot('s1');
        store.submit();

        http.expectOne(`${API}/reservations`).flush(
          {
            created: [],
            rejected: [
              {
                slotIds: ['s1'],
                code: 'SLOT_UNAVAILABLE',
                message: 'Este horário já foi reservado.',
              },
            ],
          },
          { status: 409, statusText: 'Conflict' },
        );
        http.expectOne(`${API}/resources/r1/slots`).flush([slot('s1')]);
        http.expectOne(`${API}/reservations`).flush([]);

        TestBed.tick();
        jest.advanceTimersByTime(60000);
        TestBed.tick();

        expect(store.notice()?.code).toBe('SLOT_UNAVAILABLE');

        drenar();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('cancelamento', () => {
    it('cancela, recarrega a grade e a lista', async () => {
      await carregar();
      // popula a lista
      store.cancelReservation('res-1');

      http.expectOne(`${API}/reservations/res-1`).flush({ changed: true });
      http.expectOne(`${API}/resources/r1/slots`).flush([slot('s1')]);
      http.expectOne(`${API}/reservations`).flush([]);

      expect(store.notice()?.tone).toBe('success');
      expect(store.cancellingId()).toBeNull();
    });

    it('trata cancelamento repetido como informação, não erro', async () => {
      await carregar();
      store.cancelReservation('res-1');

      // O servidor é idempotente: responde 200 com changed=false.
      http.expectOne(`${API}/reservations/res-1`).flush({ changed: false });
      http.expectOne(`${API}/resources/r1/slots`).flush([slot('s1')]);
      http.expectOne(`${API}/reservations`).flush([]);

      expect(store.notice()?.tone).toBe('info');
    });

    it('descarta cliques repetidos no cancelar', async () => {
      await carregar();

      store.cancelReservation('res-1');
      store.cancelReservation('res-1');
      store.cancelReservation('res-1');

      expect(http.match(`${API}/reservations/res-1`)).toHaveLength(1);
      // limpa o que ficou pendente
      http.match(() => true).forEach((r) => r.flush({ changed: true }));
    });
  });

  describe('delta concorrente durante reserva em voo', () => {
    it('preserva submissão e seleção, e bloqueia o envio se o slot esgotar', async () => {
      await carregar();
      store.toggleSlot('s1');
      store.toggleSlot('s2');
      store.submit();

      const pedido = http.expectOne(`${API}/reservations`);
      expect(store.submitting()).toBe(true);

      // Outro usuário toma um dos slots ENQUANTO a requisição está em voo.
      sse.next({
        kind: 'change',
        payload: {
          type: 'slot-availability-changed',
          slotId: 's2',
          resourceId: 'r1',
          reservedUnits: 1,
          unitsPerSlot: 1,
        },
      });

      expect(store.submitting()).toBe(true);
      expect(store.selection()).toEqual(['s1', 's2']);
      // O slot permanece na seleção, marcado como inválido.
      expect(store.invalidSelection()).toEqual(['s2']);
      expect(store.canSubmit()).toBe(false);

      pedido.flush(
        {
          created: [],
          rejected: [
            {
              slotIds: ['s2'],
              code: 'SLOT_UNAVAILABLE',
              message: 'Este horário já foi reservado.',
            },
          ],
        },
        { status: 409, statusText: 'Conflict' },
      );
      http.expectOne(`${API}/resources/r1/slots`).flush([slot('s1')]);
      http.expectOne(`${API}/reservations`).flush([]);
    });
  });
});
