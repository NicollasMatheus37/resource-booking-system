# ADR 0001 — Monorepo com Nx + pnpm e layout de pastas

- **Data:** 2026-09-03
- **Status:** Aceito

## Contexto

O projeto exige monorepo com dois aplicativos de frameworks distintos (NestJS e
Angular) que compartilham contratos de dados. Sem um mecanismo de
compartilhamento tipado, os DTOs seriam duplicados entre backend e frontend, e
uma mudança de contrato só apareceria em runtime.

## Decisão

Monorepo **integrado do Nx**, com `pnpm` como package manager.

- `pnpm` como package manager: instalação por content-addressable store, o que
  reduz duplicação de `node_modules` e mantém a imagem Docker menor.
- `Nx` como orquestrador: generators oficiais para Angular e NestJS, task graph
  com cache local, `nx affected` para rodar apenas o que a mudança tocou, e path
  mapping de libs internas sem passo de build intermediário.

### Sem workspaces do package manager — restrição descoberta na implementação

A intenção original era **Nx sobre pnpm workspaces**. Isso não é viável com
Angular no Nx 23: o modo de workspaces do package manager configura o TypeScript
com **project references** (`composite: true`), e o gerador do Angular recusa
esse setup explicitamente, com a mensagem *"The Angular framework doesn't support
a TypeScript setup with project references"* (angular/angular#37276).

O Nx oferece um bypass por variável de ambiente, marcado *"at your own risk"*.
Foi recusado: forçar uma combinação que o framework declara não suportar, num
projeto com prazo curto, troca um problema conhecido agora por um problema
obscuro depois.

A decisão é o **monorepo integrado**, que é o modo clássico do Nx:

- as libs internas são resolvidas por `paths` no `tsconfig.base.json`, não por
  links de workspace;
- as dependências ficam num `package.json` único na raiz;
- cada projeto tem `project.json`, e o `pnpm-workspace.yaml` permanece apenas
  para a allowlist de scripts de build que o pnpm 11 bloqueia por padrão.

O ganho de compartilhamento tipado entre `apps/api` e `apps/web` via
`libs/contracts` é idêntico nos dois modos — que era o objetivo real da decisão.

### Layout

```
resource-booking/
├─ apps/
│  ├─ api/                        # NestJS
│  │  ├─ src/
│  │  │  ├─ main.ts
│  │  │  ├─ app.module.ts
│  │  │  ├─ config/               # env schema + validação no boot (ADR 0010)
│  │  │  ├─ modules/
│  │  │  │  ├─ identity/         # IdentityGuard, @CurrentUser (ADR 0008)
│  │  │  │  ├─ resources/
│  │  │  │  │  ├─ domain/         # entidades, invariantes, erros de domínio
│  │  │  │  │  ├─ application/    # use-cases + ports (interfaces)
│  │  │  │  │  ├─ infrastructure/ # adapters Prisma — implementam as ports
│  │  │  │  │  └─ http/           # controllers e DTOs
│  │  │  │  └─ reservations/      # regra crítica da reserva (ADR 0004)
│  │  │  ├─ shared/
│  │  │  │  ├─ health/            # /health e /ready
│  │  │  │  ├─ filters/           # erro de domínio → status HTTP
│  │  │  │  ├─ logging/           # log estruturado em stdout
│  │  │  │  └─ realtime/          # publisher de eventos SSE (ADR 0005)
│  │  │  └─ database/             # PrismaService, runner de migrations
│  │  ├─ prisma/                  # schema.prisma + migrations
│  │  ├─ test/                    # integração e concorrência (ADR 0009)
│  │  └─ Dockerfile
│  └─ web/                        # Angular
│     ├─ src/app/
│     │  ├─ core/                 # http, interceptors, realtime, identity store
│     │  ├─ features/
│     │  │  └─ resources/
│     │  │     ├─ data/           # api client + store (ADR 0006)
│     │  │     ├─ pages/          # dashboard (container)
│     │  │     └─ ui/             # grade de slots, cards (presentational)
│     │  └─ shared/ui/            # componentes DaisyUI reutilizáveis
│     └─ Dockerfile
├─ libs/
│  ├─ contracts/                  # tipos e schemas compartilhados api↔web
│  └─ testing/                    # fixtures e builders de teste
├─ docs/
│  ├─ adr/
│  └─ concurrency.md              # prova experimental do ADR 0004
├─ infra/docker/
├─ compose.yaml
├─ .env.example
└─ README.md
```

O layout de `apps/api` é deliberadamente hexagonal por módulo: `application`
depende de `domain` e de *ports*; `infrastructure` e `http` dependem de
`application`. Nunca o inverso. Isso é o que torna o use-case da reserva
testável sem banco e sem HTTP (ADR 0009).

## Alternativas consideradas

- **pnpm workspaces puro.** Simples e sem abstração, mas exige escrever a
  orquestração de build/test/lint na mão e perde cache incremental. Recusado
  pelo custo de manutenção sem ganho de clareza.
- **Turborepo.** Cache e pipelines excelentes, porém sem generators
  Angular/NestJS — o scaffolding voltaria para os CLIs de cada framework e a
  ligação de libs internas ficaria manual.

## Consequências

- **Custo:** Nx é uma abstração adicional; `nx.json` e os executors precisam ser
  entendidos por quem entra no projeto. Há acoplamento ao ecossistema Nx.
- **Ganho:** um único comando roda a suíte inteira; `libs/contracts` faz um
  contrato quebrado falhar em tempo de build, não em produção.
- Todas as versões de dependência são **pinadas** em `package.json` no momento
  do scaffolding, resolvidas contra o registry — não assumidas de memória.

### Versões resolvidas em 2026-09-03, com dois desvios justificados

| Pacote | Versão | Observação |
|---|---|---|
| Nx | 23.2.0 | última |
| Angular | 22.1.x | última |
| Tailwind / DaisyUI | 4.3.3 / 5.7.28 | últimas |
| zod | 4.5.4 | última |
| **NestJS** | **11.2.3** | **desvio** — ver abaixo |
| **Prisma** | **7.10.0** | **desvio** — ver abaixo |

**NestJS 11 em vez de 12.** O `@nx/nest@23.2.0`, o mais recente publicado,
declara `@nestjs/core >=10.0.0 <12.0.0`. O NestJS 12 existe, mas o plugin do Nx
ainda não o suporta. As alternativas eram abandonar o plugin (montando a
configuração do Nest à mão, com custo imprevisível na fatia mais crítica do
cronograma) ou forçar a instalação com override de peer dependency, arriscando
uma quebra obscura no build. Optou-se por acompanhar o ecossistema.

**Prisma 7.10.0 em vez de 8.** A tag `latest` do pacote `prisma` aponta para
`8.0.0-rc.12`, um **release candidate**, enquanto o `@prisma/client` estável está
em `7.10.0`. Colocar um RC na camada que sustenta toda a garantia de concorrência
(ADR 0004) é risco desproporcional. O par estável 7.10.0 foi fixado.

Ambos os desvios são de uma major, ambos têm causa verificável, e ambos estão
declarados no README.
