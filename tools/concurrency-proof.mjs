#!/usr/bin/env node
/**
 * PROVA DE CONCORRÊNCIA AO VIVO — ADR 0004.
 *
 * Roda contra a stack já em pé (`docker compose up -d`) e mede o que a suíte
 * automatizada afirma, mas com a evidência temporal visível: quantas
 * requisições estavam realmente em voo ao mesmo tempo.
 *
 * "Mesmo segundo" seria uma barra fraca — mil requisições espalhadas em um
 * segundo podem nem se cruzar. O que importa é SOBREPOSIÇÃO, e é isso que os
 * números de janela de disparo e de máximo simultâneo mostram.
 *
 *   node tools/concurrency-proof.mjs
 *   node tools/concurrency-proof.mjs --requests=500
 */

const API = process.env.API_URL ?? 'http://localhost:3000/api';
const REQUESTS = Number(
  process.argv.find((a) => a.startsWith('--requests='))?.split('=')[1] ?? 200,
);

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;

let falhas = 0;

function afirma(descricao, condicao, detalhe) {
  const marca = condicao ? green('✓') : red('✗');
  if (!condicao) falhas += 1;
  console.log(`    ${marca} ${descricao}${detalhe ? dim(`  (${detalhe})`) : ''}`);
}

async function api(path, options = {}) {
  const response = await fetch(API + path, options);
  let body = null;
  try {
    body = await response.json();
  } catch {
    /* resposta sem corpo */
  }
  return { status: response.status, body };
}

const headers = (user) => ({
  'x-user-id': user.id,
  'content-type': 'application/json',
});

/**
 * Dispara todas as requisições sem aguardar nenhuma, e mede a sobreposição
 * real: janela de disparo e pico de requisições em voo.
 */
async function dispararSimultaneamente(fabricar, total) {
  const marcas = [];
  const t0 = performance.now();

  const promessas = Array.from({ length: total }, (_, i) => {
    const inicio = performance.now();
    return fabricar(i).then((resultado) => {
      marcas.push({ inicio, fim: performance.now() });
      return resultado;
    });
  });

  const resultados = await Promise.all(promessas);
  const duracao = performance.now() - t0;

  const inicios = marcas.map((m) => m.inicio - t0).sort((a, b) => a - b);
  let pico = 0;
  for (const m of marcas) {
    const emVoo = marcas.filter(
      (x) => x.inicio <= m.inicio && x.fim >= m.inicio,
    ).length;
    pico = Math.max(pico, emVoo);
  }

  return {
    resultados,
    janelaDisparo: inicios[inicios.length - 1] - inicios[0],
    duracao,
    pico,
  };
}

function relatarSobreposicao({ janelaDisparo, duracao, pico }, total) {
  console.log(
    dim(
      `    ${total} requisições disparadas em ${janelaDisparo.toFixed(1)}ms · ` +
        `pico de ${pico} em voo · tudo resolvido em ${duracao.toFixed(0)}ms`,
    ),
  );
}

// ---------------------------------------------------------------------------

async function main() {
  console.log(bold('\n  PROVA DE CONCORRÊNCIA'));
  console.log(dim(`  ${API} · ${REQUESTS} requisições por cenário\n`));

  const saude = await api('/health').catch(() => null);
  if (!saude || saude.status !== 200) {
    console.error(
      red('  A API não respondeu. Suba a stack com `docker compose up -d`.\n'),
    );
    process.exit(1);
  }

  const usuarios = (await api('/users')).body;
  const recursos = (await api('/resources', { headers: headers(usuarios[0]) }))
    .body;

  const sala = recursos.find((r) => r.kind === 'EXCLUSIVE');
  // O menor recurso compartilhado: com poucos usuários no seed, é o único em
  // que a disputa chega ao teto de capacidade e o `UPDATE` condicional recusa.
  const compartilhado = recursos
    .filter((r) => r.kind === 'SHARED')
    .sort((a, b) => a.unitsPerSlot - b.unitsPerSlot)[0];

  console.log(
    dim(
      `  ${usuarios.length} usuários no seed · a restrição "uma reserva por ` +
        `usuário por horário" limita quantos podem vencer\n`,
    ),
  );

  await cenarioExclusivo(usuarios, sala);
  await cenarioCompartilhado(usuarios, compartilhado);
  await cenarioCancelamento(usuarios, compartilhado);

  console.log();
  if (falhas === 0) {
    console.log(green(bold('  Invariante mantida em todos os cenários.\n')));
  } else {
    console.log(red(bold(`  ${falhas} afirmação(ões) falharam.\n`)));
    process.exit(1);
  }
}

