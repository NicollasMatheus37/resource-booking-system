# ADR 0006 — Gestão de estado no Angular

- **Data:** 2026-09-03
- **Status:** Aceito

## Contexto

O briefing faz duas perguntas diretas ao frontend: como a tela reage quando uma
reserva falha, e como ela se mantém atualizada sem polling abusivo. A segunda
está respondida no ADR 0005. Este ADR trata do estado.

A dificuldade específica é que a tela tem **duas fontes de mudança concorrentes**:
a ação do próprio usuário (`POST` de reserva) e os eventos de outros usuários
(SSE). Elas podem chegar fora de ordem, e o `409` é um resultado **esperado**,
não uma exceção.

## Decisão

### Store por feature, sem biblioteca de estado global

Um `ResourcesStore` (`@Injectable`) em `features/resources/data`, com estado em
**signals** e composição de streams em **RxJS**. Sem NgRx.

A divisão de responsabilidade é explícita:

- **RxJS** para o que é assíncrono e composto no tempo: o stream do SSE, o
  fetch inicial, reconexão, debounce, cancelamento.
- **Signals** para o estado lido pelo template: derivações síncronas, `computed`
  de disponibilidade, e change detection eficiente com `OnPush`.

O ponto de encontro é `toSignal()` na borda: os streams entram, o estado vira
signal, e o template nunca vê um Observable cru nem `async` pipe espalhado.

### Forma do estado

```ts
{
  slots: Record<SlotId, SlotView>,   // normalizado por id
  status: 'idle' | 'loading' | 'ready' | 'error',
  selection: Set<SlotId>,            // carrinho de slots marcados (ADR 0011)
  submitting: boolean,               // reserva em voo
  connection: 'live' | 'reconnecting' | 'polling',
  notice: Notice | null              // feedback de resultado
}
```

Estado **normalizado por id** porque o evento SSE é um delta de um slot: aplicar
`{ ...slots, [id]: patch }` é O(1) e não recria a lista inteira.

`connection` é estado de primeira classe e é exibido na UI. O usuário precisa
saber se está vendo dado ao vivo ou degradado.

### A seleção sob eventos concorrentes

A seleção em carrinho (ADR 0011) cria uma situação que a reserva de slot único
não tinha: **um slot marcado pode ser tomado por outro usuário antes do
"Avançar"**. O reducer trata isso explicitamente.

Quando um delta de SSE torna indisponível um slot que está na `selection`:

- o slot **permanece** na seleção, marcado visualmente como *indisponível*;
- o botão "Avançar" fica desabilitado enquanto houver um slot inválido;
- um aviso nomeia o slot afetado e oferece a ação "remover da seleção".

A alternativa — remover o slot silenciosamente — foi recusada: o usuário
clicaria "Avançar" e reservaria algo diferente do que via na tela. Marcar e
bloquear é mais lento e honesto; remover é rápido e mentiroso.

`selection` é limpa ao trocar de recurso, já que uma reserva só agrupa slots do
mesmo recurso (invariante 7 do ADR 0003).

### Reserva: pessimista, não otimista

O botão de confirmar **desabilita e entra em loading** no clique, e só volta
quando a resposta chega. Não existe segundo clique: a prevenção é da UI, e o
`Idempotency-Key` do ADR 0004 é apenas defesa em profundidade contra retry de
rede. Toda a seleção vira **um único** `POST /reservations` com `slotIds[]`
(ADR 0011) — nunca N requisições, que produziriam sucesso parcial.

A atualização é **pessimista** por decisão explícita: o slot só muda de estado
depois do `201`. Update otimista foi recusado aqui porque, em recurso
altamente disputado, mostrar a vaga como conquistada e retirá-la meio segundo
depois é pior que meio segundo de spinner — a UI estaria mentindo justamente no
momento em que o usuário mais confia nela.

O RxJS garante uma requisição em voo por vez com `exhaustMap` — cliques
repetidos enquanto uma reserva está pendente são descartados, mesmo que a UI
falhe em desabilitar o botão.

