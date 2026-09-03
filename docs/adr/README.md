# Architecture Decision Records

Registro das decisões arquiteturais do **Resource Booking System**.

**Prazo do MVP:** fim do dia 2026-09-04. Várias decisões aqui são explicitamente
moldadas por esse orçamento de tempo, e dizem isso na seção de alternativas.

Cada ADR é imutável: uma vez aceito, não se edita: cria-se um novo ADR que o
supersede. O status indica se a decisão está vigente.

| # | Decisão | Status |
|---|---|---|
| [0001](0001-monorepo-nx-pnpm.md) | Monorepo com Nx + pnpm e layout de pastas | Aceito |
| [0002](0002-persistencia-postgres-prisma.md) | Persistência em PostgreSQL com Prisma | Aceito |
| [0003](0003-modelo-dominio-slots-fixos.md) | Modelo de domínio: slots fixos e tipos de recurso | Aceito |
| [0004](0004-estrategia-concorrencia.md) | Estratégia de concorrência da reserva | Aceito |
| [0005](0005-realtime-sse.md) | Atualização em tempo real via SSE | Aceito |
| [0006](0006-estado-angular.md) | Gestão de estado no Angular | Aceito |
| [0007](0007-tailwind-daisyui.md) | Tailwind CSS + DaisyUI como camada de estilo | Aceito |
| [0008](0008-autenticacao-jwt.md) | Identidade simulada; autenticação diferida | Aceito |
| [0009](0009-estrategia-testes.md) | Estratégia de testes e gates de CI | Aceito |
| [0010](0010-doze-fatores.md) | Aderência ao 12-Factor App | Aceito |
| [0011](0011-reserva-multiplos-slots.md) | Reserva de múltiplos slots e ordenação anti-deadlock | Aceito |

## Formato

Cada arquivo segue a estrutura: **Contexto** (a força que exige a decisão),
**Decisão** (o que foi escolhido), **Alternativas consideradas** (com o motivo
da recusa) e **Consequências** (o preço que se paga, explicitamente).

O objetivo não é justificar escolhas: é deixar rastreável *o que sabíamos* no
momento em que decidimos, para que uma decisão possa ser revista quando o
contexto mudar.
