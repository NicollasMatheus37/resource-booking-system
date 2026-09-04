# 12-Factor V — build, release, run como estágios separados.
FROM node:26-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@11.13.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# O client tipado do Prisma é artefato de build, não é versionado.
RUN pnpm exec prisma generate
RUN pnpm exec nx build api

FROM node:26-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# `generatePackageJson` do webpack emite um package.json com apenas as
# dependências de runtime, em versões exatas — instalação determinística
# sem arrastar o lockfile do monorepo inteiro.
COPY --from=builder /app/dist/apps/api ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
# O client gerado do Prisma vive fora do package.json — `@prisma/client`
# apenas re-exporta o que está em `.prisma/client`. Sem esta cópia, a imagem
# instala o pacote mas não o código gerado, e o processo morre no primeiro
# require.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
USER node
EXPOSE 3000
# Sem shell no CMD: o processo recebe SIGTERM diretamente e drena (fator IX).
CMD ["node", "main.js"]

# 12-Factor V — migration é passo de RELEASE, separado do run.
#
# Rodar `migrate deploy` no start da API parece conveniente e quebra com N
# réplicas: N processos aplicariam a mesma migration simultaneamente. Este
# estágio existe para o serviço `migrate` do compose, que roda uma vez e sai.
FROM builder AS migrate
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# 12-Factor XII — processo administrativo one-off, na mesma imagem e ambiente.
FROM builder AS seed
CMD ["pnpm", "exec", "prisma", "db", "seed"]
