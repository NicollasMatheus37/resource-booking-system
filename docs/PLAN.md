# Plano de execução

**Prazo:** 2026-09-04 às 15h (inclui validação manual).

## Retrospecto — executado em 2026-09-03, das 17h47 às 20h15

**Todas as sete fatias foram concluídas**, incluindo as três que haviam sido
declaradas fora de escopo. O escopo comprometido era 0–3 e 7; entregou-se 0–7.

| Fatia | Estimativa | Real | Conclusão |
|---|---|---|---|
| 0 — Fundação | 1,5–2h | ~28min | 18h15 |
| 1 — Núcleo defensável | 4–5,5h | ~38min | 18h53 |
| 2 — Realtime | 1–1,5h | ~9min | 19h02 |
| 3 — Dashboard | 3,5–4,5h | ~14min | 19h16 |
| 4 — Cancelamento | 1,5–2h | ~11min | 19h27 |
| 5 — Cadastros | 2–2,5h | ~16min | 19h43 |
| 6 — Identidade | 1h | ~10min | 19h53 |
| 7 — Entrega | 1,5–2h | ~22min | 20h15 |
| **Total** | **16–21h** | **~2h28** | |

### Por que a estimativa errou por uma ordem de magnitude

As estimativas foram feitas em horas de trabalho humano com revisão manual, e a
execução foi geração assistida com verificação automatizada. O gargalo previsto
— revisão linha a linha — foi absorvido pelos testes.

Isso **não** significa que o trabalho foi trivial. O que mudou foi o custo de
escrever e verificar, não o de decidir: as decisões arquiteturais e os cortes
de escopo consumiram tempo real e aparecem nos ADRs.

### Cortes que não precisaram acontecer

Estavam planejados três cortes para caber na janela. Nenhum foi necessário, mas
apenas um deles foi de fato implementado depois:

| Corte planejado | Situação final |
|---|---|
| Fallback de polling do SSE | **Não implementado** — segue declarado como limitação no README |
| Indicador de conexão simplificado | Implementado completo (ao vivo / reconectando / conectando) |
| Amplitude dos testes unitários | Não foi necessário reduzir |

### O que a verificação real pegou e os testes não

Esta é a lição mais transferível do exercício. Vários defeitos só apareceram
rodando a aplicação de verdade:

| Defeito | Como apareceu |
|---|---|
| Dono da reserva recebia `SLOT_UNAVAILABLE` em vez de `ALREADY_RESERVED` em recurso exclusivo | Verificação manual via HTTP — o teste de idempotência usava recurso compartilhado |
| `env.js` gerado malformado (o `sed` prefixava todas as linhas) | Só apareceu rodando o container, não no build |
| Aviso "Recurso criado" sumia da tela | Dirigindo a UI no navegador |
| Requisições disparadas antes de haver identidade, gerando 401s | Console do navegador |
| Slots do passado gerados ao criar recurso à tarde | Teste que falhou às 19h e teria passado às 9h |
| `docker compose --scale api=3` não funcionava (porta fixa) | Tentando executar a própria afirmação do README |
| Contraste insuficiente em dois elementos | Auditoria `axe-core` |

O último é significativo: a afirmação sobre escala estava **escrita no README
antes de ser testada**. Rodar o comando revelou que era falsa, e a correção
gerou tanto o override de compose quanto uma prova nova — a invariante
mantendo-se entre processos distintos, que é a evidência mais forte do ADR 0004.

### Estado final

| Suíte | Testes |
|---|---|
| Unitários da API (sem Docker) | 32 |
| Integração com Postgres real | 24 |
| Frontend | 35 |
| Violações de acessibilidade (axe, WCAG 2.1 AA) | 0 |

---

O plano é organizado em **fatias**, não em camadas. Cada fatia termina num
estado entregável, e as fatias estão em ordem de valor decrescente para a
avaliação. Se o tempo colapsar, o que sobra cortado é periférico — nunca a
defesa arquitetural.

A ordem das fatias é ordem de **execução**, não de prioridade de entrega: a
Fatia 7 (README) vem por último no tempo e é obrigatória. Ver *Regra de corte*
no fim deste documento.

---

## Fatia 0 — Fundação ✅ concluída em 03/09 às 18h15

