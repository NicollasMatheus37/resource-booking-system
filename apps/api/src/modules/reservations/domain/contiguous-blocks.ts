export interface TimeWindow {
  readonly id: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/**
 * Agrupa slots em BLOCOS CONTÍGUOS (ADR 0011, revisado).
 *
 * Uma reserva cobre sempre um bloco contíguo. Uma seleção com lacunas — 09:30
 * e 13:00, por exemplo — produz reservas independentes, uma por bloco, cada
 * uma cancelável sozinha.
 *
 * Esta regra vive no domínio, e não no cliente, por dois motivos: o
 * agrupamento é conhecimento de negócio, e a invariante "os slots de uma
 * reserva são contíguos" só é verificável se o servidor decidir o
 * agrupamento.
 *
 * Os blocos saem ordenados por início, e os slots dentro de cada bloco
 * também — é a ordenação que elimina deadlock (ADR 0011).
 */
export function groupContiguous<T extends TimeWindow>(slots: readonly T[]): T[][] {
  if (slots.length === 0) return [];

  const ordenados = [...slots].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );

  const blocos: T[][] = [[ordenados[0]]];

  for (let i = 1; i < ordenados.length; i += 1) {
    const anterior = ordenados[i - 1];
    const atual = ordenados[i];

    // Contíguo = o próximo começa exatamente onde o anterior termina.
    // Comparar instantes, e não posições na grade, mantém a regra correta se
    // a duração do slot mudar.
    if (atual.startsAt.getTime() === anterior.endsAt.getTime()) {
      blocos[blocos.length - 1].push(atual);
    } else {
      blocos.push([atual]);
    }
  }

  return blocos;
}
