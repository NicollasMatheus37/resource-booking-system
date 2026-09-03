# ADR 0004 — Estratégia de concorrência da reserva

- **Data:** 2026-09-03
- **Status:** Aceito

## Contexto

Este é o ADR central do projeto. A pergunta a responder é literal: se 5 usuários
clicam no mesmo milissegundo para pegar a última vaga, apenas 1 pode levar, o
banco não pode ficar inconsistente, e os outros 4 precisam de uma resposta
correta e imediata.

Duas condições agravam o problema:

1. A API é stateless e roda em N réplicas (ADR 0010). Qualquer lock em memória
   de processo — mutex, semáforo, cache local — é inútil: as 5 requisições podem
   cair em 5 processos diferentes.
2. A janela entre "ler disponibilidade" e "gravar reserva" é onde a corrida
   acontece. Toda solução correta precisa eliminar essa janela ou torná-la
   atômica.

## Decisão

A invariante é garantida **pelo PostgreSQL**, em duas técnicas complementares
escolhidas pelo `kind` do recurso (ADR 0003).

### 1. Recurso `EXCLUSIVE` — constraint de exclusão

```sql
ALTER TABLE reservations
  ADD CONSTRAINT reservations_no_overlap
  EXCLUDE USING gist (
    slot_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status = 'CONFIRMED');
```

Os 5 cliques viram 5 `INSERT`. O índice GiST faz o segundo `INSERT` bloquear até
o primeiro commitar, e então falhar com violação de constraint. Um vence, quatro
recebem erro. Não há leitura prévia a invalidar, portanto **não existe janela de
corrida**.

### 2. Recurso `SHARED` — UPDATE atômico condicional

```sql
UPDATE slots
   SET reserved_units = reserved_units + $qty
 WHERE id = $1
   AND reserved_units + $qty <= units_per_slot;
```

O ganho está em checar `rowsAffected`: se for `0`, não há unidades suficientes e
a transação aborta. A condição e a escrita acontecem **no mesmo statement**, sob
o row lock que o próprio `UPDATE` adquire — não há leitura anterior para ficar
obsoleta.

Note que a condição é `+ $qty <=`, não `< units_per_slot`: com `quantity > 1`
(ADR 0003), checar apenas se "sobra alguma unidade" deixaria passar um pedido de
4 unidades quando restam 2. O `CHECK (reserved_units <= units_per_slot)` no
schema é a rede de segurança caso essa expressão seja escrita errado algum dia.

### 3. A transação

Ambos os caminhos rodam dentro de uma transação curta contendo apenas o
`UPDATE` do contador e o `INSERT` da reserva. Nada mais: nenhum e-mail, nenhuma
chamada HTTP, nenhum log externo. O evento de SSE (ADR 0005) é publicado
**após** o commit.

Uma reserva cobre N slots (ADR 0011), e os N entram na **mesma** transação —
tudo ou nada, sem sucesso parcial. Isso introduz risco de **deadlock** entre
transações que travam os mesmos slots em ordens diferentes, eliminado por uma
regra sem exceção: os slots são sempre gravados **ordenados por `startsAt`
ascendente**. Ordem global consistente torna o ciclo impossível por construção.
Detalhamento e teste no ADR 0011.

Isolamento: `READ COMMITTED` (default). Não precisamos de `SERIALIZABLE` — a
atomicidade vem da constraint e do `UPDATE` condicional, não do nível de
isolamento. Usar `SERIALIZABLE` aqui adicionaria erros de serialização e
retentativas sem ganho de correção.

### 4. Admission control

- `lock_timeout` curto (~50ms) e `statement_timeout` (~2s) por conexão: o
  perdedor falha rápido em vez de empilhar conexões.
- Pool de conexões com teto explícito. Sob contenção, requisições esperando
  ocupam conexão; sem teto, o Postgres cai por exaustão de conexões antes de
  cair por lock.

### 5. Tradução de erros

Violação de exclusão/unique e `rowsAffected = 0` viram erros de domínio e são
mapeados por um exception filter. O cliente recebe uma resposta semântica, nunca
um 500.

Como os dois conflitos exigem reações diferentes na tela e o status HTTP sozinho
não os distingue, o corpo carrega um **código legível por máquina** (contrato em
`libs/contracts`, ADR 0006):

| Erro de domínio | Origem no banco | HTTP | `code` |
|---|---|---|---|
| `SlotUnavailableError` | violação de `EXCLUDE` ou `rowsAffected = 0` | `409` | `SLOT_UNAVAILABLE` |
| `AlreadyReservedError` | violação do `UNIQUE (slot_id, user_id)` | `409` | `ALREADY_RESERVED` |
| `SlotInPastError` | regra de domínio | `422` | `SLOT_IN_PAST` |
| `ResourceInactiveError` | regra de domínio | `422` | `RESOURCE_INACTIVE` |