/** Recurso de uso exclusivo: a constraint de exclusão decide. */
async function cenarioExclusivo(usuarios, sala) {
  console.log(bold(`  1. EXCLUSIVE — ${REQUESTS} pedidos para o MESMO horário`));
  console.log(dim(`     recurso: ${sala.name} · garantia: EXCLUDE USING gist`));

  const slots = (
    await api(`/resources/${sala.id}/slots`, { headers: headers(usuarios[0]) })
  ).body;
  const alvo = slots.find((s) => s.availableUnits > 0);

  const medida = await dispararSimultaneamente(
    (i) =>
      api('/reservations', {
        method: 'POST',
        headers: headers(usuarios[i % usuarios.length]),
        body: JSON.stringify({ resourceId: sala.id, slotIds: [alvo.id] }),
      }),
    REQUESTS,
  );

  relatarSobreposicao(medida, REQUESTS);

  const criados = medida.resultados.filter((r) => r.status === 201);
  const conflitos = medida.resultados.filter((r) => r.status === 409);
  const erros = medida.resultados.filter((r) => r.status >= 500);

  const codigos = {};
  for (const r of conflitos) {
    const code = r.body?.rejected?.[0]?.code ?? 'SEM_CODE';
    codigos[code] = (codigos[code] ?? 0) + 1;
  }

  const depois = (
    await api(`/resources/${sala.id}/slots`, { headers: headers(usuarios[0]) })
  ).body.find((s) => s.id === alvo.id);

  afirma('exatamente 1 reserva confirmada', criados.length === 1, `${criados.length}`);
  afirma('nenhum erro técnico', erros.length === 0, `${erros.length} × 5xx`);
  afirma(
    'todos os perdedores receberam 409',
    conflitos.length === REQUESTS - 1,
    `${conflitos.length}`,
  );
  afirma(
    'contador do horário ficou em 1',
    depois.reservedUnits === 1,
    `${depois.reservedUnits}/${depois.unitsPerSlot}`,
  );

  console.log(
    dim(
      `    códigos devolvidos: ` +
        Object.entries(codigos)
          .map(([k, v]) => `${k}=${v}`)
          .join(' · '),
    ),
  );
  console.log(
    dim(
      `    ALREADY_RESERVED são as repetições do próprio vencedor — a tela\n` +
        `    precisa distinguir isso de "alguém foi mais rápido" (ADR 0006)`,
    ),
  );
  console.log();
}

