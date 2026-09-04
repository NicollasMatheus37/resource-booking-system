import { groupContiguous, type TimeWindow } from './contiguous-blocks';

const BASE = new Date('2026-09-05T11:00:00.000Z').getTime();

/** Slot de 30min no índice `i` da grade. */
function slot(i: number, id = `s${i}`): TimeWindow {
  const startsAt = new Date(BASE + i * 30 * 60_000);
  return { id, startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60_000) };
}

describe('groupContiguous', () => {
  it('seleção vazia não produz bloco', () => {
    expect(groupContiguous([])).toEqual([]);
  });

  it('slot único é um bloco', () => {
    const blocos = groupContiguous([slot(0)]);
    expect(blocos).toHaveLength(1);
    expect(blocos[0].map((s) => s.id)).toEqual(['s0']);
  });

  it('quatro slots seguidos são UM bloco — as 2h do ADR 0011', () => {
    const blocos = groupContiguous([slot(0), slot(1), slot(2), slot(3)]);
    expect(blocos).toHaveLength(1);
    expect(blocos[0]).toHaveLength(4);
  });

  it('lacuna quebra em blocos independentes', () => {
    const blocos = groupContiguous([slot(0), slot(1), slot(5), slot(6)]);

    expect(blocos).toHaveLength(2);
    expect(blocos[0].map((s) => s.id)).toEqual(['s0', 's1']);
    expect(blocos[1].map((s) => s.id)).toEqual(['s5', 's6']);
  });

  it('slots avulsos viram um bloco cada', () => {
    const blocos = groupContiguous([slot(0), slot(3), slot(7)]);

    expect(blocos).toHaveLength(3);
    expect(blocos.every((b) => b.length === 1)).toBe(true);
  });

  it('ordena a entrada antes de agrupar', () => {
    // O cliente pode enviar em qualquer ordem; o agrupamento não depende disso.
    const blocos = groupContiguous([slot(6), slot(0), slot(5), slot(1)]);

    expect(blocos).toHaveLength(2);
    expect(blocos[0].map((s) => s.id)).toEqual(['s0', 's1']);
    expect(blocos[1].map((s) => s.id)).toEqual(['s5', 's6']);
  });

  it('slots dentro de cada bloco saem ordenados por início', () => {
    const blocos = groupContiguous([slot(2), slot(0), slot(1)]);

    const inicios = blocos[0].map((s) => s.startsAt.getTime());
    expect(inicios).toEqual([...inicios].sort((a, b) => a - b));
  });

  it('atravessa a virada do dia quando as janelas se tocam', () => {
    // Contiguidade é medida em instantes, não em dia civil.
    const noite: TimeWindow = {
      id: 'noite',
      startsAt: new Date('2026-09-05T23:30:00.000Z'),
      endsAt: new Date('2026-09-06T00:00:00.000Z'),
    };
    const madrugada: TimeWindow = {
      id: 'madrugada',
      startsAt: new Date('2026-09-06T00:00:00.000Z'),
      endsAt: new Date('2026-09-06T00:30:00.000Z'),
    };

    expect(groupContiguous([noite, madrugada])).toHaveLength(1);
  });

  it('janelas de durações diferentes que se tocam formam um bloco', () => {
    const meia: TimeWindow = {
      id: 'meia',
      startsAt: new Date(BASE),
      endsAt: new Date(BASE + 30 * 60_000),
    };
    const uma: TimeWindow = {
      id: 'uma',
      startsAt: new Date(BASE + 30 * 60_000),
      endsAt: new Date(BASE + 90 * 60_000),
    };

    expect(groupContiguous([meia, uma])).toHaveLength(1);
  });
});