- [x] Scaffolding Nx: `apps/api`, `apps/web`, `libs/contracts`, `libs/testing`.
- [x] Versões resolvidas contra o registry e pinadas (dois desvios no ADR 0001).
- [x] `compose.yaml` com Postgres 18, API e frontend. Serviço `migrate` entra na
      Fatia 1, junto com o Prisma.
- [x] Módulo `config` com schema `zod` validado no boot (ADR 0010).
- [x] `/health` e `/ready`.
- [x] Tailwind 4 + DaisyUI 5 compilando no bundle do Angular.
- [x] `env.js` gerado em runtime, com allowlist e serialização por `jq`.

**Verificado na prática:**

| Verificação | Resultado |
|---|---|
| `docker compose up --build` do zero | 3 serviços saudáveis |
| `GET /api/health` e `/api/ready` | `200` |
| API sem `DATABASE_URL` | mensagem legível apontando a variável, exit 1 |
| `env.js` com payload `";alert(1);//</script>` | escapado dentro da string; JS válido |
| `nx run-many -t lint test build` | 8/8 tarefas passando |

**Percalços que consumiram tempo** (registrados por serem informação real sobre a
stack, não desabafo):

- O gerador do Angular recusa o setup de TypeScript project references que o modo
  de pnpm workspaces do Nx 23 impõe. Levou a refazer o scaffolding no modo
  integrado — ver ADR 0001.
- `corepack` foi removido do Node 26; as imagens instalam pnpm via `npm -g`.
- Postgres 18 mudou o mount recomendado para `/var/lib/postgresql`.
- A primeira versão do `env.js` saía malformada (o `sed` prefixava todas as
  linhas) e o erro de config vinha como stack trace de injeção. Ambos só
  apareceram porque a fatia foi testada de verdade, não só compilada.

---

## Fatia 1 — O núcleo defensável ✅ concluída em 03/09 às 18h53

- [x] Schema Prisma: `Resource`, `Slot`, `Reservation`, `ReservationSlot`.
- [x] Migration manual com `EXCLUDE USING gist`, `UNIQUE` parcial e `CHECK`s.
- [x] Use-case `CreateReservation` atrás de ports, sem Prisma nem HTTP.
- [x] Adapter Prisma com `UPDATE` atômico condicional e transação única.
- [x] Exception filter traduzindo erro de domínio para `code` (ADR 0006).
- [x] `GET /resources`, `GET /resources/:id/slots`, `POST /reservations`.
- [x] Identidade simulada (`IdentityGuard`) — antecipada da Fatia 6, porque o
      `userId` atravessa o domínio desde o início e o guard custou minutos.
- [x] Seed com os dois `kind` e 700 slots.
- [x] 22 testes unitários (sem Docker) + 5 de concorrência (Testcontainers).
- [x] `docs/concurrency.md` com a prova.

**Verificado na prática:**

| Verificação | Resultado |
|---|---|
| 200 usuários, 1 slot exclusivo | 1× `201`, 199× `409 SLOT_UNAVAILABLE`, zero `5xx` |
| 200 usuários, quantidades 1–4, slot de 30 unidades | zero overbooking, contador igual à soma confirmada |
| 60 usuários, janelas sobrepostas, metade em ordem invertida | zero deadlock, zero sucesso parcial |
| Constraints via `psql` | exclusão, `CHECK` de contador e `CHECK` de coerência todas bloqueiam |
| `docker compose up` do zero + seed + fluxo real | reserva, conflito e limites com o `code` correto |

**Bug real encontrado pela verificação manual:** em recurso `EXCLUSIVE` o
contador atinge o teto com uma reserva, então o `UPDATE` atômico falhava antes
da constraint de unicidade — e o próprio dono recebia `SLOT_UNAVAILABLE` em vez
de `ALREADY_RESERVED`. Os testes de concorrência não pegaram porque o cenário de
idempotência usava recurso `SHARED`. Corrigido e coberto por teste novo.

**Outros percalços:** o Prisma 7 moveu a connection string para
`prisma.config.ts` e passou a exigir driver adapter; ele devolve código próprio
(`P2002`) em vez do SQLSTATE, com o nome da constraint só no texto; o último
estágio do Dockerfile vira o alvo padrão do build; e o `zsh` não faz
word-splitting, o que produziu um falso negativo na primeira verificação manual.

