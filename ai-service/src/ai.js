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

/**
 * Fetch conversation history from OpenWA for a specific chat.
 * Paginates through the API to collect up to HISTORY_LIMIT messages.
 * Returns messages sorted oldest→newest.
 */
async function fetchHistory(sessionId, chatId) {
  const pageSize = 50; // OpenWA max per request
  const maxMessages = HISTORY_LIMIT;
  let allMessages = [];
  let offset = 0;

  while (allMessages.length < maxMessages) {
    const remaining = maxMessages - allMessages.length;
    const limit = Math.min(pageSize, remaining);
    const url = `${OPENWA_BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}/messages`
      + `?chatId=${encodeURIComponent(chatId)}&limit=${limit}&offset=${offset}`;

    const res = await fetch(url, {
      headers: { 'X-API-Key': OPENWA_API_KEY },
    });

    if (!res.ok) {
      throw new Error(`OpenWA messages API error: ${res.status} ${await res.text()}`);
    }

    const json = await res.json();
    const page = json.data ?? json ?? [];

    if (!Array.isArray(page) || page.length === 0) break; // no more messages

    allMessages = allMessages.concat(page);
    offset += page.length;

    if (page.length < limit) break; // last page
  }

  // Sort chronologically (oldest first)
  allMessages.sort((a, b) => {
    const ta = a.timestamp ?? new Date(a.createdAt).getTime() / 1000 ?? 0;
    const tb = b.timestamp ?? new Date(b.createdAt).getTime() / 1000 ?? 0;
    return ta - tb;
  });

  return allMessages;
}

/**
 * Build the OpenAI messages array from the conversation history.
 * Adds a strong system prompt that instructs the model to act as a reply advisor.
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

  // Build conversation history as alternating user/assistant messages
  if (history.length > 0) {
    let conversationText = '📱 **Storico conversazione** (dal più vecchio al più recente):\n\n';
    for (const msg of history) {
      const who = msg.direction === 'incoming' ? '👤 Contatto' : '✉️ Tu';
      const time = msg.createdAt ? new Date(msg.createdAt).toLocaleString('it-IT') : '';
      const text = msg.body || `[${msg.type || 'media'}]`;
      conversationText += `${who} [${time}]: ${text}\n`;
    }
    chatMessages.push({
      role: 'user',
      content: conversationText,
    });
  }

  // The trigger message (latest incoming)
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
    // Remove the trigger message itself if it's already in history
    history = history.filter(m => m.waMessageId !== triggerMessage.waMessageId);
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
      id: triggerMessage.waMessageId,
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