A distinção é funcional, não cosmética: em `SLOT_UNAVAILABLE` a contagem do slot
mudou e o cliente precisa reconciliar; em `ALREADY_RESERVED` a contagem está
correta e alterá-la introduziria inconsistência na tela.

### 6. Idempotência

Clique duplicado **não é um problema de backend**: a UI impede o segundo clique
desabilitando o botão e exibindo estado de carregamento até a resposta chegar
(ADR 0006). Essa é a primeira e principal linha de defesa.

O header `Idempotency-Key` existe como defesa em profundidade para o que a UI
não controla: retry automático de rede, reenvio do proxy, ou o usuário
recarregando a página no meio da requisição. Nesses casos a chave faz a segunda
tentativa retornar a reserva já criada em vez de criar outra. Combinado com a
constraint `UNIQUE (slot_id, user_id) WHERE status = 'CONFIRMED'` do ADR 0003, a
duplicação é impossível mesmo que a chave falte.

## Sobre alta contenção

Esta escolha **não** depende de baixo volume — ela melhora conforme a contenção
sobe. O fator determinante é o tempo de posse do lock de linha:

| Técnica | Janela em que a linha fica travada |
|---|---|
| `UPDATE ... WHERE` condicional | duração de um statement (µs) |
| `SELECT ... FOR UPDATE` | do SELECT até o COMMIT — inclui round-trip de rede e lógica da aplicação (ms) |

Com milhares de clientes na mesma linha, a diferença entre µs e ms de posse é a
diferença entre vazão alta e um comboio de conexões em espera.

O que muda em escala alta não é a *correção*, e sim o *enfileiramento*: o
Postgres serializa escritores na mesma linha por MVCC, o que impõe um teto de
vazão por recurso disputado. A escada de escalonamento, se e quando esse teto
for atingido:

1. **Sharding do contador** — quebrar `reserved_units` em N linhas-bucket por
   slot; cada request sorteia um bucket, com varredura como fallback. Elimina a
   serialização em linha única (técnica clássica de contador quente).
2. **Portão de admissão no Redis** — `DECR` atômico como token barato antes de
   tocar o Postgres. Em 100 vagas para 50 mil pessoas, rejeita a esmagadora
   maioria na borda e o banco só vê tráfego com chance real de vencer. O Redis é
   **filtro**; o Postgres continua sendo a verdade.
3. **Fila (BullMQ) serializando por slot** — API responde `202` e o front
   acompanha o resultado. Não melhora correção; melhora absorção de picos, ao
   custo de UX assíncrono.

**Nenhuma das três entra no MVP.** O use-case fica atrás de uma port
`ReservationGate`, de modo que o portão Redis possa ser introduzido sem tocar na
regra de negócio nem nos seus testes.

## Alternativas consideradas

- **`SELECT ... FOR UPDATE` (lock pessimista).** Correto e didático, mas
  serializa por recurso durante toda a transação, com posse de lock ordens de
  magnitude maior. Recusado por ser estritamente pior sob contenção.
- **Lock otimista com coluna `version`.** Funciona, porém troca conflito de lock
  por retentativa em loop na aplicação — mais código, mais latência de cauda, e
  ainda depende de um `UPDATE ... WHERE version = ?`, que é a técnica já
  escolhida sem a coluna extra.
- **Lock distribuído no Redis (Redlock) no MVP.** Adiciona backing service e um
  ponto de falha para uma invariante que o banco já garante melhor. Além disso,
  um lock distribuído sem fencing token não é seguro sob pausa de GC ou partição
  de rede — precisaríamos do banco como verdade de qualquer forma.
- **Fila desde o início.** Over-engineering visível para um MVP e muda o
  contrato da API para assíncrono sem necessidade.

## Consequências

- **Custo:** parte da lógica crítica vive em SQL (a constraint de exclusão não é
  expressável no schema do Prisma e vai numa migration manual). Isso precisa
  estar documentado, senão fica invisível para quem lê só o TypeScript.
- **Custo:** o cliente precisa lidar com `409` como resultado *normal*, não como
  erro excepcional. O front trata isso explicitamente (ADR 0006).
- **Ganho:** a invariante é inviolável independentemente do número de réplicas
  da API, e não há estado de coordenação em processo algum.
- **Prova obrigatória:** `docs/concurrency.md` documenta dois testes de
  integração, um por caminho:

  | Cenário | Setup | Asserção |
  |---|---|---|
  | `EXCLUSIVE` | N usuários, 1 slot de sala | exatamente 1 sucesso, N-1 `SLOT_UNAVAILABLE`, `reserved_units = 1` |
  | `SHARED` | N usuários com `quantity` variado, slot de 30 unidades | soma das quantidades confirmadas ≤ 30, `reserved_units` igual a essa soma, nenhum overbooking |
  | Multi-slot | N usuários pedindo intervalos parcialmente sobrepostos | nenhum sucesso parcial, nenhum deadlock, `reserved_units` coerente em todos os slots |

  Ambos são gate de CI (ADR 0009) — a decisão deste ADR só é válida enquanto
  eles passam.