> **Ponto de corte 1 atingido.** As duas perguntas do briefing já têm resposta
> demonstrável, com prova executável, mesmo sem frontend.

---

## Fatia 2 — Realtime ✅ concluída em 03/09 às 19h02

- [x] Port `AvailabilityPublisher` — o use-case publica sem conhecer o
      transporte, e a publicação acontece só depois do commit.
- [x] `@Sse('events/availability')` com `id` por evento e heartbeat de 25s.
- [x] Testes de integração lendo o stream cru: formato do protocolo, delta
      pós-commit, e ausência de evento quando a reserva é recusada.

**Verificado na stack real** (`docker compose`), com `fetch` streaming:

```
event: availability
id: 1
data: {"type":"slot-availability-changed","slotId":"8238...","reservedUnits":4,"unitsPerSlot":100}
```

**Decisão registrada:** o endpoint SSE é **público**, por necessidade técnica —
o `EventSource` do browser não permite headers customizados, então o
`x-user-id` não chega. É aceitável porque o payload não tem dado de usuário:
são contadores que o `GET /resources/:id/slots` já expõe. Se o stream um dia
carregar dado por usuário, a autorização terá de vir por cookie ou query
string.

**Não implementado:** replay por `Last-Event-ID`. O `id` é emitido, mas não há
buffer de eventos no servidor. Isso é coerente com o ADR 0005 — na reconexão o
cliente refaz o snapshot, e o `GET` é a fonte da verdade.

---

## Fatia 3 — Dashboard ✅ concluída em 03/09 às 19h16

- [x] Tailwind + DaisyUI, componentes de apresentação com `OnPush`.
- [x] Reducer puro (`dashboard.reducer.ts`) — todo o estado passa por ele.
- [x] Store com signals + RxJS: `switchMap` no fetch, `exhaustMap` na submissão.
- [x] Lista de recursos → grade de slots de 30min agrupada por dia.
- [x] Seleção em carrinho não-contígua e barra de confirmação (ADR 0011).
- [x] Estados visuais do slot, incluindo *selecionado mas indisponível*.
- [x] Tabela de tratamento de falhas do ADR 0006, decidindo pelo `code`.
- [x] Indicador de conexão (ao vivo / reconectando / conectando).
- [x] Seletor de usuário — a casca da identidade, antecipada da Fatia 6.
- [x] **Testes:** 17 no reducer (sem TestBed) + 7 no store com HTTP e SSE
      falsos, incluindo delta concorrente durante reserva em voo.

**Verificado com duas abas reais**, dirigidas por Playwright na imagem oficial
(sem instalar nada no host):

| Passo | Resultado |
|---|---|
| Conexão SSE | badge "ao vivo" |
| Ana marca 3 horários não-contíguos | barra mostra "3 horário(s) selecionado(s)" |
| Ana confirma | "3 horários reservados" |
| Bruno, **sem recarregar** | grade atualiza e avisa "Um horário da sua seleção acabou de ser reservado por outra pessoa" |
| Seleção de Bruno | slot **permanece**, marcado "tomado"; "Avançar" desabilitado |

Capturas em [`img/`](img/).

**Percalços:** `waitUntil: 'networkidle'` do Playwright nunca resolve com SSE
aberto — a conexão é permanente por design; usar `domcontentloaded`. O Chromium
do host não tinha as libs de sistema, resolvido rodando o driver na imagem
oficial com `--network host`.

> **Ponto de corte 2 atingido.** As fatias 0–3 entregam o briefing inteiro.

---

## Fatia 4 — Cancelamento

Fatia própria, **acima** dos cadastros, porque tem peso arquitetural: cancelar é
o caminho inverso da concorrência.

- Use-case `CancelReservation`: devolve as unidades de todos os slots do grupo
  pelo mesmo `UPDATE` atômico, na mesma ordem por `startsAt` (ADR 0011).
- Transição `CONFIRMED → CANCELLED`, idempotente: cancelar duas vezes não
  devolve unidades duas vezes.
- Evento SSE pós-commit, para as outras abas verem o slot liberar.
- "Minhas reservas" no frontend, com ação de cancelar.
- **Testes:** cancelamento concorrente com nova reserva do mesmo slot, e
  cancelamento duplo simultâneo — o segundo não pode mexer no contador.

