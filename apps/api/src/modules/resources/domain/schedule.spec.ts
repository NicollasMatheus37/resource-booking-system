import { generateSchedule } from './schedule';

/** Antes da abertura: o primeiro dia sai completo. */
const MADRUGADA = new Date('2026-09-05T03:00:00.000Z');
/** No meio da jornada: parte do primeiro dia já passou. */
const MEIO_DIA = new Date('2026-09-05T15:32:11.000Z');

describe('generateSchedule', () => {
  it('gera a jornada completa quando começa antes da abertura', () => {
    const janelas = generateSchedule(MADRUGADA, {
      slotMinutes: 30,
      horizonDays: 7,
    });

    // 10h de jornada / 30min = 20 slots por dia.
    expect(janelas).toHaveLength(20 * 7);
  });

  it('alinha à grade do dia', () => {
    const [primeiro] = generateSchedule(MADRUGADA, {
      slotMinutes: 30,
      horizonDays: 1,
    });

    expect(primeiro.startsAt.toISOString()).toBe('2026-09-05T08:00:00.000Z');
    expect(primeiro.endsAt.toISOString()).toBe('2026-09-05T08:30:00.000Z');
  });

  it('descarta janelas do dia que já começaram', () => {
    const janelas = generateSchedule(MEIO_DIA, {
      slotMinutes: 30,
      horizonDays: 1,
    });

    // Às 15:32, restam 16:00, 16:30, 17:00 e 17:30.
    expect(janelas).toHaveLength(4);
    expect(janelas[0].startsAt.toISOString()).toBe('2026-09-05T16:00:00.000Z');
    // Criar um recurso à tarde não deve gerar horários da manhã do mesmo dia.
    expect(
      janelas.every((j) => j.startsAt.getTime() > MEIO_DIA.getTime()),
    ).toBe(true);
  });

  it('os dias seguintes saem completos mesmo começando no meio de hoje', () => {
    const janelas = generateSchedule(MEIO_DIA, {
      slotMinutes: 30,
      horizonDays: 3,
    });

    expect(janelas).toHaveLength(4 + 20 + 20);
  });

  it('produz janelas contíguas e sem sobreposição', () => {
    const janelas = generateSchedule(MADRUGADA, {
      slotMinutes: 30,
      horizonDays: 1,
    });

    for (let i = 1; i < janelas.length; i += 1) {
      expect(janelas[i].startsAt.getTime()).toBe(
        janelas[i - 1].endsAt.getTime(),
      );
    }
  });

  it('respeita duração e jornada customizadas', () => {
    const janelas = generateSchedule(MADRUGADA, {
      slotMinutes: 60,
      horizonDays: 1,
      dayStartHour: 9,
      dayEndHour: 12,
    });

    expect(janelas).toHaveLength(3);
    expect(janelas[0].startsAt.getUTCHours()).toBe(9);
    expect(janelas[2].endsAt.getUTCHours()).toBe(12);
  });

  it('recusa duração que não fecha a jornada', () => {
    // Uma jornada de 10h com slots de 45min deixaria sobra inalcançável.
    expect(() =>
      generateSchedule(MADRUGADA, { slotMinutes: 45, horizonDays: 1 }),
    ).toThrow(/divisível/);
  });

  it('recusa parâmetros inválidos', () => {
    expect(() =>
      generateSchedule(MADRUGADA, { slotMinutes: 0, horizonDays: 1 }),
    ).toThrow();
    expect(() =>
      generateSchedule(MADRUGADA, { slotMinutes: 30, horizonDays: 0 }),
    ).toThrow();
    expect(() =>
      generateSchedule(MADRUGADA, {
        slotMinutes: 30,
        horizonDays: 1,
        dayStartHour: 18,
        dayEndHour: 8,
      }),
    ).toThrow();
  });
});
