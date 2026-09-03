#!/bin/sh
# 12-Factor III — a MESMA imagem roda em qualquer ambiente; a configuração
# do frontend é injetada em runtime, não no build.
#
# ALLOWLIST EXPLÍCITA: apenas as chaves listadas abaixo chegam ao browser.
# Nunca itere sobre o ambiente nem filtre por prefixo — é assim que uma
# DATABASE_URL vaza para o cliente (ADR 0010).
#
# `jq --arg` serializa JSON de verdade: escapa aspas, quebras de linha e
# `</script>`. Interpolação de shell (envsubst, sed) permitiria injeção.
set -eu

API_URL="${PUBLIC_API_URL:-http://localhost:3000/api}"

CONFIG=$(jq -nc --arg apiUrl "$API_URL" '{apiUrl: $apiUrl}')
printf 'window.__ENV__ = %s;\n' "$CONFIG" > /usr/share/nginx/html/env.js

echo "[entrypoint] env.js gerado: $CONFIG"
