# ADR 0008 — Identidade do usuário: simulada no MVP, autenticação diferida

- **Data:** 2026-09-03
- **Status:** Aceito
- **Prazo do MVP:** fim do dia 2026-09-04

## Contexto

Autenticação **não** está no briefing. Chegou a ser decidida como escopo extra e
foi **revertida** ao se fixar o prazo. Auth completa — hash de senha, guards,
interceptor, telas de login e registro, proteção de rota — consome uma fatia do
orçamento de tempo que precisa ir para a concorrência, os testes e o README, que
é onde o projeto é avaliado.

O domínio ainda precisa de identidade: as invariantes 3 e 4 do ADR 0003 (uma
reserva por usuário por slot, teto de unidades por usuário) e a propriedade da
reserva dependem de um `userId`. O que se decide aqui é **de onde ele vem**.

## Decisão

**Identidade simulada, atrás da mesma interface que a autenticação real usaria.**

### Backend

- Os controllers recebem `@CurrentUser() user: AuthenticatedUser`.
- A resolução acontece num **único ponto**, um `IdentityGuard`, que no MVP lê o
  header `x-user-id`, valida contra a tabela `users` e responde `401` se ausente
  ou inexistente.
- Os use-cases recebem `userId` como argumento e **não sabem** como ele foi
  obtido. Nenhuma regra de negócio muda quando a origem mudar.
- `userId` **nunca** vem do corpo da requisição, mesmo agora. A restrição que a
  auth real imporia já vale: o cliente não escolhe por quem reserva.
- O seed cria usuários fixos, que também alimentam o teste de concorrência com
  identidades distintas e reais.

### Frontend

- `IdentityStore` com signals guarda o usuário ativo, escolhido num seletor no
  topo do dashboard.
- Interceptor HTTP anexa o header — **o mesmo ponto** onde o
  `Authorization: Bearer` entraria depois.
- Rota do dashboard protegida por um `CanActivateFn` que hoje verifica apenas se
  há usuário selecionado.

### Caminho de evolução

Trocar identidade simulada por JWT real toca exatamente três lugares, nenhum
deles regra de negócio:

1. `IdentityGuard` passa a validar JWT em vez de header.
2. O interceptor passa a enviar `Authorization` em vez de `x-user-id`.
3. Somam-se `POST /auth/register` e `/auth/login` com **argon2id**, e o seletor
   de usuário vira tela de login.

Se implementada, seria access token HS256 com TTL curto, segredo obrigatório em
`JWT_SECRET` (falha no boot se ausente, ADR 0010) e guard global fechado por
padrão com decorator `@Public()` — padrão fechado, abertura explícita e visível
em code review. O inverso, proteger endpoint a endpoint, falha por omissão.

## Alternativas consideradas

- **JWT completo agora.** Correto para produção e exercita guards e
  interceptors. Recusado pelo prazo; é a primeira extensão a fazer se sobrar
  tempo, e o desenho acima garante que caiba sem refactor.
- **Access + refresh com cookie `httpOnly` e rotação.** Ainda mais próximo de
  produção e sem exposição a XSS, mas traz CSRF e CORS com credenciais entre
  containers. Fora de questão neste prazo.
- **OAuth com provider externo.** Depende de credenciais externas e quebra a
  promessa de "sobe com um `docker compose up`". Recusado.
- **Sem identidade nenhuma (reserva anônima).** Mais rápido, mas apagaria duas
  invariantes testáveis e enfraqueceria o teste de concorrência. Recusado — o
  custo da identidade simulada é baixo demais para justificar essa perda.

## Consequências

- **Custo:** o sistema **não é seguro** e não pretende ser. Qualquer cliente
  pode se passar por qualquer usuário trocando um header. Isso precisa estar
  escrito no README de forma explícita, como decisão de escopo — um leitor que
  descubra sozinho conclui a coisa errada.
- **Ganho:** o orçamento de tempo vai inteiro para concorrência, testes e
  documentação.
- **Ganho:** o seletor de usuário torna a demonstração da race condition
  *melhor* do que com login — duas abas, dois usuários, um slot, sem cerimônia
  de autenticação no meio.
- A superfície de mudança para auth real está delimitada em três pontos e
  registrada aqui: isso é dívida técnica planejada, não omissão.
