import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config({ path: resolve(__dirname, '../.env') });

import OpenAI from 'openai';
import fetch from 'node-fetch';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const OPENWA_BASE_URL = process.env.OPENWA_BASE_URL || 'http://localhost:2785';
const OPENWA_API_KEY = process.env.OPENWA_API_KEY || '';
const HISTORY_LIMIT = parseInt(process.env.HISTORY_LIMIT || '30', 10);
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const REPLY_LANGUAGE = process.env.REPLY_LANGUAGE || 'italiano';
const SYSTEM_PROMPT_EXTRA = process.env.SYSTEM_PROMPT_EXTRA || '';

function apiHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (OPENWA_API_KEY) headers['X-API-Key'] = OPENWA_API_KEY;
  return headers;
}

/**
 * Parse OpenWA API response — handles { messages, total } and wrapped { data: ... } shapes.
 */
function extractMessages(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.data?.messages)) return json.data.messages;
  if (Array.isArray(json?.messages)) return json.messages;
  return [];
}

/**
 * Normalize a message object from DB or live WhatsApp API.
 */
function normalizeMessage(msg) {
  const direction = msg.direction
    ?? (msg.fromMe ? 'outgoing' : 'incoming');
  return {
    waMessageId: msg.waMessageId ?? msg.id,
    chatId: msg.chatId,
    from: msg.from,
    to: msg.to,
    body: msg.body || (msg.type && msg.type !== 'chat' ? `[${msg.type}]` : ''),
    type: msg.type || 'text',
    direction,
    timestamp: msg.timestamp ?? (msg.createdAt ? Math.floor(new Date(msg.createdAt).getTime() / 1000) : 0),
    createdAt: msg.createdAt,
  };
}

function sortChronologically(messages) {
  return [...messages].sort((a, b) => {
    const ta = a.timestamp ?? new Date(a.createdAt).getTime() / 1000 ?? 0;
    const tb = b.timestamp ?? new Date(b.createdAt).getTime() / 1000 ?? 0;
    return ta - tb;
  });
}

/**
 * Fetch conversation history from OpenWA database API.
 */
