# ADR 0003 — Modelo de domínio: slots fixos e tipos de recurso

- **Data:** 2026-09-03
- **Status:** Aceito (substitui a versão inicial que usava um campo `capacity` ambíguo)

## Contexto

O briefing cita salas de reunião, vagas de garagem e ingressos VIP. Esses três
exemplos **não** têm a mesma regra de concorrência, e tratá-los com um único
campo `capacity` gerou ambiguidade real: `capacity` podia ser lido como "quantas
pessoas cabem na sala" (descritivo, não restringe nada) ou "quantas reservas
simultâneas o recurso aceita" (que é o que governa a disputa).

Este ADR desfaz essa ambiguidade.

## Decisão

### Slot

Um **slot** é uma janela de tempo fixa de **um** recurso, **pré-gerada** pelo
sistema. O usuário não informa horário: ele escolhe um slot que já existe.

**Janela: 30 minutos. Horizonte: 7 dias à frente.** Trinta minutos é o menor
grão útil para salas e permite reservas de 2h em 4 slots (ADR 0011). Sete dias
dão volume suficiente para a grade parecer um sistema real sem inchar o banco de
testes — com 5 recursos, são ~1.400 slots, o que carrega instantaneamente e
mantém os testes de integração rápidos.

| id | resource | startsAt | endsAt |
|---|---|---|---|
| s1 | Sala Azul | 04/09 08:00 | 04/09 09:00 |
| s2 | Sala Azul | 04/09 09:00 | 04/09 10:00 |

A grade do dashboard é essa tabela renderizada. Cada célula tem id próprio, o
que torna o delta de SSE trivial: "o slot `s2` mudou" (ADR 0005).

### Tipo de recurso

A regra de concorrência é uma propriedade **do recurso**, definida no cadastro
pela natureza dele. Os slots a herdam no momento da geração.

**`EXCLUSIVE`** — reservar toma o recurso inteiro naquela janela.

> Sala Azul, s2 (09h–10h). João reserva. Maria tenta em seguida → `409`. A sala é
> do João até as 10h, mesmo que ele vá sozinho e caibam 10 pessoas.

Sala de reunião, vaga numerada (A-14), consultório.

**`SHARED`** — o recurso é um conjunto de N unidades intercambiáveis naquela
janela. Reservar toma unidades, e o slot segue disponível enquanto sobrar alguma.

> Garagem Setor B, 30 vagas, s2. João toma 1 → sobram 29. Maria toma 2 → 27. A
> partir de 30 tomadas → `409`.

Setor de garagem sem vaga fixa, ingressos VIP de um lote, mesas de coworking.

O critério prático é uma pergunta: **as unidades são intercambiáveis?** Se o
usuário não se importa com *qual* vaga recebe, é `SHARED`. Se ele reserva
*aquela* sala, é `EXCLUSIVE`.

Nos bastidores `EXCLUSIVE` é o caso `unitsPerSlot = 1`. O que muda é a garantia
que o Postgres aplica: constraint de exclusão para 1, contador atômico para N
(ADR 0004).

### Entidades

```
Resource {
  id, name, description, active
  kind: 'EXCLUSIVE' | 'SHARED'
  unitsPerSlot: number           // 1 quando EXCLUSIVE
  maxUnitsPerUser: number        // teto por usuário por slot; 1 quando EXCLUSIVE
  maxSlotsPerReservation: number // teto de slots por reserva; padrão 4 = 2h (ADR 0011)
  seats?: number                 // descritivo apenas (a sala comporta 10 pessoas)
}

Slot {
  id, resourceId, startsAt, endsAt
  unitsPerSlot, reservedUnits  // herdados do recurso na geração
}

Reservation {
  id, resourceId, userId, quantity, status: 'CONFIRMED' | 'CANCELLED', createdAt
}

ReservationSlot {
  reservationId, slotId          // 1..N — uma reserva agrupa vários slots (ADR 0011)
}
```

`seats` é deliberadamente separado: é informação para o usuário escolher a sala,
e **nunca** entra em cálculo de disponibilidade.

### Quantidade por reserva

