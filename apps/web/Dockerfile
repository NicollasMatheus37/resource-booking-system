# syntax=docker/dockerfile:1

FROM node:26-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@11.13.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec nx build web

FROM nginx:alpine AS runner
# jq serializa JSON de verdade (escapa aspas e </script>), ao contrário de
# envsubst ou sed — ver "Segurança do env.js" no ADR 0010.
RUN apk add --no-cache jq
COPY infra/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY infra/docker/generate-env-js.sh /docker-entrypoint.d/40-generate-env-js.sh
RUN chmod +x /docker-entrypoint.d/40-generate-env-js.sh
COPY --from=builder /app/dist/apps/web/browser /usr/share/nginx/html
EXPOSE 80