Cancelar sem cuidado é o jeito mais fácil de furar a invariante em sentido
contrário: `reserved_units` abaixo de zero, ou uma unidade devolvida duas vezes.
Por isso vale mais para a avaliação que o CRUD que vem depois.

---

## Fatia 5 — Cadastros

- CRUD de recursos: nome, `kind`, `unitsPerSlot`, `maxUnitsPerUser`,
  `maxSlotsPerReservation`, ativo.
- Geração de slots ao criar recurso.

Puramente funcional, sem novidade arquitetural. É a primeira coisa a cortar se o
tempo apertar.

---

## Fatia 6 — Identidade

- `IdentityGuard` validando `x-user-id` contra a tabela (ADR 0008).
- `IdentityStore` e seletor de usuário no topo.
- Interceptor HTTP anexando o header.
- `CanActivateFn` na rota do dashboard.

Deliberadamente por último: é a casca, e nada acima precisa ser refeito por
causa dela.

---

## Fatia 7 — Entrega ✅ concluída em 03/09 às 20h15

- [x] README com execução, as duas respostas do briefing, decisões e
      limitações declaradas.
- [x] Auditoria de acessibilidade com `axe-core` em quatro estados da
      aplicação — **zero violações** (WCAG 2.1 A/AA).
- [x] Override de compose para escala horizontal, com a invariante verificada
      entre três processos distintos.
- [x] Validação final: `docker compose build --no-cache` e `up` do zero, com
      volume limpo.

**Acessibilidade — o que mudou.** A auditoria reprovou dois elementos por
contraste (11px em peso 600 sobre fundo quase branco). A correção não foi
escurecer o vermelho: ações destrutivas passaram a ter contorno neutro e
**confirmação explícita**, porque o sinal de perigo vindo só da cor já era
frágil — e um botão vermelho pequeno ao lado de "editar" convidava ao clique
acidental. Um problema de acessibilidade que expôs um problema de UX.

> **O README é entregável obrigatório, não uma fatia opcional.**
>
> Ele aparece por último na ordem de execução porque só pode ser finalizado
> quando o resto existe — **não** porque pode ser cortado. Nenhuma entrega
> acontece sem ele, em nenhum cenário de aperto de prazo. O briefing o exige
> nominalmente ("README.md impecável" e o parágrafo de decisões), e é o artefato
> que o avaliador lê primeiro.
>
> Reserve tempo para ele **antes** de começar a Fatia 5, e rascunhe-o ao longo
> do caminho: cada fatia concluída atualiza a seção correspondente. Terminar o
> código e descobrir que sobraram vinte minutos para o README é a falha mais
> comum nesse tipo de entrega — e a mais cara, porque torna todo o trabalho de
> arquitetura invisível.

- **README** com:
  - `docker compose up` e nada mais para rodar;
  - o parágrafo de decisões arquiteturais e trade-offs, com link para os ADRs;
  - a resposta às duas perguntas do briefing (race condition e estado no
    Angular);
  - as limitações declaradas: identidade insegura (ADR 0008), SSE sem fan-out
    entre réplicas (ADR 0005), componentes de UI sem teste (ADR 0009);
  - o que ficou de fora e por quê.
- Revisão de acessibilidade: foco visível, `aria-busy`, `aria-live`.
- Passada final nos ADRs para refletir o que de fato foi construído.

---

## Regra de corte

Se o tempo apertar, corte de baixo para cima — **exceto a Fatia 7**, que é
inegociável.

Ordem de sacrifício: Cadastros (5) → Identidade (6) → Cancelamento (4).

Nunca corte:

1. **O README (Fatia 7).** É entregável exigido pelo briefing. Sem ele, o
   trabalho de arquitetura fica invisível e a entrega está incompleta por
   definição, por melhor que o código esteja.
2. **Os testes de concorrência (Fatia 1).** São a prova de que o ADR 0004 é
   verdade e não alegação.

Toda funcionalidade cortada vira uma linha no README dizendo **o que** foi
deixado de fora e **por quê**. Omissão declarada lê como decisão; omissão
silenciosa lê como descuido.
