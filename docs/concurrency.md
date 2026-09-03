# A prova da condição de corrida

Este documento é a evidência executável do [ADR 0004](adr/0004-estrategia-concorrencia.md).
Sem ele, a estratégia de concorrência seria alegação.

```bash
pnpm exec nx test-integration api
```

Requer Docker: a suíte sobe um Postgres 18 real via Testcontainers, aplica as
migrations de verdade — incluindo as constraints que só existem no SQL manual —
e levanta a aplicação NestJS **completa**, com controller, pipes, guard e
exception filter. As requisições são HTTP de verdade, disparadas com
`Promise.all`.

## Por que não dá para mockar

Um repositório falso não tem MVCC, não tem row lock e não tem constraint de
exclusão. Ele passaria com uma implementação incorreta — inclusive com um
`if (disponivel > 0)` ingênuo, que é exatamente o bug que este teste existe
para pegar.

Por isso a suíte é dividida (ADR 0009): as regras de domínio rodam em
milissegundos com fakes (`nx test api`, 22 testes, sem Docker), e as garantias
do banco rodam contra Postgres real.

## Cenários

| # | Cenário | Setup | Asserção |
|---|---|---|---|
| 1 | `EXCLUSIVE` sob disputa | 200 usuários distintos, 1 slot de sala | exatamente **1** `201`, **199** `409 SLOT_UNAVAILABLE`, `reserved_units = 1`, zero `5xx` |
| 2 | `SHARED` com quantidade variada | 200 usuários pedindo 1–4 unidades, slot de 30 | soma das quantidades confirmadas ≤ 30 **e igual** a `reserved_units`, zero overbooking |
| 3 | Multi-slot e deadlock | 60 usuários, janelas de 3 slots deslizantes e sobrepostas, metade enviando em ordem invertida | zero sucesso parcial, zero erro de deadlock, nenhum slot exclusivo com mais de 1 reserva |
| 4 | Idempotência em `SHARED` | mesmo usuário, mesmo slot, duas vezes | `201` e depois `409 ALREADY_RESERVED`, com `reserved_units` **inalterado** |
| 5 | Idempotência em `EXCLUSIVE` | dono repete; depois outro usuário tenta | dono recebe `ALREADY_RESERVED`, o outro recebe `SLOT_UNAVAILABLE` |

Resultado: **5/5 passando**, ~9s de execução.

### O que cada cenário prova

**Cenário 1 — não existe janela de corrida.** Os 200 `POST` chegam
simultaneamente. O `UPDATE ... WHERE reserved_units + 1 <= units_per_slot`
decide e escreve no mesmo statement, sob o row lock que ele próprio adquire.
Não há leitura anterior para ficar obsoleta.

**Cenário 2 — a condição está escrita corretamente.** As quantidades variam de
1 a 4 de propósito: um `< units_per_slot` ingênuo deixaria passar um pedido de
4 unidades quando restam 2. A asserção `reserved_units === somaConfirmada`
pega qualquer divergência entre o que foi cobrado e o que foi contado.

**Cenário 3 — a ordenação anti-deadlock funciona.** As janelas se sobrepõem
entre si e metade dos clientes envia os slots em ordem invertida. Sem o
`sort` por `startsAt` no use-case, transações concorrentes travariam os mesmos
slots em sentidos opostos e o Postgres abortaria uma delas com `40P01`, que
viraria `500`. A asserção `erros5xx === []` falha se aquele `sort` for removido.

**Cenários 4 e 5 — os dois `409` são distinguíveis.** É a diferença que o
frontend precisa (ADR 0006): em `SLOT_UNAVAILABLE` a contagem mudou e a tela
precisa reconciliar; em `ALREADY_RESERVED` a contagem está correta e mexer
nela introduziria o erro que se queria evitar.

O cenário 5 cobre um caso sutil que a implementação errou de primeira. Num
recurso `EXCLUSIVE` o contador atinge o teto com **uma** reserva, então o
`UPDATE` atômico falha antes de a constraint de unicidade ser avaliada — e o
próprio dono da reserva recebia "alguém foi mais rápido". A correção consulta
a titularidade **apenas no caminho de falha**, sem custo no caminho feliz e
sem transferir garantia nenhuma para a aplicação: a constraint única continua
sendo a verdade.

## Verificação direta das constraints

Independente da aplicação, o banco recusa estados inválidos. Verificado via
`psql` durante a implementação:

| Tentativa | Resultado |
|---|---|
| Segunda reserva do mesmo slot exclusivo | `ERROR: conflicting key value violates exclusion constraint "reservation_slots_no_overlap"` |
| Reserva 09:15–09:45 sobre uma existente 09:00–09:30, **em slot diferente** | rejeitada pela mesma constraint |
| `UPDATE slots SET reserved_units = 2` num slot de capacidade 1 | `ERROR: violates check constraint "slots_reserved_units_bounds"` |
| Recurso `EXCLUSIVE` cadastrado com 5 unidades | `ERROR: violates check constraint "resources_exclusive_is_single_unit"` |

O segundo caso merece atenção: a constraint tem chave `resource_id`, não
`slot_id`. Uma constraint por slot deixaria passar sobreposição entre janelas
diferentes do mesmo recurso — o que aconteceria se a agenda fosse regerada com
outra duração de slot.

## O gargalo que permanece

O teste prova **correção**, não vazão ilimitada. O Postgres serializa escritores
na mesma linha por MVCC, o que impõe um teto por recurso disputado. A escada de
escalonamento — sharding de contador, portão de admissão no Redis, fila — está
descrita no ADR 0004 e **não** foi implementada. O use-case fica atrás de uma
port para que o portão entre depois sem tocar na regra de negócio.
