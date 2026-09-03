# Resource Booking System

Sistema de reservas de recursos limitados — salas de reunião, vagas de garagem,
ingressos VIP. O core do problema não é o CRUD: é que **os recursos são finitos e
disputados**, e a prova de que o sistema funciona é o que acontece quando várias
pessoas tentam a última vaga no mesmo milissegundo.

> **Status:** em construção. Fatia 0 (fundação) concluída.
> Acompanhe o escopo e o cronograma em [`docs/PLAN.md`](docs/PLAN.md).

## Como rodar

Pré-requisitos: Docker e Docker Compose.

```bash
cp .env.example .env
docker compose up --build
```

| Serviço | URL |
|---|---|
| Frontend | http://localhost:4200 |
| API | http://localhost:3000/api |
| Liveness | http://localhost:3000/api/health |
| Readiness | http://localhost:3000/api/ready |

### Desenvolvimento local

Pré-requisitos: Node 26, pnpm 11, e o Postgres do compose no ar.

```bash
pnpm install
docker compose up -d postgres

pnpm exec nx serve api    # http://localhost:3000/api
pnpm exec nx serve web    # http://localhost:4200

pnpm exec nx run-many -t lint test build
```

## Stack

| Camada | Escolha |
|---|---|
| Monorepo | Nx 23 (integrado) + pnpm 11 |
| Backend | NestJS 11, arquitetura hexagonal por módulo |
| Banco | PostgreSQL 18 + Prisma 7 |
| Frontend | Angular 22, signals + RxJS |
| Estilo | Tailwind 4 + DaisyUI 5 |

## Decisões arquiteturais

As decisões estão registradas como ADRs em [`docs/adr/`](docs/adr/), cada uma com
contexto, alternativas recusadas e o preço que se paga pela escolha.

As duas perguntas centrais do projeto:

- **Condição de corrida** — [ADR 0004](docs/adr/0004-estrategia-concorrencia.md)
- **Gestão de estado no Angular** — [ADR 0006](docs/adr/0006-estado-angular.md)

## Limitações declaradas

Decisões conscientes de escopo, não descuidos:

- **NestJS 11 e Prisma 7**, não as majors mais recentes. O `@nx/nest` ainda não
  suporta NestJS 12, e a tag `latest` do Prisma aponta para um release candidate.
  Justificativa completa no [ADR 0001](docs/adr/0001-monorepo-nx-pnpm.md).
- Demais limitações serão listadas aqui conforme as fatias avançam.