async function fetchHistoryFromDb(sessionId, chatId, limit = HISTORY_LIMIT) {
  const url = `${OPENWA_BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}/messages`
    + `?chatId=${encodeURIComponent(chatId)}&limit=${limit}&offset=0`;

  const res = await fetch(url, { headers: apiHeaders() });
  if (!res.ok) {
    throw new Error(`OpenWA messages API error: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  const page = extractMessages(json);
  return sortChronologically(page.map(normalizeMessage)).slice(-limit);
}

/**
 * Fetch live message history directly from WhatsApp via OpenWA engine.
 */
async function fetchHistoryLive(sessionId, chatId, limit = HISTORY_LIMIT) {
  const url = `${OPENWA_BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}/chats`
    + `/${encodeURIComponent(chatId)}/messages?limit=${limit}`;

  const res = await fetch(url, { headers: apiHeaders() });
  if (!res.ok) {
    throw new Error(`OpenWA live messages API error: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  const page = extractMessages(json);
  return sortChronologically(page.map(normalizeMessage)).slice(-limit);
}

/**
 * Fetch up to `limit` messages, preferring DB then falling back to live WhatsApp.
 */
export async function fetchHistory(sessionId, chatId, limit = HISTORY_LIMIT) {
  let history = [];
  try {
    history = await fetchHistoryFromDb(sessionId, chatId, limit);
  } catch (err) {
    console.warn('[AI] DB history fetch failed:', err.message);
  }

  if (history.length === 0) {
    try {
      history = await fetchHistoryLive(sessionId, chatId, limit);
    } catch (err) {
      console.warn('[AI] Live history fetch failed:', err.message);
      if (history.length === 0) throw err;
    }
  }

  return history.slice(-limit);
}

function formatHistoryForPrompt(history) {
  if (history.length === 0) return 'Nessun messaggio disponibile nella cronologia.';

  let text = `Storico conversazione (ultimi ${history.length} messaggi, dal più vecchio al più recente):\n\n`;
  for (const msg of history) {
    const who = msg.direction === 'incoming' ? 'Contatto' : 'Tu';
    const time = msg.timestamp
      ? new Date(msg.timestamp * 1000).toLocaleString('it-IT')
      : (msg.createdAt ? new Date(msg.createdAt).toLocaleString('it-IT') : '');
    const body = msg.body || `[${msg.type || 'media'}]`;
    text += `${who} [${time}]: ${body}\n`;
  }
  return text;
}

/**
 * Analyze a conversation: recap, sentiment, recommended actions.
 */
export async function analyzeConversation(sessionId, chatId, limit = HISTORY_LIMIT) {
  const history = await fetchHistory(sessionId, chatId, limit);

  const systemPrompt = `Sei un assistente esperto di comunicazione e customer care su WhatsApp.
Analizza la conversazione fornita e produci un'analisi strutturata in JSON.

Rispondi SEMPRE in ${REPLY_LANGUAGE} per i campi testuali (recap, rationale, azioni).
${SYSTEM_PROMPT_EXTRA ? `Note aggiuntive: ${SYSTEM_PROMPT_EXTRA}` : ''}

Schema JSON richiesto:
{
  "recap": "riassunto conciso della conversazione (3-5 frasi)",
  "sentiment": {
    "label": "positivo" | "neutro" | "negativo" | "misto",
    "score": numero da -1 (molto negativo) a 1 (molto positivo),
    "rationale": "breve spiegazione del sentiment rilevato"
  },
  "conversationStage": "es. primo contatto, trattativa, follow-up, supporto, chiusura",
  "priority": "bassa" | "media" | "alta",
  "recommendedActions": [
    {
      "action": "azione concreta da intraprendere",
      "reason": "perché questa azione è consigliata",
      "urgency": "bassa" | "media" | "alta"
    }
  ],
  "keyTopics": ["argomento1", "argomento2"],
  "suggestedReplies": [
    {
      "label": "etichetta breve",
      "text": "testo risposta pronto da inviare",
      "strategy": "strategia dietro questa risposta"
    }
  ]
}

Fornisci 2-4 recommendedActions e 1-3 suggestedReplies pertinenti.`;

  const userContent = formatHistoryForPrompt(history);

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: 0.5,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices[0]?.message?.content || '{}';
  let analysis;
  try {
    analysis = JSON.parse(raw);
  } catch {
    analysis = {
      recap: raw,
      sentiment: { label: 'neutro', score: 0, rationale: 'Analisi non strutturata' },
      recommendedActions: [],
      suggestedReplies: [],
    };
  }

  return {
    sessionId,
    chatId,
    messageCount: history.length,
    messages: history,
    analysis,
    model: OPENAI_MODEL,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Build the OpenAI messages array for reply suggestions (webhook flow).
 */
function buildPrompt(history, triggerMessage) {
  const systemPrompt = `Sei un assistente esperto di comunicazione e vendita. 
Il tuo compito è aiutare l'utente a rispondere nel modo più efficace ai messaggi WhatsApp che riceve.

Analizza la conversazione fornita e:
1. Comprendi il contesto, il tono e l'intenzione del contatto
2. Identifica lo stato della conversazione (primo contatto, trattativa, follow-up, ecc.)
3. Suggerisci 2-3 possibili risposte, dalla più breve alla più articolata
4. Indica brevemente la strategia dietro ogni suggerimento
5. Se il messaggio è urgente o richiede attenzione speciale, segnalalo

Rispondi sempre in ${REPLY_LANGUAGE}.
${SYSTEM_PROMPT_EXTRA ? `\nNote aggiuntive: ${SYSTEM_PROMPT_EXTRA}` : ''}

Formato risposta:
---
📊 **Analisi conversazione**
[breve analisi del contesto: chi è il contatto, a che punto siamo, tono]

💬 **Suggerimenti risposta**

**Opzione 1 - [etichetta breve]:**
"[testo risposta pronto all'uso]"
→ *[strategia: perché questa risposta]*

**Opzione 2 - [etichetta breve]:**
"[testo risposta pronto all'uso]"
→ *[strategia]*

**Opzione 3 - [etichetta breve] (opzionale):**
"[testo risposta pronto all'uso]"
→ *[strategia]*

⚡ **Priorità:** [bassa / media / alta] — [motivazione in una riga]
---`;

  const chatMessages = [{ role: 'system', content: systemPrompt }];

  if (history.length > 0) {
    chatMessages.push({
      role: 'user',
      content: formatHistoryForPrompt(history),
    });
  }

  chatMessages.push({
    role: 'user',
    content: `🔔 **Nuovo messaggio ricevuto:**\n"${triggerMessage.body || '[media]'}"\n\nSuggeriscimi come rispondere al meglio.`,
  });

  return chatMessages;
}

/**
 * Core function: given a new incoming message, fetch history and ask GPT for suggestions.
 */
export async function generateSuggestion(sessionId, chatId, triggerMessage) {
  let history = [];
  try {
    history = await fetchHistory(sessionId, chatId);
    history = history.filter(m => m.waMessageId !== (triggerMessage.waMessageId ?? triggerMessage.id));
  } catch (err) {
    console.warn('[AI] Could not fetch history:', err.message);
  }

  const messages = buildPrompt(history, triggerMessage);

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages,
    temperature: 0.7,
    max_tokens: 1200,
  });

  const suggestion = completion.choices[0]?.message?.content || 'Nessun suggerimento generato.';

  return {
    sessionId,
    chatId,
    triggerMessage: {
      id: triggerMessage.waMessageId ?? triggerMessage.id,
      from: triggerMessage.from,
      body: triggerMessage.body,
      type: triggerMessage.type,
      timestamp: triggerMessage.timestamp,
    },
    historyCount: history.length,
    suggestion,
    model: OPENAI_MODEL,
    generatedAt: new Date().toISOString(),
  };
}
