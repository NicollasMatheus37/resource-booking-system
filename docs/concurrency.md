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

| 6 | Blocos contíguos (`blocks.int-spec.ts`) | seleção com lacunas, bloco parcialmente tomado, resultado parcial | reservas independentes por bloco, `207` no parcial, `409` quando nada passa, atomicidade dentro do bloco |
| 7 | Cancelamento (`cancellation.int-spec.ts`) | 20 cancelamentos simultâneos da mesma reserva | exatamente 1 com efeito, contador em zero |

Resultado: **31/31 passando** nas seis suítes de integração.

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

**Cenário 6 — atomicidade no nível certo.** Uma reserva cobre um bloco
contíguo (ADR 0011, revisão). Se o terceiro slot de um bloco de quatro já
estiver tomado, o bloco **inteiro** falha — uma reunião de 2h com um buraco no
meio não serve para nada. Já dois blocos separados são independentes: um pode
passar e o outro não, e o teste verifica que o que passou está de fato gravado,
sem rollback global.

**Cenário 7 — o caminho inverso.** Cancelar sem cuidado fura a invariante em
sentido contrário: contador negativo, ou unidade devolvida duas vezes. Vinte
cancelamentos simultâneos da mesma reserva resultam em exatamente um com
efeito, graças ao portão atômico (`WHERE status = 'CONFIRMED'`).

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

## Prova ao vivo, contra a stack em pé

Os testes acima rodam em CI e sobem o próprio banco. Para **demonstrar** —
numa apresentação, ou depois de um deploy — há um script que roda contra a
stack já no ar e mostra a evidência temporal que um teste automatizado esconde:

```bash
docker compose up -d
docker compose run --rm --build seed
pnpm run proof:concurrency            # ou --requests=500
```

### Por que "no mesmo segundo" é uma barra fraca

Mil requisições espalhadas ao longo de um segundo podem nunca se cruzar. O que
cria contenção é **sobreposição**, e é isso que o script mede: a janela em que
as requisições foram disparadas e o pico de quantas estavam em voo ao mesmo
tempo.

### Saída típica

```
  1. EXCLUSIVE — 200 pedidos para o MESMO horário
     recurso: Sala Azul · garantia: EXCLUDE USING gist
    200 requisições disparadas em 28.2ms · pico de 200 em voo · tudo resolvido em 588ms
    ✓ exatamente 1 reserva confirmada  (1)
    ✓ nenhum erro técnico  (0 × 5xx)
    ✓ todos os perdedores receberam 409  (199)
    ✓ contador do horário ficou em 1  (1/1)
    códigos devolvidos: SLOT_UNAVAILABLE=150 · ALREADY_RESERVED=49

  2. SHARED — 200 pedidos de 2 unidades num horário de 6
     4 usuários distintos pedindo 8 unidades no total — não cabe
    200 requisições disparadas em 13.0ms · pico de 200 em voo · tudo resolvido em 430ms
    ✓ contador nunca passou da capacidade  (6/6)
    ✓ contador bate exatamente com o que foi cobrado  (contador=6 soma=6)
    ✓ pedidos que não cabiam foram recusados  (50 × SLOT_UNAVAILABLE)

  3. CANCELAMENTO concorrente — o caminho inverso
    50 requisições disparadas em 1.7ms · pico de 50 em voo · tudo resolvido em 66ms
    ✓ exatamente 1 cancelamento teve efeito  (1 de 50)
    ✓ unidades devolvidas uma única vez  (contador=0)
```

**Pico de 200 em voo** é o número que importa: as 200 requisições estavam
simultaneamente abertas quando a primeira ainda não havia respondido. Elas se
empilham no Postgres ao mesmo tempo — que é exatamente a condição que o
ADR 0004 precisa enfrentar.

### O que cada cenário revela além do óbvio

**Cenário 1 — os dois `409` aparecem juntos.** Dos 199 perdedores, ~150 recebem
`SLOT_UNAVAILABLE` e ~49 recebem `ALREADY_RESERVED`: estas últimas são as
repetições do próprio vencedor, já que o seed tem 4 usuários e as requisições
circulam entre eles. É a distinção que o frontend precisa fazer (ADR 0006),
visível sem preparar nada.

**Cenário 2 — a condição está escrita corretamente.** Quatro usuários pedindo 2
unidades cada somam 8 num horário de 6. Três passam, o quarto é recusado **por
lotação**. Um `reserved_units < units_per_slot` ingênuo deixaria o quarto passar
quando restasse 1 unidade — a condição real é `+ qty <=`.

**Cenário 3 — o contador não vai a negativo.** Cinquenta cancelamentos
simultâneos da mesma reserva de 2 unidades: sem o portão atômico devolveriam
100 unidades e o contador iria a −98.

## Prova com múltiplas réplicas

Os testes acima rodam contra um único processo. A afirmação central do
ADR 0004 — *a garantia está no banco, não na aplicação* — só é verificável com
processos separados, então isso foi testado à parte:

```bash
docker compose -f compose.yaml -f infra/docker/compose.scale.yaml \
  up -d --scale api=3
```

Com três réplicas em portas distintas do host:

| Cenário | Resultado |
|---|---|
| 4 usuários disputando 1 slot exclusivo, cada um numa réplica diferente | 1× `201`, 3× `409 SLOT_UNAVAILABLE` |
| 40 pedidos de 2 unidades num slot de capacidade 30, distribuídos nas 3 réplicas | zero `5xx`, zero overbooking, contador coerente |

O vencedor e os perdedores estavam em **processos diferentes**. Nenhum mutex,
semáforo ou cache local teria funcionado aqui — e é exatamente por isso que a
invariante vive no Postgres.

> No segundo cenário, apenas 4 pedidos são confirmados porque o seed tem 4
> usuários e a invariante 3 do ADR 0003 permite uma reserva por usuário por
> slot. O teto de 30 unidades não chega a ser tocado; o que se verifica ali é
> a ausência de overbooking e de erro técnico sob concorrência distribuída.

## O gargalo que permanece

O teste prova **correção**, não vazão ilimitada. O Postgres serializa escritores
na mesma linha por MVCC, o que impõe um teto por recurso disputado. A escada de
escalonamento — sharding de contador, portão de admissão no Redis, fila — está
descrita no ADR 0004 e **não** foi implementada. O use-case fica atrás de uma
port para que o portão entre depois sem tocar na regra de negócio.