Num recurso `SHARED`, o usuário informa `quantity` (comprar 4 ingressos de uma
vez). Regras:

- `1 <= quantity <= resource.maxUnitsPerUser`.
- `EXCLUSIVE` força `quantity = 1`, validado no domínio e no banco.
- `quantity` vale uniformemente para **todos** os slots da reserva (ADR 0011).
- **Uma reserva `CONFIRMED` por usuário por slot.** Para mudar a quantidade, o
  usuário cancela e reserva de novo. Isso mantém a constraint `UNIQUE (slot_id,
  user_id)` intacta e evita a complexidade de incremento concorrente sobre uma
  reserva existente — que seria uma segunda race condition, resolvida por um
  caso de uso de conveniência que não cabe no prazo.

### Invariantes

| # | Invariante | Onde é garantida |
|---|---|---|
| 1 | Recurso `EXCLUSIVE` não é agendado duas vezes no mesmo horário | `EXCLUDE USING gist` sobre `ReservationSlot` (ADR 0004) |
| 2 | `reservedUnits` nunca excede `unitsPerSlot` nem fica negativo | `CHECK` + `UPDATE` atômico condicional (ADR 0004) |
| 3 | Um usuário tem no máximo uma reserva `CONFIRMED` por slot | `UNIQUE (slot_id, user_id) WHERE status = 'CONFIRMED'` sobre `ReservationSlot` |
| 4 | `quantity` respeita `maxUnitsPerUser` e vale 1 em `EXCLUSIVE` | regra de domínio + `CHECK` |
| 5 | Não se reserva slot no passado nem recurso inativo | regra de domínio no use-case |
| 6 | Uma reserva não excede `maxSlotsPerReservation` | regra de domínio no use-case (ADR 0011) |
| 7 | Todos os slots de uma reserva pertencem ao mesmo recurso | regra de domínio + FK |

As invariantes 1 a 4 vivem no banco porque a API é stateless e replicável
(ADR 0010): verificação em memória de processo é falsa por construção. A 5 é
regra de negócio pura e fica no use-case, onde é testável sem banco.

### Seed de demonstração

Os dois tipos convivem, para exercitar os dois caminhos de concorrência na mesma
tela: 3 salas de reunião (`EXCLUSIVE`), 1 setor de garagem com 30 vagas e 1 lote
de 100 ingressos VIP (`SHARED`), mais um punhado de usuários fixos que alimentam
o teste de concorrência com identidades distintas.

## Alternativas consideradas

- **Campo único `capacity` sem `kind`.** Foi a versão inicial. Recusada por
  ambiguidade semântica: o mesmo campo era lido de duas formas incompatíveis, e
  a regra de concorrência ficava implícita num `if capacity === 1` escondido no
  código em vez de explícita no domínio.
- **Intervalos arbitrários (`start`/`end` livres).** A constraint de exclusão
  brilharia, mas a UI exigiria date-time pickers, validação de duração mínima e
  alinhamento, e "disponibilidade em tempo real" ficaria difícil de representar.
  Recusado por custo de frontend desproporcional ao prazo.
- **Modelar participantes da reunião.** Recusado: o sistema reserva o recurso,
  não gerencia quem entra na sala. `seats` cobre a necessidade informativa.
- **Permitir múltiplas reservas do mesmo usuário no mesmo slot.** Recusado em
  favor de uma reserva com `quantity`, pelo motivo de concorrência acima.

## Consequências

- **Custo:** é preciso um gerador de slots, e o horizonte de 7 dias é fixo no
  MVP — não há job que estenda a janela conforme os dias passam, então após uma
  semana a grade esvazia. Dívida conhecida e declarada: em produção seria um
  processo administrativo (fator XII, ADR 0010) rodando diariamente. Slots
  antigos também acumulam e pediriam limpeza.
- **Custo:** `kind` cria dois caminhos de código na reserva. Mitigado por ambos
  ficarem atrás da mesma port, com o teste de concorrência cobrindo os dois.
- **Ganho:** cada tipo de recurso do briefing tem representação exata, e a regra
  de concorrência de cada um é um campo legível no domínio, não uma condição
  implícita.
