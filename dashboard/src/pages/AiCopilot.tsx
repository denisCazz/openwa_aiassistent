import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bot, Loader2, Copy, Check, MessageSquare, Clock,
  ChevronDown, ChevronUp, Wifi, WifiOff, RefreshCw,
  User, Sparkles, AlertCircle, BookOpen,
} from 'lucide-react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { PageHeader } from '../components/PageHeader';
import './AiCopilot.css';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TriggerMessage {
  id?: string;
  from: string;
  body: string;
  type: string;
  timestamp?: number;
}

interface Suggestion {
  sessionId: string;
  chatId: string;
  triggerMessage: TriggerMessage;
  historyCount: number;
  suggestion: string;
  model: string;
  generatedAt: string;
}

interface ProcessingState {
  sessionId: string;
  chatId: string;
  from: string;
  body: string;
  startedAt: string;
}

interface WsMessage {
  type: 'suggestion' | 'processing' | 'error' | 'history';
  data: Suggestion | ProcessingState | { chatId: string; error: string } | Suggestion[];
}

// ─── Config ───────────────────────────────────────────────────────────────────

const AI_SERVICE_URL = import.meta.env.VITE_AI_SERVICE_URL || '';
const AI_PATH_PREFIX = AI_SERVICE_URL || '/ai';
const AI_WS_URL = AI_SERVICE_URL
  ? AI_SERVICE_URL.replace(/^http/, 'ws')
  : `ws://${window.location.host}/ai`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `Oggi ${formatTime(iso)}`;
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }) + ' ' + formatTime(iso);
}

function formatPhone(chatId: string) {
  return '+' + chatId.replace('@c.us', '').replace('@g.us', '');
}

/**
 * Parse GPT markdown output into structured sections.
 */
function parseSuggestion(text: string) {
  const lines = text.split('\n');
  const analysisLines: string[] = [];
  const optionBlocks: { label: string; reply: string; strategy: string }[] = [];
  let priority = '';
  let mode: 'none' | 'analysis' | 'option' = 'none';
  let currentOption: { label: string; reply: string; strategy: string } | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (/analisi conversazione/i.test(line)) { mode = 'analysis'; continue; }
    if (/suggerimenti risposta/i.test(line)) { mode = 'none'; continue; }
    if (/priorit/i.test(line) && line.startsWith('⚡')) {
      priority = line.replace(/^⚡\s*\*\*Priorità[^:]*:\*\*\s*/i, '').replace(/\*\*/g, '').trim();
      continue;
    }
    if (line === '---' || line === '') continue;

    if (mode === 'analysis') {
      if (line) analysisLines.push(line.replace(/\*\*/g, ''));
      continue;
    }

    const optionHeader = line.match(/\*\*Opzione\s+\d+\s*[-–]\s*([^:*]+)[:\*]/i);
    if (optionHeader) {
      if (currentOption) optionBlocks.push(currentOption);
      currentOption = { label: optionHeader[1].trim(), reply: '', strategy: '' };
      mode = 'option';
      continue;
    }

    if (mode === 'option' && currentOption) {
      const replyMatch = line.match(/^"(.+)"$/);
      if (replyMatch) { currentOption.reply = replyMatch[1]; continue; }
      if (line.startsWith('→')) { currentOption.strategy = line.replace(/^→\s*\*?/, '').replace(/\*$/, '').trim(); continue; }
    }
  }
  if (currentOption) optionBlocks.push(currentOption);

  return { analysis: analysisLines.join(' '), options: optionBlocks, priority, raw: text };
}

function priorityColor(p: string) {
  if (/alta/i.test(p)) return 'high';
  if (/media/i.test(p)) return 'medium';
  return 'low';
}

// ─── SuggestionCard ──────────────────────────────────────────────────────────

