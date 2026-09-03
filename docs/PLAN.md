# Plano de execução

**Prazo:** 2026-09-04 às 15h (inclui validação manual).

## Cronograma e escopo comprometido

Janela real de trabalho: **~4h15 hoje** (03/09, 17h47–22h) e **8h amanhã**
(04/09, 7h–15h) = **12h15**. Descontando README (1,5h) e validação manual (1h),
restam **~9h45 de código** — insuficiente para as fatias 0–3 na estimativa
pessimista (13,5h).

**Escopo comprometido:** fatias **0, 1, 2, 3 e 7**.
**Fora do escopo:** fatias 4 (cancelamento), 5 (cadastros) e 6 (identidade), que
entram apenas se houver folga real. Cada uma vira uma linha no README.

**Cortes dentro das fatias comprometidas**, para caber na janela:

| Corte | Economia | Como é declarado |
|---|---|---|
| Fallback de polling do SSE | ~45min | README: desenhado no ADR 0005, não implementado |
| Estados elaborados do indicador `connection` | ~20min | Badge simples, sem granularidade de reconexão |
| Amplitude dos testes unitários | ~30min | Regras de domínio essenciais, não todas as combinações |

Com esses cortes, as fatias 0–3 caem para **8,5–11,5h**.

### Marcos

| Quando | O quê | Marco |
|---|---|---|
| Hoje 18h–20h | Fatia 0 completa | `docker compose up` sobe API + Postgres |
| Hoje 20h–22h | Fatia 1: schema, migration `EXCLUDE`, use-case, ports | Regra de negócio escrita e testável |
| Amanhã 7h–9h30 | Fatia 1: adapter, endpoints, seed, testes de concorrência | **Crítico** — a tese está provada |
| 9h30–10h30 | Fatia 2: SSE | Evento pós-commit chegando no browser |
| 10h30–13h | Fatia 3: dashboard | Duas abas disputando um slot |
| 13h–14h | Fatia 7: README | Entregável obrigatório |
| 14h–15h | Validação manual + folga | Compose do zero, fluxos, ajustes |

### Regra de replanejamento

Se a **Fatia 1 não estiver fechada às 9h30**, corte a Fatia 2 inteira e faça o
dashboard com refetch após a reserva em vez de SSE. Perde-se o realtime, mas
realtime sem a prova de concorrência não vale nada — a prioridade é inequívoca.

Terminar **hoje** com a Fatia 0 pronta é o item de maior alavancagem do
cronograma: ela concentra o risco de conflito de versões, e descobrir esse
problema às 7h de amanhã custa a manhã inteira.

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

## Fatia 3 — Dashboard

Frontend do fluxo principal. `userId` já atravessa o domínio desde a Fatia 1,
vindo do header sem validação — a casca da identidade vem depois.

- Tailwind + DaisyUI, tema e componentes base (ADR 0007).
- `ResourcesStore`: reducer puro, snapshot + SSE via `scan`, `toSignal`.
- Lista de recursos → grade de slots de 30min.
- Seleção em carrinho, painel de confirmação, "Avançar" (ADR 0011).
- Estados visuais do slot, incluindo *selecionado mas indisponível*.
- Tratamento das falhas da tabela do ADR 0006.
- Indicador de `connection` (live / reconectando / polling).
- **Testes:** reducer puro, e o cenário de delta SSE chegando durante uma
  reserva em voo.

**Pronto quando:** duas abas lado a lado disputam o mesmo slot e a perdedora
recebe `409` com a grade atualizando sozinha.

> **Ponto de corte 2.** Fatias 0–3 entregam o briefing inteiro. Tudo abaixo é
> complemento.

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

## Fatia 7 — Entrega

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
