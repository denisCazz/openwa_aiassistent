# OpenWA AI Service

Microservizio che riceve i messaggi WhatsApp in arrivo da OpenWA via webhook, recupera lo storico della conversazione e usa GPT-4o per suggerire le risposte migliori.

## Avvio rapido

```bash
cd ai-service
npm install
cp .env.example .env
# Edita .env con la tua OPENAI_API_KEY
npm run dev
```

## Configurazione webhook su OpenWA

Una volta avviato il servizio, registra il webhook tramite la dashboard OpenWA o API:

```http
POST http://localhost:2785/api/sessions/{SESSION_ID}/webhooks
X-API-Key: dev-admin-key
Content-Type: application/json

{
  "url": "http://localhost:3100/webhook",
  "events": ["message.received"]
}
```

## Endpoints

| Metodo | Path | Descrizione |
|--------|------|-------------|
| `POST` | `/webhook` | Riceve eventi da OpenWA |
| `GET` | `/suggestions` | Ultimi N suggerimenti |
| `POST` | `/suggest` | Suggerimento on-demand per una chat |
| `GET` | `/health` | Stato del servizio |
| `WS` | `ws://localhost:3100` | Stream real-time dei suggerimenti |

## WebSocket

Connettiti a `ws://localhost:3100` per ricevere in real-time:

```json
{ "type": "processing", "data": { "chatId": "...", "from": "...", "body": "..." } }
{ "type": "suggestion", "data": { "chatId": "...", "suggestion": "...", "historyCount": 12 } }
{ "type": "error",      "data": { "chatId": "...", "error": "..." } }
{ "type": "history",    "data": [ ...ultimi suggerimenti... ] }
```

## Variabili .env

| Variabile | Default | Descrizione |
|-----------|---------|-------------|
| `OPENAI_API_KEY` | — | Obbligatoria |
| `OPENAI_MODEL` | `gpt-4o` | Modello OpenAI |
| `OPENWA_BASE_URL` | `http://localhost:2785` | URL backend OpenWA |
| `OPENWA_API_KEY` | `dev-admin-key` | API key OpenWA |
| `PORT` | `3100` | Porta del servizio |
| `HISTORY_LIMIT` | `30` | Messaggi di storia da caricare per conversazione |
| `REPLY_LANGUAGE` | `italiano` | Lingua dei suggerimenti |
| `SYSTEM_PROMPT_EXTRA` | — | Istruzioni extra per il prompt (es: "Siamo un'azienda di..." ) |
