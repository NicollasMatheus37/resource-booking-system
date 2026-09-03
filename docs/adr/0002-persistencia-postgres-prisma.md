# ADR 0002 — Persistência em PostgreSQL com Prisma

- **Data:** 2026-09-03
- **Status:** Aceito

## Contexto

O core do sistema é uma invariante de recurso finito: nenhuma sobreposição de
reserva no mesmo slot, e nenhuma capacidade negativa. Uma invariante desse tipo
precisa ser garantida na **fonte da verdade**, não na camada de aplicação: a API
é stateless e roda em N réplicas (ADR 0010), portanto qualquer verificação feita
em memória é falsa por construção.

Isso restringe a escolha: precisamos de um armazenamento com transações ACID
reais e constraints declarativas.

## Decisão

**PostgreSQL** como banco, acessado via **Prisma**.

O Postgres foi escolhido especificamente por dois recursos que resolvem o
problema central do projeto:

- `EXCLUDE USING gist` com o tipo `tstzrange` — impede sobreposição temporal no
  nível do índice (ver ADR 0004).
- `CHECK` constraints — impedem capacidade negativa independentemente do código
  que escreve.

Prisma entra pelas migrations versionadas (`prisma migrate`), pelos tipos
gerados a partir do schema e pelo `$transaction` com nível de isolamento
explícito. SQL bruto via `$queryRaw` fica disponível para as partes que o
Prisma não expressa (a constraint de exclusão e o `UPDATE` condicional).

## Alternativas consideradas

- **Drizzle.** SQL-first, tipagem excelente e controle explícito de locks.
  Recusado por ecossistema menor em projetos NestJS; a diferença técnica não
  compensa a perda de convencionalidade num entregável avaliado.
- **TypeORM.** Integração mais canônica com NestJS, mas com histórico de
  comportamento surpreendente em transações e migrations. Recusado por
  concentrar risco exatamente na parte crítica do sistema.
- **MongoDB.** Transações multi-documento existem, mas não há constraint de
  exclusão por intervalo; a invariante voltaria para a aplicação. Recusado por
  contrariar o princípio central desta decisão.
- **Redis como fonte da verdade.** Operações atômicas ótimas, durabilidade
  fraca. Recusado como *verdade*; permanece na escada de escalonamento do
  ADR 0004 como *filtro*.
- **Em memória com abstração.** Viola o fator VI (processos stateless) e
  impossibilita provar concorrência com múltiplas instâncias.

## Consequências

- **Custo:** o compose ganha um serviço com estado, volume e healthcheck; os
  testes de integração precisam de um banco real (resolvido com Testcontainers,
  ADR 0009). O Prisma adiciona um passo de `generate` no build e na imagem.
- **Ganho:** a invariante de negócio passa a ser inviolável mesmo por acesso
  manual ao banco, script de migração ou bug futuro na aplicação.
- O acesso ao Prisma fica confinado em `modules/*/infrastructure`, atrás das
  ports definidas em `application`. Trocar de ORM ou de banco não toca nas
  regras de negócio nem nos testes unitários.
