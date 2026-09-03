# syntax=docker/dockerfile:1

# 12-Factor V — build, release, run como estágios separados.
FROM node:26-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@11.13.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec nx build api

FROM node:26-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# `generatePackageJson` do webpack emite um package.json com apenas as
# dependências de runtime, em versões exatas — instalação determinística
# sem arrastar o lockfile do monorepo inteiro.
COPY --from=builder /app/dist/apps/api ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
USER node
EXPOSE 3000
# Sem shell no CMD: o processo recebe SIGTERM diretamente e drena (fator IX).
CMD ["node", "main.js"]
