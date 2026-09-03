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
    await pronto;
  }

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
        id: 'res-1',
        resourceId: 'r1',
        userId: 'user-1',
        quantity: 1,
        status: 'CONFIRMED',
        slotIds: ['s1'],
        createdAt: '2026-09-04T00:00:00.000Z',
      });

      http.expectOne(`${API}/resources/r1/slots`).flush([
        slot('s1', { reservedUnits: 1, availableUnits: 0, reservedByMe: true }),
      ]);

      expect(store.selection()).toEqual([]);
      expect(store.notice()?.tone).toBe('success');
    });

    it('409 SLOT_UNAVAILABLE reconcilia a grade', async () => {
      await carregar();
      store.toggleSlot('s1');
      store.submit();

      http.expectOne(`${API}/reservations`).flush(
        { code: 'SLOT_UNAVAILABLE', message: 'Este horário já foi reservado.' },
        { status: 409, statusText: 'Conflict' },
      );

      http.expectOne(`${API}/resources/r1/slots`).flush([
        slot('s1', { reservedUnits: 1, availableUnits: 0 }),
      ]);

      expect(store.notice()?.code).toBe('SLOT_UNAVAILABLE');
      expect(store.submitting()).toBe(false);
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
        { code: 'SLOT_UNAVAILABLE', message: 'Este horário já foi reservado.' },
        { status: 409, statusText: 'Conflict' },
      );
      http.expectOne(`${API}/resources/r1/slots`).flush([slot('s1')]);
    });
  });
});