/** Recurso compartilhado: o UPDATE atômico condicional decide. */
async function cenarioCompartilhado(usuarios, recurso) {
  const usuariosDistintos = usuarios.length;
  const pedidoTotal = usuariosDistintos * recurso.maxUnitsPerUser;
  console.log(
    bold(
      `  2. SHARED — ${REQUESTS} pedidos de ${recurso.maxUnitsPerUser} unidades ` +
        `num horário de ${recurso.unitsPerSlot}`,
    ),
  );
  console.log(
    dim(
      `     ${usuariosDistintos} usuários distintos pedindo ${pedidoTotal} ` +
        `unidades no total — não cabe`,
    ),
  );
  console.log(
    dim(`     recurso: ${recurso.name} · garantia: UPDATE atômico condicional`),
  );

  const slots = (
    await api(`/resources/${recurso.id}/slots`, {
      headers: headers(usuarios[0]),
    })
  ).body;
  const alvo = slots.find((s) => s.availableUnits === s.unitsPerSlot);

  const medida = await dispararSimultaneamente(
    (i) =>
      api('/reservations', {
        method: 'POST',
        headers: headers(usuarios[i % usuarios.length]),
        body: JSON.stringify({
          resourceId: recurso.id,
          slotIds: [alvo.id],
          // Todos pedem o máximo permitido: assim a soma solicitada excede a
          // capacidade e alguém é recusado POR LOTAÇÃO, não pela restrição
          // de uma reserva por usuário.
          quantity: recurso.maxUnitsPerUser,
        }),
      }),
    REQUESTS,
  );

  relatarSobreposicao(medida, REQUESTS);

  const criados = medida.resultados.filter((r) => r.status === 201);
  const erros = medida.resultados.filter((r) => r.status >= 500);
  const somaConfirmada = criados.reduce(
    (total, r) => total + r.body.created[0].quantity,
    0,
  );

  const depois = (
    await api(`/resources/${recurso.id}/slots`, {
      headers: headers(usuarios[0]),
    })
  ).body.find((s) => s.id === alvo.id);

  afirma('nenhum erro técnico', erros.length === 0, `${erros.length} × 5xx`);
  afirma(
    'contador nunca passou da capacidade',
    depois.reservedUnits <= depois.unitsPerSlot,
    `${depois.reservedUnits}/${depois.unitsPerSlot}`,
  );
  afirma(
    'contador bate exatamente com o que foi cobrado',
    depois.reservedUnits === somaConfirmada,
    `contador=${depois.reservedUnits} soma=${somaConfirmada}`,
  );

  const recusadosPorLotacao = medida.resultados.filter(
    (r) => r.body?.rejected?.[0]?.code === 'SLOT_UNAVAILABLE',
  ).length;

  afirma(
    'pedidos que não cabiam foram recusados',
    recusadosPorLotacao > 0,
    `${recusadosPorLotacao} × SLOT_UNAVAILABLE`,
  );
  console.log(
    dim(
      `    ${criados.length} reservas confirmadas somando ${somaConfirmada} de ` +
        `${depois.unitsPerSlot} unidades\n` +
        `    a condição é \`reserved_units + qty <= units_per_slot\`: um \`< capacidade\`\n` +
        `    ingênuo deixaria passar um pedido de 2 quando resta 1`,
    ),
  );
  console.log();
}

/** O caminho inverso: cancelar e reservar disputando o mesmo horário. */
async function cenarioCancelamento(usuarios, recurso) {
  console.log(bold('  3. CANCELAMENTO concorrente — o caminho inverso'));
  console.log(dim('     garantia: portão atômico WHERE status = CONFIRMED'));

  const slots = (
    await api(`/resources/${recurso.id}/slots`, {
      headers: headers(usuarios[0]),
    })
  ).body;
  const alvo = slots.find((s) => s.availableUnits === s.unitsPerSlot);

  const criada = await api('/reservations', {
    method: 'POST',
    headers: headers(usuarios[0]),
    body: JSON.stringify({
      resourceId: recurso.id,
      slotIds: [alvo.id],
      quantity: 2,
    }),
  });

  const reservationId = criada.body.created[0].id;
  const cancelamentos = Math.min(REQUESTS, 50);

  const medida = await dispararSimultaneamente(
    () =>
      api(`/reservations/${reservationId}`, {
        method: 'DELETE',
        headers: headers(usuarios[0]),
      }),
    cancelamentos,
  );

  relatarSobreposicao(medida, cancelamentos);

  const efetivos = medida.resultados.filter((r) => r.body?.changed === true);
  const erros = medida.resultados.filter((r) => r.status >= 500);

  const depois = (
    await api(`/resources/${recurso.id}/slots`, {
      headers: headers(usuarios[0]),
    })
  ).body.find((s) => s.id === alvo.id);

  afirma('nenhum erro técnico', erros.length === 0, `${erros.length} × 5xx`);
  afirma(
    'exatamente 1 cancelamento teve efeito',
    efetivos.length === 1,
    `${efetivos.length} de ${cancelamentos}`,
  );
  afirma(
    'unidades devolvidas uma única vez',
    depois.reservedUnits === 0,
    `contador=${depois.reservedUnits}`,
  );
  console.log(
    dim(
      `    sem o portão atômico, ${cancelamentos} cancelamentos devolveriam\n` +
        `    ${cancelamentos * 2} unidades e o contador iria a ${-(cancelamentos * 2 - 2)}`,
    ),
  );
}

main().catch((error) => {
  console.error(red(`\n  ${error.message}\n`));
  process.exit(1);
});
