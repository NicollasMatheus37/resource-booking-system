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

## Fatia 0 — Fundação (curta)

- Scaffolding Nx: `apps/api`, `apps/web`, `libs/contracts`, `libs/testing`.
- Resolver e **pinar** as versões atuais contra o registry (não assumir).
- `compose.yaml` com Postgres, serviço `migrate` e API.
- Módulo `config` com schema `zod` validado no boot (ADR 0010).
- `/health` e `/ready`.

**Pronto quando:** `docker compose up` sobe API e banco, e uma variável de
ambiente ausente derruba o processo com mensagem clara.

---

## Fatia 1 — O núcleo defensável ← *a fatia que importa*

Backend completo da reserva, sem UI.

- Schema Prisma: `Resource`, `Slot`, `Reservation`, `ReservationSlot`.
- Migration **manual** com o que o Prisma não expressa: `EXCLUDE USING gist`,
  `UNIQUE` parcial, `CHECK` (ADRs 0003 e 0004).
- Use-case `CreateReservation`, atrás de ports, sem conhecer Prisma nem HTTP:
  validações de domínio, ordenação por `startsAt`, transação única.
- Adapter Prisma: `UPDATE` atômico condicional e `INSERT` dos slots.
- Exception filter mapeando erros de domínio para o contrato `code` (ADR 0006).
- `GET /resources` e `GET /resources/:id/slots`.
- Seed: usuários fixos, recursos dos dois `kind`, gerador de slots de 30min.
- **Testes:** unitários do use-case com fakes + os cinco cenários de
  concorrência do ADR 0009 com Testcontainers.
- `docs/concurrency.md` com o resultado dos testes.

**Pronto quando:** os testes de concorrência passam com N alto. A partir daqui,
as duas perguntas do briefing têm resposta demonstrável mesmo sem frontend.

> **Ponto de corte 1.** Se algo der muito errado, esta fatia + README já é uma
> entrega defensável, ainda que incompleta.

---

## Fatia 2 — Realtime

- Publisher de evento pós-commit e `@Sse('/events/availability')` (ADR 0005).
- Heartbeat e `Last-Event-ID`.
- Teste: reservar dispara evento com o delta correto.

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
