# ADR 0009 — Estratégia de testes e gates de CI

- **Data:** 2026-09-03
- **Status:** Aceito

## Contexto

O briefing exige "testable by design" e cobertura mínima da regra de negócio da
reserva. Com prazo até 2026-09-04, cobertura ampla não é viável nem desejável: o
esforço tem que ir onde o risco está, que é a concorrência.

Testar concorrência tem uma armadilha específica: mock de banco **não prova
nada**. Um repositório falso não tem MVCC, não tem row lock e não tem constraint
de exclusão — ele passaria com uma implementação incorreta. O teste que importa
precisa de Postgres real.

## Decisão

Três camadas, com propósitos distintos e explícitos.

### 1. Unitário — regra de negócio sem infraestrutura

Alvo: os use-cases em `modules/*/application`, com as ports substituídas por
fakes em memória (`libs/testing`).

Cobre as regras que **não** dependem do banco: slot no passado, recurso inativo,
`quantity` fora de `maxUnitsPerUser`, `EXCLUSIVE` forçando `quantity = 1`,
mapeamento de erro de domínio. Milissegundos por teste, sem Docker.

É a validação de que o desenho hexagonal do ADR 0001 funciona: se um use-case
não puder ser testado assim, o acoplamento vazou.

### 2. Integração — as garantias do banco

Alvo: repositórios e migrations contra **Postgres real** via **Testcontainers**,
levantado uma vez por suíte.

Cobre o que só o banco garante: a constraint `EXCLUDE`, o `UNIQUE` parcial, os
`CHECK`, e o comportamento do `UPDATE` condicional retornando `rowsAffected = 0`.

Testcontainers em vez de um Postgres do compose porque o teste passa a ser
auto-contido: sem estado compartilhado entre execuções, sem "funciona na minha
máquina", e roda igual em CI.

### 3. Concorrência — a prova do ADR 0004

O teste mais importante do repositório. Dispara N requisições **genuinamente
simultâneas** (`Promise.all` sobre a aplicação Nest completa, contra Postgres
real) e afirma o invariante.

| Cenário | Setup | Asserção |
|---|---|---|
| `EXCLUSIVE` | N usuários, 1 slot de sala | exatamente 1 `201`, N-1 `409 SLOT_UNAVAILABLE`, `reserved_units = 1` |
| `SHARED` | N usuários, `quantity` variado, slot de 30 unidades | soma das quantidades confirmadas ≤ 30 e igual a `reserved_units`, zero overbooking |
| Idempotência | mesmo usuário, mesmo slot, 2 requisições | 1 `201`, 1 `409 ALREADY_RESERVED`, `reserved_units` inalterado após a segunda |
| Multi-slot atômico | 2 usuários pedindo intervalos que se sobrepõem parcialmente | zero sucesso parcial: o perdedor não fica com nenhum slot do seu pedido |
| Deadlock | N usuários pedindo os mesmos slots em ordens opostas | zero erro de deadlock do Postgres — prova a ordenação por `startsAt` do ADR 0011 |

Roda com N alto o suficiente para gerar contenção real (centenas), não 2 ou 3.
Um teste de concorrência que não gera contenção passa por acidente.

### 4. Frontend

- **Reducer do store puro** (ADR 0006), testado sem TestBed: aplicação de
  snapshot, delta de SSE, e cada `code` da tabela de tratamento de falha.
- **Store** com `HttpTestingController` e stream de SSE falso — incluindo o
  caso em que um delta de SSE chega **enquanto** uma reserva está em voo, que é
  onde o estado divergiria se o desenho estivesse errado.
- Componentes presentational não têm teste dedicado no MVP: são funções de
  estado para markup, e o custo/benefício no prazo não fecha. Decisão consciente.

### Gates de CI

O pipeline falha se: lint falhar, algum teste falhar, ou o teste de concorrência
não passar. Esse último é gate **não negociável** — ele é a prova viva do
ADR 0004, e sem ele a decisão arquitetural vira alegação.

Cobertura numérica **não** é gate. Um limiar de percentual incentiva testar o
que é fácil; o gate aqui é qualitativo e nominal: os cenários da tabela acima
existem e passam.

## Alternativas consideradas

- **Mockar o banco nos testes de concorrência.** Rápido e inútil. Recusado pelo
  motivo do Contexto: provaria a implementação contra si mesma.
- **Postgres do `compose` em vez de Testcontainers.** Menos uma dependência,
  mas cria estado compartilhado entre execuções e acopla o teste ao ambiente.
  Recusado.
- **Teste de carga com k6/artillery.** Mediria vazão, que não é a pergunta. A
  pergunta é correção sob contenção, e isso um teste de integração responde
  melhor e roda em CI. Anotado como extensão se sobrar tempo.
- **E2E com Playwright.** Alto valor de demonstração — duas abas disputando um
  slot ao vivo é convincente. Recusado no prazo; o mesmo efeito se obtém na
  demonstração manual, e o custo de setup não cabe.
- **Meta de cobertura percentual.** Recusada acima.

## Consequências

- **Custo:** a suíte precisa de Docker disponível para rodar (Testcontainers).
  Documentado no README como pré-requisito.
- **Custo:** o teste de concorrência é o mais lento do repositório, na casa de
  dezenas de segundos. Aceito: é o único que prova a tese do projeto.
- **Custo:** componentes de UI ficam sem teste. Risco assumido e declarado.
- **Ganho:** as regras de negócio rodam em milissegundos sem Docker, o que
  mantém o loop de desenvolvimento rápido, enquanto as garantias reais são
  verificadas onde de fato vivem — no Postgres.
