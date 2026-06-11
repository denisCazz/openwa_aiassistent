import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config({ path: resolve(__dirname, '../.env') });

import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { generateSuggestion, analyzeConversation } from './ai.js';

const PORT = parseInt(process.env.PORT || '3100', 10);

const app = express();
app.use(express.json());

// CORS — allow dashboard origins (dev + production behind reverse proxy)
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── In-memory store ─────────────────────────────────────────────────────────
// Keeps the last 100 suggestions so the UI can poll them on load.
const suggestionStore = [];
const MAX_STORE = 100;

function addToStore(suggestion) {
  suggestionStore.unshift(suggestion); // newest first
  if (suggestionStore.length > MAX_STORE) suggestionStore.length = MAX_STORE;
}

// ── WebSocket server ─────────────────────────────────────────────────────────
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[WS] Client connected (${clients.size} total)`);

  // Send the current store on connect so the UI doesn't start empty
  ws.send(JSON.stringify({ type: 'history', data: suggestionStore }));

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] Client disconnected (${clients.size} total)`);
  });
});

function broadcast(event, data) {
  const msg = JSON.stringify({ type: event, data });
  for (const client of clients) {
    if (client.readyState === 1 /* OPEN */) {
      client.send(msg);
    }
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /webhook
 * Receives events from OpenWA. Only processes "message.received".
 * Register this URL in OpenWA under Sessions > Webhooks.
 */
app.post('/webhook', async (req, res) => {
  const { event, sessionId, data } = req.body;

  // Acknowledge quickly — OpenWA has a 10s timeout
  res.status(200).json({ ok: true });

  if (event !== 'message.received') return;

  const message = data?.message ?? data;
  if (!message || !message.chatId) {
    console.warn('[Webhook] Received message.received without chatId, skipping.');
    return;
  }

  // Ignore outgoing messages (we sent them)
  if (message.direction === 'outgoing' || message.fromMe) return;

  console.log(`[Webhook] New message from ${message.from} in ${message.chatId} (session: ${sessionId})`);

  // Broadcast "processing" state so the UI shows a spinner immediately
  broadcast('processing', {
    sessionId,
    chatId: message.chatId,
    from: message.from,
    body: message.body,
    startedAt: new Date().toISOString(),
  });

  try {
    const result = await generateSuggestion(sessionId, message.chatId, message);
    addToStore(result);
    broadcast('suggestion', result);
    console.log(`[AI] Suggestion generated for ${message.chatId} (${result.historyCount} history msgs)`);
  } catch (err) {
    console.error('[AI] Error generating suggestion:', err.message);
    broadcast('error', {
      sessionId,
      chatId: message.chatId,
      error: err.message,
    });
  }
});

/**
 * GET /suggestions
 * Returns the last N suggestions. Useful for polling or initial page load.
 */
app.get('/suggestions', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '20', 10), MAX_STORE);
  res.json({ data: suggestionStore.slice(0, limit) });
});

/**
 * POST /analyze
 * Analyze a conversation: recap, sentiment, recommended actions.
 * Body: { sessionId, chatId, limit?: number }
 */
app.post('/analyze', async (req, res) => {
  const { sessionId, chatId, limit } = req.body;

  if (!sessionId || !chatId) {
    return res.status(400).json({ error: 'sessionId and chatId are required' });
  }

  const parsedLimit = limit ? Math.min(parseInt(limit, 10), 100) : undefined;

  broadcast('processing', {
    sessionId,
    chatId,
    from: chatId,
    body: 'Analisi conversazione in corso…',
    startedAt: new Date().toISOString(),
  });

  try {
    const result = await analyzeConversation(sessionId, chatId, parsedLimit);
    addToStore({
      ...result,
      suggestion: result.analysis?.recap || JSON.stringify(result.analysis),
      historyCount: result.messageCount,
      triggerMessage: { from: chatId, body: '', type: 'analysis' },
    });
    broadcast('analysis', result);
    broadcast('suggestion', {
      sessionId: result.sessionId,
      chatId: result.chatId,
      triggerMessage: { from: result.chatId, body: 'Analisi manuale', type: 'analysis' },
      historyCount: result.messageCount,
      suggestion: result.analysis?.recap || '',
      model: result.model,
      generatedAt: result.generatedAt,
      analysis: result.analysis,
    });
    res.json(result);
  } catch (err) {
    console.error('[AI] Analysis error:', err.message);
    broadcast('error', { sessionId, chatId, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /suggest
 * On-demand: trigger a suggestion for a specific chat without waiting for a new message.
 * Body: { sessionId, chatId, message: { body, from, type } }
 */
app.post('/suggest', async (req, res) => {
  const { sessionId, chatId, message } = req.body;

  if (!sessionId || !chatId || !message) {
    return res.status(400).json({ error: 'sessionId, chatId and message are required' });
  }

  try {
    const result = await generateSuggestion(sessionId, chatId, message);
    addToStore(result);
    broadcast('suggestion', result);
    res.json(result);
  } catch (err) {
    console.error('[AI] On-demand suggestion error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /health
 */
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    suggestions: suggestionStore.length,
    wsClients: clients.size,
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    openwaUrl: process.env.OPENWA_BASE_URL,
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  🤖 OpenWA AI Service avviato');
  console.log(`  📡 Webhook:     http://localhost:${PORT}/webhook`);
  console.log(`  🔍 Analisi:       http://localhost:${PORT}/analyze`);
  console.log(`  💡 Suggerimenti: http://localhost:${PORT}/suggestions`);
  console.log(`  🔌 WebSocket:   ws://localhost:${PORT}`);
  console.log(`  ❤️  Health:      http://localhost:${PORT}/health`);
  console.log('');
  console.log('  Passo successivo: registra il webhook su OpenWA');
  console.log(`  → POST /api/sessions/{id}/webhooks`);
  console.log(`  → { "url": "http://localhost:${PORT}/webhook", "events": ["message.received"] }`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
});
