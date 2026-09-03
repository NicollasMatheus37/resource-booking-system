import type {
  ApiErrorCode,
  ResourceDto,
  SlotDto,
} from '@resource-booking/contracts';

export type ConnectionState = 'connecting' | 'live' | 'offline';

export interface Notice {
  readonly tone: 'success' | 'warning' | 'error' | 'info';
  readonly message: string;
  readonly code?: ApiErrorCode;
}

export interface DashboardState {
  readonly resources: readonly ResourceDto[];
  readonly selectedResourceId: string | null;
  /** Normalizado por id: o delta de SSE atualiza um slot em O(1). */
  readonly slots: Readonly<Record<string, SlotDto>>;
  /** Ordem de exibição, mantida à parte do mapa. */
  readonly slotOrder: readonly string[];
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  /** Carrinho de slots marcados (ADR 0011). Não precisa ser contíguo. */
  readonly selection: readonly string[];
  readonly quantity: number;
  readonly submitting: boolean;
  readonly connection: ConnectionState;
  readonly notice: Notice | null;
}

export const initialState: DashboardState = {
  resources: [],
  selectedResourceId: null,
  slots: {},
  slotOrder: [],
  status: 'idle',
  selection: [],
  quantity: 1,
  submitting: false,
  connection: 'connecting',
  notice: null,
};

export type DashboardAction =
  | { type: 'load-started' }
  | { type: 'resources-loaded'; resources: readonly ResourceDto[] }
  | { type: 'resource-selected'; resourceId: string }
  | { type: 'slots-loaded'; slots: readonly SlotDto[] }
  | { type: 'load-failed'; message: string }
  | { type: 'slot-toggled'; slotId: string }
  | { type: 'selection-cleared' }
  | { type: 'quantity-changed'; quantity: number }
  | { type: 'submit-started' }
  | { type: 'submit-succeeded'; slotIds: readonly string[] }
  | {
      type: 'submit-failed';
      code: ApiErrorCode | null;
      message: string;
      slotId?: string;
    }
  | {
      type: 'availability-changed';
      slotId: string;
      reservedUnits: number;
      unitsPerSlot: number;
    }
  | { type: 'connection-changed'; connection: ConnectionState }
  | { type: 'notice-dismissed' };
