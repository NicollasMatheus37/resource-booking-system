import { generateSchedule } from './schedule';

const TZ = 'America/Sao_Paulo';

/** 04/09/2026 03:00 em São Paulo — antes da abertura. */
const MADRUGADA = new Date('2026-09-04T06:00:00.000Z');
/** 04/09/2026 15:32 em São Paulo — meio da jornada. */
const MEIO_DIA = new Date('2026-09-04T18:32:11.000Z');

/** Hora de parede no fuso de operação. */
function horaLocal(d: Date, timeZone = TZ): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

describe('generateSchedule', () => {
  it('gera a jornada completa quando começa antes da abertura', () => {
    const janelas = generateSchedule(MADRUGADA, {
      slotMinutes: 30,
      horizonDays: 7,
      timeZone: TZ,
    });

    // 10h de jornada / 30min = 20 slots por dia.
    expect(janelas).toHaveLength(20 * 7);
  });

  it('abre e fecha no HORÁRIO LOCAL, não em UTC', () => {
    const janelas = generateSchedule(MADRUGADA, {
      slotMinutes: 30,
      horizonDays: 1,
      timeZone: TZ,
    });

    // O bug original: 08:00–18:00 UTC virava 05:00–15:00 no Brasil, e a grade
    // de uma sala de reunião começava de madrugada.
    expect(horaLocal(janelas[0].startsAt)).toBe('08:00');
    expect(horaLocal(janelas[janelas.length - 1].endsAt)).toBe('18:00');
  });

  it('nenhuma janela cai fora da jornada local', () => {
    const janelas = generateSchedule(MADRUGADA, {
      slotMinutes: 30,
      horizonDays: 7,
      timeZone: TZ,
    });

    for (const janela of janelas) {
      const hora = Number(horaLocal(janela.startsAt).slice(0, 2));
      expect(hora).toBeGreaterThanOrEqual(8);
      expect(hora).toBeLessThan(18);
    }
  });

  it('produz janelas contíguas e sem sobreposição', () => {
    const janelas = generateSchedule(MADRUGADA, {
      slotMinutes: 30,
      horizonDays: 2,
      timeZone: TZ,
    });

    const mesmoDia = janelas.slice(0, 20);
    for (let i = 1; i < mesmoDia.length; i += 1) {
      expect(mesmoDia[i].startsAt.getTime()).toBe(
        mesmoDia[i - 1].endsAt.getTime(),
      );
    }
  });

  it('descarta janelas do dia que já começaram', () => {
    const janelas = generateSchedule(MEIO_DIA, {
      slotMinutes: 30,
      horizonDays: 1,
      timeZone: TZ,
    });

    // Às 15:32 local, restam 16:00, 16:30, 17:00 e 17:30.
    expect(janelas).toHaveLength(4);
    expect(horaLocal(janelas[0].startsAt)).toBe('16:00');
    expect(
      janelas.every((j) => j.startsAt.getTime() > MEIO_DIA.getTime()),
    ).toBe(true);
  });

  it('os dias seguintes saem completos mesmo começando no meio de hoje', () => {
    const janelas = generateSchedule(MEIO_DIA, {
      slotMinutes: 30,
      horizonDays: 3,
      timeZone: TZ,
    });

    expect(janelas).toHaveLength(4 + 20 + 20);
  });

  it('respeita outro fuso de operação', () => {
    const janelas = generateSchedule(MADRUGADA, {
      slotMinutes: 60,
      horizonDays: 1,
      timeZone: 'Europe/Lisbon',
      dayStartHour: 9,
      dayEndHour: 12,
    });

    expect(janelas).toHaveLength(3);
    expect(horaLocal(janelas[0].startsAt, 'Europe/Lisbon')).toBe('09:00');
  });

  it('atravessa transição de horário de verão sem deslocar a jornada', () => {
    const NY = 'America/New_York';
    // Nova York entra no horário de verão em 08/03/2026. A janela cobre dias
    // antes e depois da virada.
    const janelas = generateSchedule(new Date('2026-03-06T04:00:00.000Z'), {
      slotMinutes: 60,
      horizonDays: 5,
      timeZone: NY,
      dayStartHour: 9,
      dayEndHour: 12,
    });

    // Agrupa por dia LOCAL e confere a abertura de cada um. Contar por índice
    // seria frágil: o primeiro dia pode vir parcial ou vazio.
    const porDia = new Map<string, Date[]>();
    for (const janela of janelas) {
      const dia = new Intl.DateTimeFormat('en-CA', {
        timeZone: NY,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(janela.startsAt);
      porDia.set(dia, [...(porDia.get(dia) ?? []), janela.startsAt]);
    }

    // Cobre 08/03, o dia da virada.
    expect([...porDia.keys()]).toContain('2026-03-08');

    for (const [, inicios] of porDia) {
      expect(horaLocal(inicios[0], NY)).toBe('09:00');
      expect(inicios).toHaveLength(3);
    }
  });

  it('recusa duração que não fecha a jornada', () => {
    expect(() =>
      generateSchedule(MADRUGADA, {
        slotMinutes: 45,
        horizonDays: 1,
        timeZone: TZ,
      }),
    ).toThrow(/divisível/);
  });

  it('recusa parâmetros inválidos', () => {
    expect(() =>
      generateSchedule(MADRUGADA, { slotMinutes: 0, horizonDays: 1, timeZone: TZ }),
    ).toThrow();
    expect(() =>
      generateSchedule(MADRUGADA, { slotMinutes: 30, horizonDays: 0, timeZone: TZ }),
    ).toThrow();
    expect(() =>
      generateSchedule(MADRUGADA, {
        slotMinutes: 30,
        horizonDays: 1,
        timeZone: TZ,
        dayStartHour: 18,
        dayEndHour: 8,
      }),
    ).toThrow();
  });
});
