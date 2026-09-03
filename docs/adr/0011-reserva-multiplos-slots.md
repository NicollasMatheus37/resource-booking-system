# ADR 0011 — Reserva de múltiplos slots

- **Data:** 2026-09-03
- **Status:** Aceito

## Contexto

A janela de slot é de **30 minutos**. Uma reunião de 2h são 4 slots, e exigir
quatro reservas separadas seria um fluxo hostil — além de errado: as quatro
reservas poderiam ter sucesso parcial, deixando o usuário com 09:00, 09:30 e
11:00, mas não 10:00.

Isso deixa de ser detalhe de UI e vira decisão de domínio e de concorrência.

## Decisão

### Modelo: reserva agrupa slots

A reserva deixa de apontar para um slot e passa a agrupar vários:

```
Reservation      { id, resourceId, userId, quantity, status, createdAt }
ReservationSlot  { reservationId, slotId }        // 1..N linhas
```

As invariantes 1 e 3 do ADR 0003 migram para `ReservationSlot`: a constraint
`EXCLUDE` e o `UNIQUE (slot_id, user_id) WHERE status = 'CONFIRMED'` passam a
viver ali, sem mudar de natureza.

`quantity` continua na `Reservation` e vale **uniformemente** para todos os slots
do grupo: reservar 4 ingressos das 09:00 às 11:00 toma 4 unidades em cada um dos
4 slots.

### Atomicidade: tudo ou nada

Os N slots entram na **mesma transação**. Se o terceiro slot falhar, os outros
três não ficam reservados — o rollback é do grupo inteiro. O erro retornado diz
**qual** slot falhou, para a UI marcar a célula específica em vez de invalidar a
seleção toda.

Isso torna a transação um pouco mais longa que a de slot único, mas ela continua
contendo apenas escritas no banco — nenhuma chamada externa (ADR 0004).

### Deadlock: ordenação determinística

Este é o risco novo que a decisão introduz. Dois usuários pedindo intervalos que
se cruzam em ordens diferentes travam um ao outro:

| | João pede 09:00–11:00 | Maria pede 10:30–09:30 |
|---|---|---|
| t1 | trava 09:00 | trava 10:30 |
| t2 | espera 09:30 | espera 10:00 |
| t3 | espera 10:30 (de Maria) | espera 09:00 (de João) |

O Postgres detecta o ciclo e aborta uma das transações, mas isso é latência e um
erro que o usuário não deveria ver.

**A regra:** toda transação grava os slots **ordenados por `startsAt`
ascendente**, sem exceção. Uma ordem global consistente torna o ciclo
impossível por construção — não existem duas transações se cruzando em direções
opostas. A ordenação acontece no use-case, num único ponto, e é coberta por
teste dedicado (ADR 0009).

Essa é a razão de a regra existir, e ela precisa estar comentada no código: sem
o comentário, um refactor futuro "limpa" o `sort` por parecer supérfluo.

### Seleção: carrinho, não intervalo

O usuário **marca os slots que quer** na grade e clica em **Avançar**. Um painel
de confirmação resume a seleção (e coleta `quantity` em recursos `SHARED`) antes
do envio.

**A seleção não precisa ser contígua.** Marcar 09:00 e 14:00 na mesma reserva é
permitido: o modelo de agrupamento já suporta, e não validar contiguidade é
menos código e mais flexível. O limite é `Resource.maxSlotsPerReservation`
(padrão 4, equivalente a 2h contíguas), regra de domínio testável sem banco.

### Contrato

```
POST /reservations
{ resourceId, slotIds: string[], quantity?: number }
```

Um único request, um único `201` ou um único `409` — nunca sucesso parcial.

## Alternativas consideradas

- **Clique no início + seletor de duração.** Menos estado na UI e impossível
  selecionar algo inválido. Recusado: força contiguidade e não atende quem quer
  dois horários avulsos no mesmo dia.
- **Clique no início, clique no fim.** Intuitivo em calendários, mas exige
  estado intermediário de seleção pendente, tratamento de cancelamento e de
  clique fora — mais casos de UI para testar, e ainda força contiguidade.
- **Drag na grade.** Melhor sensação de uso, o mais caro de construir, e sem
  equivalente óbvio no mobile. Recusado pelo prazo.
- **N requisições, uma por slot.** Simples no backend e **errado**: produz
  sucesso parcial, que é exatamente o problema que este ADR existe para evitar.
- **Reserva com `tstzrange` contínuo, sem slots.** Elegante para `EXCLUSIVE`,
  mas quebra o contador de unidades do `SHARED` e a grade determinística do
  dashboard (ADR 0003). Recusado.
- **Exigir contiguidade.** Recusado por ser código a mais para remover
  funcionalidade. Se o requisito aparecer, é uma linha de validação no use-case.

## Consequências

- **Custo:** transação mais longa e mais linhas travadas por reserva, o que
  aumenta a contenção sob carga. Mitigado pela ordenação determinística e pelos
  timeouts curtos do ADR 0004.
- **Custo:** a ordenação por `startsAt` é uma daquelas linhas cuja importância é
  invisível. Exige comentário no código e teste que falha se ela sumir.
- **Custo:** a UI ganha estado de seleção, que precisa reagir a eventos SSE — um
  slot selecionado pode ser tomado por outro usuário antes do "Avançar"
  (tratado no ADR 0006).
- **Ganho:** o teste de concorrência fica substancialmente mais forte. N usuários
  disputando intervalos **parcialmente sobrepostos** é um cenário mais próximo do
  real e mais convincente que N usuários disputando um slot único.
