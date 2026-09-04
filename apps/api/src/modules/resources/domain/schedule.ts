export interface ScheduleWindow {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface ScheduleOptions {
  /** Duração de cada slot, em minutos (ADR 0003). */
  readonly slotMinutes: number;
  /** Quantos dias à frente gerar. */
  readonly horizonDays: number;
  /**
   * Fuso de OPERAÇÃO do recurso. A jornada é definida em horário local — uma
   * sala funciona das 8h às 18h no relógio de quem a usa, não em UTC.
   */
  readonly timeZone: string;
  /** Hora de abertura e fechamento, no fuso de operação. */
  readonly dayStartHour?: number;
  readonly dayEndHour?: number;
}

const DEFAULT_START_HOUR = 8;
const DEFAULT_END_HOUR = 18;

/**
 * Offset do fuso, em milissegundos, no instante dado.
 *
 * Sem biblioteca de datas: `Intl` já sabe as regras de todos os fusos,
 * inclusive horário de verão. A conta é a diferença entre a leitura do
 * instante naquele fuso e a leitura do mesmo instante em UTC.
 */
function offsetAt(timeZone: string, instant: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = Object.fromEntries(
    fmt.formatToParts(instant).map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  const asUtc = Date.UTC(
    Number(parts['year']),
    Number(parts['month']) - 1,
    Number(parts['day']),
    // `hour12: false` pode devolver 24 na virada do dia.
    Number(parts['hour']) % 24,
    Number(parts['minute']),
    Number(parts['second']),
  );

  return asUtc - instant.getTime();
}

/**
 * Converte um horário de parede no fuso dado para o instante UTC correspondente.
 *
 * A dupla aplicação do offset não é redundância: na transição de horário de
 * verão o offset do palpite inicial pode diferir do offset real do instante
 * final, e a segunda passada corrige isso.
 */
function wallClockToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
): Date {
  const guess = Date.UTC(year, month, day, hour, 0, 0, 0);
  const firstPass = guess - offsetAt(timeZone, new Date(guess));
  const secondPass = guess - offsetAt(timeZone, new Date(firstPass));
  return new Date(secondPass);
}

/** Ano, mês e dia de um instante, lidos no fuso dado. */
function civilDate(
  timeZone: string,
  instant: Date,
): { year: number; month: number; day: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  return {
    year: Number(parts['year']),
    month: Number(parts['month']) - 1,
    day: Number(parts['day']),
  };
}

/**
 * Gera a grade de slots discretos de um recurso (ADR 0003).
 *
 * Função pura: recebe o instante inicial em vez de ler o relógio, o que a
 * torna determinística nos testes. É usada tanto pelo cadastro de recursos
 * quanto pelo seed — a duplicação anterior entre os dois era fonte real de
 * divergência.
 *
 * A jornada é interpretada no FUSO DE OPERAÇÃO, não em UTC. Gerar 08:00–18:00
 * UTC fazia a grade aparecer das 05:00 às 15:00 no Brasil — horário comercial
 * começando de madrugada.
 *
 * As janelas ficam alinhadas à grade do dia local, e as que já começaram em
 * relação a `from` são descartadas: criar um recurso às 15h não deve gerar
 * horários das 08h do mesmo dia, que ninguém pode reservar.
 */
export function generateSchedule(
  from: Date,
  options: ScheduleOptions,
): ScheduleWindow[] {
  const {
    slotMinutes,
    horizonDays,
    timeZone,
    dayStartHour = DEFAULT_START_HOUR,
    dayEndHour = DEFAULT_END_HOUR,
  } = options;

  if (slotMinutes <= 0) throw new Error('slotMinutes deve ser positivo.');
  if (horizonDays <= 0) throw new Error('horizonDays deve ser positivo.');
  if (dayEndHour <= dayStartHour) {
    throw new Error('dayEndHour deve ser maior que dayStartHour.');
  }

  const minutosPorDia = (dayEndHour - dayStartHour) * 60;
  if (minutosPorDia % slotMinutes !== 0) {
    // Slots que não fecham a jornada deixariam uma sobra de tempo
    // inalcançável, difícil de explicar na tela.
    throw new Error(
      `A jornada de ${minutosPorDia}min não é divisível por slots de ${slotMinutes}min.`,
    );
  }

  const porDia = minutosPorDia / slotMinutes;
  const hoje = civilDate(timeZone, from);
  const janelas: ScheduleWindow[] = [];

  for (let dia = 0; dia < horizonDays; dia += 1) {
    // A abertura de cada dia é resolvida no fuso local; somar dias em UTC
    // erraria por uma hora nas transições de horário de verão.
    const abertura = wallClockToUtc(
      timeZone,
      hoje.year,
      hoje.month,
      hoje.day + dia,
      dayStartHour,
    );

    for (let i = 0; i < porDia; i += 1) {
      const startsAt = new Date(abertura.getTime() + i * slotMinutes * 60_000);
      // Janela já iniciada não é reservável (regra 5 do ADR 0003) — gerá-la
      // só polui a grade com células mortas.
      if (startsAt.getTime() <= from.getTime()) continue;

      janelas.push({
        startsAt,
        endsAt: new Date(startsAt.getTime() + slotMinutes * 60_000),
      });
    }
  }

  return janelas;
}
