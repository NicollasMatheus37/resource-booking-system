export interface ResourceLike {
  id: string;
  kind: 'EXCLUSIVE' | 'SHARED';
  unitsPerSlot: number;
  maxUnitsPerUser: number;
  maxSlotsPerReservation: number;
  active: boolean;
}

export interface SlotLike {
  id: string;
  resourceId: string;
  startsAt: Date;
  endsAt: Date;
  unitsPerSlot: number;
  reservedUnits: number;
}

export function aResource(overrides: Partial<ResourceLike> = {}): ResourceLike {
  return {
    id: 'resource-1',
    kind: 'EXCLUSIVE',
    unitsPerSlot: 1,
    maxUnitsPerUser: 1,
    maxSlotsPerReservation: 4,
    active: true,
    ...overrides,
  };
}

export function aSharedResource(
  overrides: Partial<ResourceLike> = {},
): ResourceLike {
  return aResource({
    kind: 'SHARED',
    unitsPerSlot: 30,
    maxUnitsPerUser: 4,
    ...overrides,
  });
}

/** Slots de 30 minutos, contíguos, a partir de `start`. */
export function slotSequence(
  count: number,
  options: { resourceId?: string; start?: Date; unitsPerSlot?: number } = {},
): SlotLike[] {
  const resourceId = options.resourceId ?? 'resource-1';
  const start = options.start ?? new Date('2026-09-05T09:00:00.000Z');
  const unitsPerSlot = options.unitsPerSlot ?? 1;

  return Array.from({ length: count }, (_, i) => {
    const startsAt = new Date(start.getTime() + i * 30 * 60_000);
    return {
      id: `slot-${i + 1}`,
      resourceId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
      unitsPerSlot,
      reservedUnits: 0,
    };
  });
}
