import type { ResourceDto, SlotDto } from '@resource-booking/contracts';
import {
  canSubmit,
  dashboardReducer,
  invalidSelection,
} from './dashboard.reducer';
import { initialState, type DashboardState } from './dashboard.state';

const recurso: ResourceDto = {
  id: 'r1',
  name: 'Sala Azul',
  description: null,
  kind: 'EXCLUSIVE',
  unitsPerSlot: 1,
  maxUnitsPerUser: 1,
  maxSlotsPerReservation: 4,
  seats: 10,
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

function pronto(slots: SlotDto[] = [slot('s1'), slot('s2'), slot('s3')]) {
  let state: DashboardState = initialState;
  state = dashboardReducer(state, {
    type: 'resources-loaded',
    resources: [recurso],
  });
  state = dashboardReducer(state, {
    type: 'resource-selected',
    resourceId: 'r1',
  });
  return dashboardReducer(state, { type: 'slots-loaded', slots });
}

describe('dashboardReducer', () => {
  describe('seleção em carrinho', () => {
    it('marca e desmarca slots', () => {
      let state = pronto();
      state = dashboardReducer(state, { type: 'slot-toggled', slotId: 's1' });
      expect(state.selection).toEqual(['s1']);

      state = dashboardReducer(state, { type: 'slot-toggled', slotId: 's1' });
      expect(state.selection).toEqual([]);
    });

    it('aceita seleção não-contígua', () => {
      let state = pronto();
      state = dashboardReducer(state, { type: 'slot-toggled', slotId: 's1' });
      state = dashboardReducer(state, { type: 'slot-toggled', slotId: 's3' });
      expect(state.selection).toEqual(['s1', 's3']);
    });

    it('não marca slot esgotado', () => {
      let state = pronto([slot('s1', { availableUnits: 0, reservedUnits: 1 })]);
      state = dashboardReducer(state, { type: 'slot-toggled', slotId: 's1' });
      expect(state.selection).toEqual([]);
    });

    it('recusa passar de maxSlotsPerReservation e explica', () => {
      const slots = ['s1', 's2', 's3', 's4', 's5'].map((id) => slot(id));
      let state = pronto(slots);
      for (const id of ['s1', 's2', 's3', 's4', 's5']) {
        state = dashboardReducer(state, { type: 'slot-toggled', slotId: id });
      }
      expect(state.selection).toHaveLength(4);
      expect(state.notice?.tone).toBe('warning');
    });

    it('limpa a seleção ao trocar de recurso', () => {
      let state = pronto();
      state = dashboardReducer(state, { type: 'slot-toggled', slotId: 's1' });
      state = dashboardReducer(state, {
        type: 'resource-selected',
        resourceId: 'r2',
      });
      expect(state.selection).toEqual([]);
      expect(state.slotOrder).toEqual([]);
    });
  });

  describe('delta de SSE', () => {
    it('atualiza um slot sem recriar os demais', () => {
      const state = pronto();
      const antes = state.slots['s2'];

      const depois = dashboardReducer(state, {
        type: 'availability-changed',
        slotId: 's1',
        reservedUnits: 1,
        unitsPerSlot: 1,
      });

      expect(depois.slots['s1'].availableUnits).toBe(0);
      // Identidade preservada: o `@for` do Angular não re-renderiza o resto.
      expect(depois.slots['s2']).toBe(antes);
    });

    it('ignora evento de slot que não está na tela', () => {
      const state = pronto();
      const depois = dashboardReducer(state, {
        type: 'availability-changed',
        slotId: 'de-outro-recurso',
        reservedUnits: 5,
        unitsPerSlot: 10,
      });
      expect(depois).toBe(state);
    });

    it('MANTÉM na seleção o slot que esgotou, sinalizando', () => {
      let state = pronto();
      state = dashboardReducer(state, { type: 'slot-toggled', slotId: 's1' });
      state = dashboardReducer(state, { type: 'slot-toggled', slotId: 's2' });

      state = dashboardReducer(state, {
        type: 'availability-changed',
        slotId: 's1',
        reservedUnits: 1,
        unitsPerSlot: 1,
      });

      // Remover silenciosamente faria o usuário reservar algo diferente do
      // que via na tela (ADR 0006).
      expect(state.selection).toEqual(['s1', 's2']);
      expect(invalidSelection(state)).toEqual(['s1']);
      expect(canSubmit(state)).toBe(false);
      expect(state.notice?.tone).toBe('warning');
    });
  });

  describe('delta chegando durante uma reserva em voo', () => {
    it('não perde o estado de submissão nem a seleção', () => {
      let state = pronto();
      state = dashboardReducer(state, { type: 'slot-toggled', slotId: 's2' });
      state = dashboardReducer(state, { type: 'submit-started' });
      expect(state.submitting).toBe(true);

      state = dashboardReducer(state, {
        type: 'availability-changed',
        slotId: 's3',
        reservedUnits: 1,
        unitsPerSlot: 1,
      });

      expect(state.submitting).toBe(true);
      expect(state.selection).toEqual(['s2']);
      expect(state.slots['s3'].availableUnits).toBe(0);
    });
  });

  describe('resultado da reserva', () => {
    it('tudo criado limpa a seleção e avisa', () => {
      let state = pronto();
      state = dashboardReducer(state, { type: 'slot-toggled', slotId: 's1' });
      state = dashboardReducer(state, { type: 'submit-started' });
      state = dashboardReducer(state, {
        type: 'submit-settled',
        createdBlocks: 1,
        createdSlots: 1,
        rejected: [],
      });

      expect(state.selection).toEqual([]);
      expect(state.submitting).toBe(false);
      expect(state.notice?.tone).toBe('success');
    });

    it('menciona as reservas separadas quando a seleção tinha lacunas', () => {
      let state = pronto();
      state = dashboardReducer(state, { type: 'submit-started' });
      state = dashboardReducer(state, {
        type: 'submit-settled',
        createdBlocks: 2,
        createdSlots: 3,
        rejected: [],
      });

      expect(state.notice?.tone).toBe('success');
      expect(state.notice?.message).toContain('2 reservas');
    });

    it('resultado PARCIAL mantém na seleção só o que falhou', () => {
      let state = pronto();
      state = dashboardReducer(state, { type: 'slot-toggled', slotId: 's1' });
      state = dashboardReducer(state, { type: 'slot-toggled', slotId: 's3' });
      state = dashboardReducer(state, { type: 'submit-started' });
      state = dashboardReducer(state, {
        type: 'submit-settled',
        createdBlocks: 1,
        createdSlots: 1,
        rejected: [
          {
            slotIds: ['s3'],
            code: 'SLOT_UNAVAILABLE',
            message: 'Este horário já foi reservado.',
          },
        ],
      });

      // O que passou sai da seleção; o que falhou permanece para o usuário
      // decidir — remover tudo esconderia o que deu errado.
      expect(state.selection).toEqual(['s3']);
      expect(state.notice?.tone).toBe('warning');
      expect(state.notice?.message).toContain('não estavam mais disponíveis');
    });

    it('nada criado preserva a seleção inteira e usa a mensagem do servidor', () => {
      let state = pronto();
      state = dashboardReducer(state, { type: 'slot-toggled', slotId: 's1' });
      state = dashboardReducer(state, { type: 'submit-started' });
      state = dashboardReducer(state, {
        type: 'submit-settled',
        createdBlocks: 0,
        createdSlots: 0,
        rejected: [
          {
            slotIds: ['s1'],
            code: 'SLOT_UNAVAILABLE',
            message: 'Este horário já foi reservado.',
          },
        ],
      });

      expect(state.selection).toEqual(['s1']);
      expect(state.notice?.tone).toBe('error');
      expect(state.notice?.code).toBe('SLOT_UNAVAILABLE');
    });

    it('ALREADY_RESERVED é informativo, não erro', () => {
      let state = pronto();
      state = dashboardReducer(state, { type: 'submit-started' });
      state = dashboardReducer(state, {
        type: 'submit-settled',
        createdBlocks: 0,
        createdSlots: 0,
        rejected: [
          {
            slotIds: ['s1'],
            code: 'ALREADY_RESERVED',
            message: 'Você já tem uma reserva neste horário.',
          },
        ],
      });

      // A contagem do slot NÃO mudou — tratar como erro faria a tela sugerir
      // uma reconciliação desnecessária (ADR 0006).
      expect(state.notice?.tone).toBe('info');
      expect(state.notice?.code).toBe('ALREADY_RESERVED');
    });
  });

  describe('canSubmit', () => {
    it('exige seleção', () => {
      expect(canSubmit(pronto())).toBe(false);
    });

    it('bloqueia enquanto há requisição em voo', () => {
      let state = pronto();
      state = dashboardReducer(state, { type: 'slot-toggled', slotId: 's1' });
      expect(canSubmit(state)).toBe(true);

      state = dashboardReducer(state, { type: 'submit-started' });
      expect(canSubmit(state)).toBe(false);
    });
  });
});
