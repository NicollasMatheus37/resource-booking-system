# ADR 0011 — Reserva de múltiplos slots

- **Data:** 2026-09-03
- **Status:** Aceito, **revisado em 2026-09-04** (ver *Revisão*)

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

### Atomicidade: tudo ou nada dentro do bloco

Os slots de uma reserva entram na **mesma transação**. Se o terceiro slot
falhar, os outros não ficam reservados — o rollback é da reserva inteira. Uma
reunião de 2h com um buraco no meio não serve para nada.

> **Revisado em 2026-09-04:** a atomicidade vale por **bloco contíguo**, não
> sobre a seleção inteira. Ver *Revisão* no fim deste documento.

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

**A seleção pode ter lacunas**, e o servidor a quebra em blocos contíguos —
ver *Revisão* abaixo. O limite `Resource.maxSlotsPerReservation` (padrão 4,
equivalente a 2h) vale **por bloco**, já que cada bloco é uma reserva.

### Contrato

```
POST /reservations
{ resourceId, slotIds: string[], quantity?: number }

→ { created: ReservationDto[], rejected: { slotIds, code, message }[] }
```

Status: `201` tudo criado, `207` parcial, `409` nada criado. O corpo tem o
mesmo formato nos três casos, para que o cliente decida sempre pelo mesmo
caminho (ADR 0006).

---

## Revisão — 2026-09-04

A decisão original permitia slots não-contíguos **dentro de uma reserva**, com
atomicidade sobre a seleção inteira. A validação manual mostrou o problema: a
lista de reservas exibia "04/09 · 4 horários" sem dizer **quais**, porque um
conjunto com lacunas não tem um intervalo para mostrar.

A correção é de domínio, não de tela: **uma reserva cobre sempre um bloco
contíguo**. Uma seleção com lacunas produz reservas independentes, uma por
bloco.

### O que mudou

| | Antes | Depois |
|---|---|---|
| Reserva de 09:30 + 13:00 | 1 reserva com 2 slots | 2 reservas de 1 slot |
| Atomicidade | sobre a seleção inteira | **por bloco contíguo** |
| Cancelamento | tudo ou nada | cada bloco separadamente |
| Resultado | `201` ou `409` | pode ser parcial (`207`) |
| Exibição | "4 horários" | um card por bloco, com o intervalo |

### O que se perdeu

A garantia "ou tudo ou nada" deixou de valer sobre a seleção. Pedir 09:30 e
13:00 pode confirmar só um dos dois. Isso é **aceitável e até desejável**: o
argumento original da atomicidade era que uma reunião de 2h com um buraco no
meio não serve para nada — e isso continua valendo **dentro** de cada bloco,
que é onde importa. Dois horários avulsos no mesmo dia não têm essa relação.

### O que se ganhou

O agrupamento vive no **servidor**, não no cliente. Isso não é preferência
estética: se o cliente decidisse os blocos, dois clientes poderiam agrupar
diferente, e a invariante "os slots de uma reserva são contíguos" não seria
verificável do lado que a garante.

A função `groupContiguous` é pura e mede contiguidade em **instantes**
(`atual.startsAt === anterior.endsAt`), não em posições da grade — a regra
continua correta se a duração do slot mudar, e atravessa a virada do dia.

## Alternativas consideradas

- **Clique no início + seletor de duração.** Menos estado na UI e impossível
  selecionar algo inválido. Recusado: força contiguidade e não atende quem quer
  dois horários avulsos no mesmo dia.
- **Agrupar os blocos no cliente**, enviando N requisições. Zero mudança de
  contrato e mais simples. Recusado: o agrupamento é regra de negócio, e
  deixá-lo no cliente tornaria a invariante de contiguidade inverificável no
  servidor.
- **Um card por bloco com cancelamento único** (só apresentação). Não mexeria
  no domínio, mas quatro cards e um só botão de cancelar é mais confuso que
  informativo.
- **Cancelamento parcial de uma reserva multi-bloco.** Exigiria um caso de uso
  novo, com condição de corrida própria — devolver unidades de alguns slots e
  não de outros. Recusado por custo desproporcional frente a simplesmente
  criar reservas separadas.
- **Clique no início, clique no fim.** Intuitivo em calendários, mas exige
  estado intermediário de seleção pendente, tratamento de cancelamento e de
  clique fora — mais casos de UI para testar, e ainda força contiguidade.
- **Drag na grade.** Melhor sensação de uso, o mais caro de construir, e sem
  equivalente óbvio no mobile. Recusado pelo prazo.
- **N requisições, uma por slot.** Simples no backend e **errado**: produziria
  sucesso parcial *dentro* de um bloco contíguo, que é o caso em que ele
  realmente atrapalha.
- **Reserva com `tstzrange` contínuo, sem slots.** Elegante para `EXCLUSIVE`,
  mas quebra o contador de unidades do `SHARED` e a grade determinística do
  dashboard (ADR 0003). Recusado.
- **Exigir contiguidade recusando a seleção com lacunas.** Seria a alternativa
  simétrica à revisão: em vez de quebrar em blocos, negar o pedido. Recusada por
  remover funcionalidade útil — dois horários avulsos no mesmo dia é um caso
  legítimo.

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
