# ADR 0010 — Aderência ao 12-Factor App

- **Data:** 2026-09-03
- **Status:** Aceito

## Contexto

O briefing exige aderência estrita ao 12-Factor App, com ênfase em três fatores:
**III — Configuração**, **VI — Processos** e **IV — Backing Services**. Este ADR
registra como cada um é implementado, e é deliberadamente concreto: "seguimos o
12-Factor" sem dizer onde é afirmação vazia.

## Decisão

### III — Configuração no ambiente

- Toda configuração vem de variáveis de ambiente. **Zero** `process.env`
  espalhado pelo código: a leitura acontece num único módulo,
  `apps/api/src/config`.
- O schema é validado no **boot**, com `zod`. Variável ausente ou malformada
  derruba o processo imediatamente, com mensagem apontando o nome da variável.
  Falhar no boot é infinitamente melhor que falhar na primeira requisição de
  produção, três horas depois do deploy.
- **Nenhum default para segredo.** `DATABASE_URL` sem valor derruba a aplicação;
  não existe fallback para `localhost`. Defaults de segredo são a forma mais
  comum de vazar credencial para produção sem ninguém perceber.
- `.env.example` versionado com todas as chaves e valores de exemplo; `.env` no
  `.gitignore`, nunca commitado.
- O frontend recebe sua configuração em **runtime**, não em build time: um
  `env.js` gerado pelo entrypoint do container. Isso mantém a promessa do fator —
  a **mesma imagem** roda em dev, staging e produção. Um build por ambiente
  violaria os fatores III e V simultaneamente.

#### Segurança do `env.js`

Config de frontend é **sempre pública**, em qualquer técnica: um
`environment.prod.ts` compilado no bundle está igualmente visível no DevTools.
`env.js` não é mais nem menos exposto — a regra "nenhum segredo aqui" vale
idêntica nos dois casos. Os riscos específicos são de *geração*, e cada um tem
mitigação obrigatória:

| Risco | Mitigação |
|---|---|
| Vazar variável não-pública (ex.: `DATABASE_URL` chegar ao browser) | **Allowlist explícita e nomeada** das chaves exportadas. Nunca iterar sobre `process.env`, nunca filtrar só por prefixo |
| Injeção de script por valor malicioso (`</script>`, aspas) | Gerar com um script Node usando `JSON.stringify()` do objeto inteiro. **Nunca** `envsubst`, `sed` ou interpolação de shell |
| Config obsoleta em cache apontando para API antiga | `Cache-Control: no-store` neste arquivo especificamente |
| CSP estrita | Arquivo servido pela mesma origem, não `<script>` inline — dispensa `nonce` e não exige afrouxar a política |

A allowlist é o item que realmente importa: é o único desses erros que vaza
credencial em vez de quebrar a aplicação de forma visível.

### VI — Processos stateless

- A API não guarda nada em memória entre requisições: sem cache local de
  disponibilidade, sem sessão, sem lock em processo.
- Essa é a razão pela qual a concorrência é resolvida no banco (ADR 0004): com
  N réplicas, qualquer coordenação em memória é falsa por construção.
- **Exceção declarada:** as conexões SSE são estado em memória do processo. Elas
  são efêmeras e recriáveis — o cliente reconecta e refaz o snapshot (ADR 0005) —
  mas impõem a limitação de fan-out entre réplicas registrada lá.

### IV — Backing services como recursos anexados

- O Postgres é alcançado exclusivamente por `DATABASE_URL`. Trocar o container
  local por um RDS gerenciado é trocar uma string de ambiente; nenhuma linha de
  código muda.
- No código, o banco está atrás das ports de `application` (ADR 0002), então nem
  o use-case sabe que existe Postgres.

### Os demais

| Fator | Implementação |
|---|---|
| I — Base de código | Um repositório, um monorepo, múltiplos deploys (ADR 0001) |
| II — Dependências | `pnpm-lock.yaml` commitado, versões pinadas, build em imagem sem dependência implícita do host |
| V — Build, release, run | Dockerfile multi-stage; migrations rodam como passo de **release**, nunca no start do processo da API |
| VII — Port binding | A API expõe HTTP por conta própria via `PORT`; sem servidor de aplicação injetado |
| VIII — Concorrência | Escala por processo: `docker compose up --scale api=N` funciona sem alteração |
| IX — Descartabilidade | Boot rápido; `SIGTERM` fecha conexões SSE, drena o pool e encerra. `/health` e `/ready` distintos: liveness vs. dependências prontas |
| X — Paridade dev/prod | O mesmo `compose` sobe a stack inteira em ambos; mesma versão de Postgres |
| XI — Logs | Log estruturado em JSON para **stdout**. A aplicação não escreve arquivo nem rotaciona nada |
| XII — Admin | Seed e geração de slots como comandos one-off, rodados no mesmo ambiente e imagem da aplicação |

O fator V merece destaque: rodar `prisma migrate deploy` no start da API parece
conveniente e quebra com N réplicas — N processos aplicando a mesma migration
simultaneamente. Migration é passo de release, separado do run.

## Alternativas consideradas

- **Config em arquivo por ambiente (`config.dev.json`).** Simples, mas exige um
  build por ambiente e coloca segredos no repositório. Recusado — viola III e V.
- **Build do Angular por ambiente.** Padrão comum no ecossistema
  (`environment.prod.ts`), e é exatamente o que o fator III proíbe. Recusado em
  favor de `env.js` em runtime.
- **Migrations no start da aplicação.** Conveniente em MVP e perigoso com
  réplicas, pelo motivo acima. Recusado mesmo sendo o MVP de uma réplica: o
  hábito errado é o que sobrevive ao MVP.
- **Validação de env preguiçosa (no primeiro uso).** Recusada: transforma erro de
  configuração em incidente de produção.

## Consequências

- **Custo:** o `env.js` em runtime adiciona um entrypoint no container do
  frontend, mais um passo de explicação no README, e a allowlist precisa ser
  mantida quando uma variável pública nova aparecer.
- **Custo:** migrations como passo separado exigem um comando explícito — não
  basta `docker compose up`. Resolvido com um serviço `migrate` no compose que
  roda antes da API e sai.
- **Ganho:** `docker compose up --scale api=3` funciona sem tocar em código, o
  que é a demonstração prática de que os fatores III, VI e IV foram respeitados —
  e é também o cenário em que o teste de concorrência do ADR 0009 tem mais valor.
