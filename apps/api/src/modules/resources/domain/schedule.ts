export interface ScheduleWindow {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface ScheduleOptions {
  /** Duração de cada slot, em minutos (ADR 0003). */
  readonly slotMinutes: number;
  /** Quantos dias à frente gerar. */
  readonly horizonDays: number;
  /** Hora de abertura e fechamento, em UTC. */
  readonly dayStartHour?: number;
  readonly dayEndHour?: number;
}

const DEFAULT_START_HOUR = 8;
const DEFAULT_END_HOUR = 18;

/**
 * Gera a grade de slots discretos de um recurso (ADR 0003).
 *
 * Função pura: recebe o instante inicial em vez de ler o relógio, o que a
 * torna determinística nos testes. É usada tanto pelo cadastro de recursos
 * quanto pelo seed — a duplicação anterior entre os dois era fonte real de
 * divergência.
 *
 * As janelas ficam ALINHADAS à grade do dia (08:00, 08:30, …), mas as que já
 * começaram em relação a `from` são descartadas: criar um recurso às 15h não
 * deve gerar horários das 08h do mesmo dia, que ninguém pode reservar.
 */
export function generateSchedule(
  from: Date,
  options: ScheduleOptions,
): ScheduleWindow[] {
  const {
    slotMinutes,
    horizonDays,
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
  const janelas: ScheduleWindow[] = [];

  for (let dia = 0; dia < horizonDays; dia += 1) {
    const base = new Date(from);
    base.setUTCDate(base.getUTCDate() + dia);
    base.setUTCHours(dayStartHour, 0, 0, 0);

    for (let i = 0; i < porDia; i += 1) {
      const startsAt = new Date(base.getTime() + i * slotMinutes * 60_000);
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
