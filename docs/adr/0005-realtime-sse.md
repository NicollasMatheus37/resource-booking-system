# ADR 0005 — Atualização em tempo real via SSE

- **Data:** 2026-09-03
- **Status:** Aceito

## Contexto

O briefing pede disponibilidade "em tempo real (ou próximo disso)" e questiona
explicitamente o polling que derruba a API. Num sistema de recurso disputado, a
tela desatualizada não é só desconforto: é o usuário clicando num slot que já
foi tomado e recebendo `409` — a UI produz a frustração que deveria evitar.

O fluxo de dados é **unidirecional**: o servidor sabe quando a disponibilidade
muda, o cliente só precisa ser informado. O cliente já tem uma via para escrever:
o `POST` da reserva.

## Decisão

**Server-Sent Events** num endpoint `GET /events/availability`, exposto pelo
NestJS via `@Sse()`.

- O caso de uso de reserva, **após o commit** da transação (ADR 0004), publica
  um evento `SlotAvailabilityChanged { slotId, resourceId, reservedCount,
  capacity }`.
- O gateway em `shared/realtime` transforma esse evento num stream RxJS e o
  entrega a todos os clientes conectados.
- O cliente recebe um delta, não a lista inteira: o store do Angular aplica a
  mudança no slot correspondente (ADR 0006).

### Reconexão e consistência

- `EventSource` reconecta sozinho no browser. Cada evento carrega um `id`, e a
  reconexão envia `Last-Event-ID`.
- Não tentamos garantir entrega perfeita. Na reconexão, o cliente **refaz um
  fetch do estado atual** e substitui o snapshot. Eventos são otimização de
  latência; o `GET` é a fonte da verdade. Isso mantém o sistema correto mesmo
  perdendo eventos, sem exigir persistência de log de eventos.
- Heartbeat periódico (comentário SSE) para não morrer em proxy com idle
  timeout.

### Fallback

Se o SSE não conectar (proxy hostil, rede corporativa), o store cai para polling
com `timer + switchMap`, backoff e pausa quando a aba perde foco
(`visibilitychange`). É fallback declarado, não a estratégia principal.

## Alternativas consideradas

- **WebSocket (socket.io).** Bidirecional e familiar, útil se um dia quisermos
  presença ou *hold* temporário de vaga. Recusado no MVP por custo de infra
  desproporcional: exige sticky sessions ou adapter Redis ao escalar
  horizontalmente, para um caso que só precisa de push do servidor.
- **Polling inteligente como estratégia principal.** Zero infra nova e imune a
  proxy, mas é justamente o padrão que o briefing questiona. Mantido apenas como
  fallback.
- **Long polling.** Complexidade de WebSocket sem os benefícios; SSE já é a
  versão padronizada dessa ideia.

## Consequências

- **Custo — múltiplas réplicas.** SSE mantém uma conexão HTTP aberta por
  cliente. Com N réplicas da API, um evento gerado na réplica A não chega aos
  clientes conectados na réplica B. **Limitação conhecida e aceita no MVP** (o
  compose sobe uma réplica); a solução é `LISTEN/NOTIFY` do Postgres ou Redis
  pub/sub como barramento entre réplicas, e o gateway já está isolado atrás de
  uma interface para receber isso sem mudar o resto.
- **Custo — limite de conexões do browser.** Em **HTTP/1.1** o browser abre no
  máximo ~6 conexões simultâneas por origem; a partir daí novas requisições
  ficam na fila. Como a aplicação usa **uma** conexão SSE por aba, isso só se
  manifesta se o mesmo usuário abrir 7+ abas do dashboard — a sétima ficaria
  pendurada. Sobre **HTTP/2** (o caso normal com TLS) o limite desaparece:
  requisições são multiplexadas numa única conexão, com centenas de streams.
  Não é um limite do servidor: o Node sustenta milhares de conexões SSE
  abertas, com teto real em file descriptors e memória por conexão.
- **Ganho:** latência de atualização na casa de milissegundos, sem carga de
  polling, com uma tecnologia que é HTTP puro e atravessa Docker e proxies
  reversos comuns sem configuração especial.
