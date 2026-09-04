import type { SlotDto } from '@resource-booking/contracts';
import type {
  DashboardAction,
  DashboardState,
  Notice,
} from './dashboard.state';

/**
 * Reducer puro do dashboard.
 *
 * A tela tem DUAS fontes concorrentes de mudança: a ação do próprio usuário e
 * os eventos SSE de outras pessoas. Concentrar as duas aqui é o que torna a
 * reconciliação possível de raciocinar — e testável sem TestBed, sem HTTP e
 * sem browser (ADR 0006).
 */
export function dashboardReducer(
  state: DashboardState,
  action: DashboardAction,
): DashboardState {
  switch (action.type) {
    case 'load-started':
      return { ...state, status: 'loading', notice: null };

    case 'resources-loaded':
      return { ...state, resources: action.resources };

    case 'resource-selected':
      // A seleção é limpa ao trocar de recurso: uma reserva só agrupa slots
      // do mesmo recurso (invariante 7 do ADR 0003).
      return {
        ...state,
        selectedResourceId: action.resourceId,
        selection: [],
        quantity: 1,
        slots: {},
        slotOrder: [],
        status: 'loading',
        notice: null,
      };

    case 'slots-loaded':
      return {
        ...state,
        status: 'ready',
        slots: Object.fromEntries(action.slots.map((s) => [s.id, s])),
        slotOrder: action.slots.map((s) => s.id),
        // A seleção sobrevive ao refetch, mas descarta o que sumiu da grade.
        selection: state.selection.filter((id) =>
          action.slots.some((s) => s.id === id),
        ),
      };

    case 'load-failed':
      return {
        ...state,
        status: 'error',
        notice: { tone: 'error', message: action.message },
      };

    case 'slot-toggled': {
      const slot = state.slots[action.slotId];
      if (!slot) return state;

      const marcado = state.selection.includes(action.slotId);
      if (marcado) {
        return {
          ...state,
          selection: state.selection.filter((id) => id !== action.slotId),
          notice: null,
        };
      }

      // Slot esgotado não entra na seleção. O que já estava selecionado e
      // esgotou permanece — ver 'availability-changed'.
      if (slot.availableUnits <= 0 || slot.reservedByMe) return state;

      const limite = maxSlots(state);
      if (state.selection.length >= limite) {
        return {
          ...state,
          notice: {
            tone: 'warning',
            message:
              limite === 1
                ? 'Esta reserva permite no máximo 1 horário.'
                : `Esta reserva permite no máximo ${limite} horários seguidos.`,
          },
        };
      }

      return {
        ...state,
        selection: [...state.selection, action.slotId],
        notice: null,
      };
    }

    case 'selection-cleared':
      return { ...state, selection: [], notice: null };

    case 'quantity-changed':
      return { ...state, quantity: action.quantity };

    case 'submit-started':
      return { ...state, submitting: true, notice: null };

    case 'submit-settled': {
      // Uma seleção com lacunas produz várias reservas independentes, e o
      // resultado pode ser PARCIAL (ADR 0011). A tela precisa dizer o que
      // passou E o que não passou, na mesma frase.
      const { createdBlocks, createdSlots, rejected } = action;

      if (createdBlocks === 0) {
        return {
          ...state,
          submitting: false,
          // Seleção preservada: o usuário pode ajustar e tentar de novo.
          notice: {
            tone: rejected.every((r) => r.code === 'ALREADY_RESERVED')
              ? 'info'
              : 'error',
            message:
              rejected[0]?.message ?? 'Não foi possível reservar.',
            code: rejected[0]?.code as Notice['code'],
          },
        };
      }

      const base =
        createdSlots === 1
          ? '1 horário reservado.'
          : createdBlocks === 1
            ? `${createdSlots} horários reservados.`
            : `${createdSlots} horários reservados em ${createdBlocks} reservas.`;

      if (rejected.length === 0) {
        return {
          ...state,
          submitting: false,
          selection: [],
          quantity: 1,
          notice: { tone: 'success', message: base },
        };
      }

      const perdidos = rejected.reduce((n, r) => n + r.slotIds.length, 0);
      const restantes =
        perdidos === 1
          ? 'Outro horário não estava mais disponível.'
          : `Outros ${perdidos} horários não estavam mais disponíveis.`;

      return {
        ...state,
        submitting: false,
        // Só o que foi reservado sai da seleção; o que falhou permanece
        // marcado para o usuário decidir.
        selection: state.selection.filter((id) =>
          rejected.some((r) => r.slotIds.includes(id)),
        ),
        notice: { tone: 'warning', message: `${base} ${restantes}` },
      };
    }

    case 'submit-failed':
      return {
        ...state,
        submitting: false,
        notice: {
          tone: action.code === 'ALREADY_RESERVED' ? 'info' : 'error',
          message: action.message,
          code: action.code ?? undefined,
        },
      };

    case 'availability-changed': {
      const slot = state.slots[action.slotId];
      // Evento de recurso que não está na tela: ignorado sem erro.
      if (!slot) return state;

      const atualizado: SlotDto = {
        ...slot,
        reservedUnits: action.reservedUnits,
        unitsPerSlot: action.unitsPerSlot,
        availableUnits: action.unitsPerSlot - action.reservedUnits,
      };

      // O slot marcado que esgotou PERMANECE na seleção, sinalizado.
      //
      // Removê-lo silenciosamente seria mais simples e mentiroso: o usuário
      // clicaria em "Avançar" e reservaria algo diferente do que via na tela
      // (ADR 0006).
      const afetaSelecao =
        state.selection.includes(action.slotId) &&
        atualizado.availableUnits <= 0;

      return {
        ...state,
        slots: { ...state.slots, [action.slotId]: atualizado },
        notice: afetaSelecao
          ? {
              tone: 'warning',
              message:
                'Um horário da sua seleção acabou de ser reservado por outra pessoa.',
            }
          : state.notice,
      };
    }

    case 'connection-changed':
      return { ...state, connection: action.connection };

    case 'notice-dismissed':
      return { ...state, notice: null };

    case 'reservations-loaded':
      return { ...state, myReservations: action.reservations };

    case 'cancel-started':
      return { ...state, cancellingId: action.reservationId, notice: null };

    case 'cancel-succeeded':
      return {
        ...state,
        cancellingId: null,
        notice: action.changed
          ? { tone: 'success', message: 'Reserva cancelada.' }
          : // Cancelar de novo não é erro: o resultado desejado já vigora.
            { tone: 'info', message: 'Esta reserva já estava cancelada.' },
      };

    case 'editor-opened':
      return {
        ...state,
        editor: action.resource
          ? { mode: 'edit', resource: action.resource }
          : { mode: 'create' },
        notice: null,
      };

    case 'editor-closed':
      return { ...state, editor: null, savingResource: false };

    case 'resource-save-started':
      return { ...state, savingResource: true, notice: null };

    case 'resource-saved':
      // Sem aviso aqui de propósito: o aviso é emitido DEPOIS do refresh, que
      // pode trocar o recurso selecionado — e trocar de recurso limpa o aviso.
      return { ...state, savingResource: false, editor: null };

    case 'notice-shown':
      return { ...state, notice: action.notice };

    case 'resource-save-failed':
      // O formulário CONTINUA aberto: fechar perderia o que o usuário digitou.
      return {
        ...state,
        savingResource: false,
        notice: { tone: 'error', message: action.message },
      };

    case 'cancel-failed':
      return {
        ...state,
        cancellingId: null,
        notice: { tone: 'error', message: action.message },
      };

    default:
      return state;
  }
}

export function selectedResource(state: DashboardState) {
  return (
    state.resources.find((r) => r.id === state.selectedResourceId) ?? null
  );
}

export function maxSlots(state: DashboardState): number {
  return selectedResource(state)?.maxSlotsPerReservation ?? 1;
}

/** Slots marcados que deixaram de estar disponíveis enquanto aguardavam. */
export function invalidSelection(state: DashboardState): readonly string[] {
  return state.selection.filter((id) => {
    const slot = state.slots[id];
    return !slot || slot.availableUnits <= 0;
  });
}

/** "Avançar" só habilita com seleção válida e nada em voo. */
export function canSubmit(state: DashboardState): boolean {
  return (
    !state.submitting &&
    state.selection.length > 0 &&
    invalidSelection(state).length === 0
  );
}