function SuggestionCard({ item }: { item: Suggestion }) {
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const parsed = parseSuggestion(item.suggestion);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    });
  };

  return (
    <div className="aic-card">
      {/* Header */}
      <div className="aic-card-header" onClick={() => setExpanded(e => !e)}>
        <div className="aic-avatar"><User size={14} /></div>
        <div className="aic-card-info">
          <span className="aic-phone">{formatPhone(item.chatId)}</span>
          <span className="aic-meta">
            <BookOpen size={11} /> {item.historyCount} msg caricati
            <span className="aic-dot" />
            <Clock size={11} /> {formatDate(item.generatedAt)}
          </span>
        </div>
        {parsed.priority && (
          <span className={`aic-priority aic-priority-${priorityColor(parsed.priority)}`}>
            {parsed.priority.split('—')[0].trim()}
          </span>
        )}
        <button className="aic-toggle">{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
      </div>

      {/* Incoming message */}
      <div className="aic-trigger">
        <MessageSquare size={12} className="aic-trigger-icon" />
        <span className="aic-trigger-text">{item.triggerMessage.body || `[${item.triggerMessage.type}]`}</span>
      </div>

      {expanded && (
        <div className="aic-body">
          {/* Analysis */}
          {parsed.analysis && (
            <div className="aic-section aic-section-analysis">
              <div className="aic-section-title"><Sparkles size={12} /> Analisi</div>
              <p className="aic-analysis-text">{parsed.analysis}</p>
            </div>
          )}

          {/* Reply options */}
          {parsed.options.length > 0 ? (
            <div className="aic-section">
              <div className="aic-section-title"><MessageSquare size={12} /> Risposte suggerite</div>
              <div className="aic-options">
                {parsed.options.map((opt, i) => (
                  <div key={i} className="aic-option">
                    <div className="aic-option-top">
                      <span className="aic-option-num">{i + 1}</span>
                      <span className="aic-option-label">{opt.label}</span>
                      <button
                        className={`aic-copy-btn${copied === `opt-${item.generatedAt}-${i}` ? ' copied' : ''}`}
                        onClick={() => handleCopy(opt.reply || opt.label, `opt-${item.generatedAt}-${i}`)}
                        disabled={!opt.reply}
                      >
                        {copied === `opt-${item.generatedAt}-${i}`
                          ? <><Check size={11} /> Copiato</>
                          : <><Copy size={11} /> Copia</>}
                      </button>
                    </div>
                    {opt.reply && <blockquote className="aic-reply">"{opt.reply}"</blockquote>}
                    {opt.strategy && <p className="aic-strategy">💡 {opt.strategy}</p>}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="aic-section aic-section-raw">
              <div className="aic-section-title"><Sparkles size={12} /> Suggerimento</div>
              <pre className="aic-raw">{item.suggestion}</pre>
              <button
                className={`aic-copy-btn${copied === `raw-${item.generatedAt}` ? ' copied' : ''}`}
                onClick={() => handleCopy(item.suggestion, `raw-${item.generatedAt}`)}
              >
                {copied === `raw-${item.generatedAt}` ? <><Check size={11} /> Copiato</> : <><Copy size={11} /> Copia tutto</>}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function AiCopilot() {
  useDocumentTitle('AI Copilot');

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [processing, setProcessing] = useState<ProcessingState | null>(null);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [serviceReachable, setServiceReachable] = useState<boolean | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const knownKeys = useRef<Set<string>>(new Set());

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    setWsStatus('connecting');
    const ws = new WebSocket(AI_WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setWsStatus('connected');

    ws.onmessage = (e) => {
      try {
        const msg: WsMessage = JSON.parse(e.data);
        if (msg.type === 'history') {
          const incoming = msg.data as Suggestion[];
          const fresh = incoming.filter(s => !knownKeys.current.has(s.generatedAt));
          fresh.forEach(s => knownKeys.current.add(s.generatedAt));
          if (fresh.length > 0) setSuggestions(prev => [...fresh, ...prev].slice(0, 100));
        } else if (msg.type === 'suggestion') {
          const s = msg.data as Suggestion;
          if (!knownKeys.current.has(s.generatedAt)) {
            knownKeys.current.add(s.generatedAt);
            setSuggestions(prev => [s, ...prev].slice(0, 100));
          }
          setProcessing(null);
        } else if (msg.type === 'processing') {
          setProcessing(msg.data as ProcessingState);
        } else if (msg.type === 'error') {
          setProcessing(null);
        }
      } catch {}
    };

    ws.onclose = () => {
      setWsStatus('disconnected');
      reconnectTimer.current = setTimeout(connect, 5000);
    };
    ws.onerror = () => ws.close();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch(`${AI_PATH_PREFIX}/health`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(() => { setServiceReachable(true); connect(); })
      .catch(() => setServiceReachable(false));
    return () => {
      reconnectTimer.current && clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const handleRetry = () => {
    setServiceReachable(null);
    fetch(`${AI_PATH_PREFIX}/health`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(() => { setServiceReachable(true); connect(); })
      .catch(() => setServiceReachable(false));
  };

  if (serviceReachable === false) {
    return (
      <div className="aic-page">
        <PageHeader title="AI Copilot" subtitle="Suggerimenti di risposta in tempo reale" />
        <div className="aic-center-state">
          <div className="aic-offline-icon"><WifiOff size={28} /></div>
          <h3>Servizio AI non raggiungibile</h3>
          <p>Il processo non risponde su <code>/ai/health</code>.</p>
          <pre className="aic-code-block">cd ai-service{'\n'}npm run dev</pre>
          <button className="aic-btn-primary" onClick={handleRetry}><RefreshCw size={13} /> Riprova</button>
        </div>
      </div>
    );
  }

  return (
    <div className="aic-page">
      <PageHeader title="AI Copilot" subtitle="Suggerimenti di risposta in tempo reale" />

      <div className="aic-statusbar">
        <span className={`aic-dot-status aic-dot-${wsStatus}`} />
        <span className="aic-ws-label">
          {wsStatus === 'connected' ? 'Live' : wsStatus === 'connecting' ? 'Connessione…' : 'Disconnesso'}
        </span>
        {wsStatus === 'connecting' && <Loader2 size={11} className="animate-spin" />}
        <span className="aic-statusbar-sep" />
        <Wifi size={11} /> <span>AI Service</span>
        <span className="aic-statusbar-count">{suggestions.length} suggeriment{suggestions.length === 1 ? 'o' : 'i'}</span>
      </div>

      {processing && (
        <div className="aic-banner">
          <Loader2 size={13} className="animate-spin" />
          <div>
            <strong>Analisi in corso</strong> · {formatPhone(processing.chatId)}
            <span className="aic-banner-body"> "{processing.body?.slice(0, 80)}{(processing.body?.length ?? 0) > 80 ? '…' : ''}"</span>
          </div>
        </div>
      )}

      {serviceReachable === null && (
        <div className="aic-center-state"><Loader2 size={28} className="animate-spin" /><span>Connessione…</span></div>
      )}

      {serviceReachable === true && suggestions.length === 0 && !processing && (
        <div className="aic-center-state">
          <div className="aic-empty-icon"><Bot size={36} /></div>
          <h3>In attesa di messaggi</h3>
          <p>Quando arriverà un messaggio WhatsApp, l'AI analizzerà la conversazione e mostrerà le risposte suggerite.</p>
          <div className="aic-hint">
            <AlertCircle size={12} />
            <span>Webhook: <code>url = http://localhost:3100/webhook</code>, evento: <code>message.received</code></span>
          </div>
        </div>
      )}

      <div className="aic-list">
        {suggestions.map((s, i) => (
          <SuggestionCard key={`${s.generatedAt}-${i}`} item={s} />
        ))}
      </div>
    </div>
  );
}
