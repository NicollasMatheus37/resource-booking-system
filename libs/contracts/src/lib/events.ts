/**
 * Delta de disponibilidade publicado por SSE após o commit (ADR 0005).
 * O cliente aplica no slot correspondente; o GET continua sendo a verdade.
 */
export interface SlotAvailabilityChanged {
  readonly type: 'slot-availability-changed';
  readonly slotId: string;
  readonly resourceId: string;
  readonly reservedUnits: number;
  readonly unitsPerSlot: number;
}
