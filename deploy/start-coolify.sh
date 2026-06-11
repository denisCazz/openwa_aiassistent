#!/bin/sh
set -e

echo "[start] Avvio OpenWA API sulla porta 2785..."
node /app/dist/main &
API_PID=$!

echo "[start] Avvio AI Service sulla porta 3100..."
cd /app/ai-service && node src/index.js &
AI_PID=$!

echo "[start] Avvio Nginx sulla porta 80..."
nginx -g 'daemon off;' &
NGINX_PID=$!

shutdown() {
  echo "[start] Arresto servizi..."
  kill "$API_PID" "$AI_PID" "$NGINX_PID" 2>/dev/null || true
  wait "$API_PID" "$AI_PID" "$NGINX_PID" 2>/dev/null || true
  exit 0
}

trap shutdown TERM INT

# Se un processo termina, ferma tutto il container
while kill -0 "$API_PID" 2>/dev/null && kill -0 "$AI_PID" 2>/dev/null && kill -0 "$NGINX_PID" 2>/dev/null; do
  sleep 2
done

echo "[start] Un processo è terminato inaspettatamente"
shutdown
exit 1
