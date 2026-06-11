#!/bin/sh
set -e

# Dopo restart container: rimuovi lock Chromium lasciati da processi precedenti
SESSION_DIR="${SESSION_DATA_PATH:-/app/data/sessions}"
if [ -d "$SESSION_DIR" ]; then
  find "$SESSION_DIR" \( -name 'SingletonLock' -o -name 'SingletonSocket' -o -name 'SingletonCookie' \) -delete 2>/dev/null || true
fi
# Termina eventuali processi Chromium orfani (solo all'avvio container)
pkill -9 -f '/usr/bin/chromium' 2>/dev/null || true

# Coolify imposta PORT=80 per il proxy esterno (nginx).
# I servizi interni usano porte dedicate — non ereditano PORT.
API_PORT=2785
AI_PORT=3100

echo "[start] Avvio OpenWA API sulla porta ${API_PORT}..."
PORT="${API_PORT}" node /app/dist/main &
API_PID=$!

echo "[start] Attesa health API..."
READY=0
i=0
while [ "$i" -lt 45 ]; do
  if wget -qO- "http://127.0.0.1:${API_PORT}/api/health" > /dev/null 2>&1; then
    READY=1
    echo "[start] API pronta"
    break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "[start] API terminata durante l'avvio"
    exit 1
  fi
  i=$((i + 1))
  sleep 2
done
if [ "$READY" -eq 0 ]; then
  echo "[start] Timeout avvio API"
  exit 1
fi

echo "[start] Avvio AI Service sulla porta ${AI_PORT}..."
cd /app/ai-service && PORT="${AI_PORT}" node src/index.js &
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