### Contrato de erro

Status HTTP não basta: dois cenários distintos de conflito retornam `409` e
exigem reações diferentes na tela. O corpo do erro carrega um **código
legível por máquina**, e é ele que o store consome — nunca a mensagem, nunca só
o status:

```ts
type ApiError = {
  code: 'SLOT_UNAVAILABLE' | 'ALREADY_RESERVED' | 'SLOT_IN_PAST'
      | 'RESOURCE_INACTIVE' | 'VALIDATION_FAILED' | 'INTERNAL';
  message: string;      // texto para humanos, não para lógica
  details?: unknown;
};
```

O tipo vive em `libs/contracts` e é compartilhado com a API, então um código
novo no backend quebra o build do frontend se não for tratado.

### Tratamento de falha

| Resposta | `code` | Reação da tela |
|---|---|---|
| `201` | — | slot vira "reservado por você", toast de sucesso |
| `409` | `SLOT_UNAVAILABLE` | o erro nomeia **qual** slot falhou: essa célula vira "esgotado" e é marcada na seleção, com refetch para reconciliar. O resto da seleção é preservado |
| `409` | `ALREADY_RESERVED` | toast informando a reserva existente do usuário; contagem **não** é alterada |
| `422` | `SLOT_IN_PAST`, `RESOURCE_INACTIVE` | toast de regra de negócio, refetch da grade (o estado local está velho) |
| `401` | — | limpa a identidade e volta ao seletor de usuário, preservando a rota de retorno (ADR 0008) |
| `5xx` / rede | `INTERNAL` ou ausente | mantém estado anterior, toast com ação "tentar de novo"; nada é alterado localmente |

A distinção entre os dois `409` importa: em `SLOT_UNAVAILABLE` a contagem do
slot mudou e precisa reconciliar; em `ALREADY_RESERVED` a contagem está certa e
mexer nela introduziria o erro que se queria evitar.

Em todos os casos de falha o estado local **nunca** fica divergente do servidor:
ou não se mexe, ou se reconcilia por refetch.

### Fluxo de dados

```
GET /resources ──┐
                 ├─► merge ──► scan(reducer) ──► toSignal ──► template (OnPush)
SSE deltas    ───┘
```

O `scan` aplica snapshot e deltas na mesma estrutura, então não existe caminho
de código que atualize a tela por fora do reducer.

## Alternativas consideradas

- **NgRx.** Ferramenta madura e com devtools, mas o boilerplate (actions,
  effects, selectors, reducers) é desproporcional para uma tela e um domínio.
  Recusado por peso; o padrão de store com signals é o caminho idiomático atual
  do Angular.
- **NgRx SignalStore / Elf.** Mais leves e adequados, porém adicionam uma
  dependência para algo que um `@Injectable` com signals resolve. Recusado por
  princípio de menor infraestrutura.
- **Update otimista com rollback.** Mais impressionante de demonstrar e melhor
  em latência percebida, mas errado para o domínio, pelo motivo acima.
- **Distinguir os conflitos pela mensagem de erro.** Recusado: acopla lógica a
  texto, quebra com i18n e com qualquer reescrita de copy.
- **Status HTTP distintos para os dois conflitos** (ex.: `409` e `422`).
  Recusado: ambos *são* conflito de estado; forçar semânticas HTTP diferentes
  para diferenciá-los distorce o significado do status. O campo `code` é o lugar
  correto para granularidade de domínio.

## Consequências

- **Custo:** sem devtools de time-travel. Mitigado por um reducer puro e
  testável isoladamente, e por log de transições em dev.
- **Custo:** latência percebida maior que no update otimista — o usuário espera
  o round-trip. Aceito conscientemente em troca de a tela nunca mentir.
- **Custo:** o catálogo de `code` vira parte do contrato público da API e não
  pode ser alterado sem versionar.
- **Ganho:** o reducer é uma função pura testável sem TestBed; o store é testável
  com `HttpTestingController` e um stream de SSE falso, incluindo o cenário de
  `409` concorrente.
