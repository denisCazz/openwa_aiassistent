import { useState, useEffect, useCallback } from 'react';
import {
  Bot, Loader2, Copy, Check, MessageSquare, Clock,
  WifiOff, RefreshCw, Sparkles, AlertCircle,
  Search, Users, Smile, Meh, Frown, ListChecks, Zap,
  Brain, ArrowRight, Hash,
} from 'lucide-react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useSessionsQuery, useSessionChatsQuery } from '../hooks/queries';
import type { ChatSummary } from '../services/api';
import './AiCopilot.css';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Sentiment {
  label: string;
  score: number;
  rationale: string;
}

interface RecommendedAction {
  action: string;
  reason: string;
  urgency: string;
}

interface SuggestedReply {
  label: string;
  text: string;
  strategy: string;
}

interface ConversationAnalysis {
  recap: string;
  sentiment: Sentiment;
  conversationStage?: string;
  priority?: string;
  recommendedActions: RecommendedAction[];
  keyTopics?: string[];
  suggestedReplies?: SuggestedReply[];
}

interface AnalysisResult {
  sessionId: string;
  chatId: string;
  messageCount: number;
  analysis: ConversationAnalysis;
  model: string;
  generatedAt: string;
}

const AI_PATH_PREFIX = import.meta.env.VITE_AI_SERVICE_URL || '/ai';

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
  if (chatId.endsWith('@g.us')) return chatId.replace('@g.us', '');
  return '+' + chatId.replace('@c.us', '');
}

function chatLabel(chat: ChatSummary) {
  if (chat.name && !chat.name.includes('@')) return chat.name;
  return formatPhone(chat.id);
}

function chatInitials(chat: ChatSummary) {
  const label = chatLabel(chat);
  if (chat.isGroup) return label.slice(0, 2).toUpperCase();
  return label.replace(/\D/g, '').slice(-2) || '??';
}

function sentimentClass(label: string) {
  if (/positiv/i.test(label)) return 'positive';
  if (/negativ/i.test(label)) return 'negative';
  if (/misto/i.test(label)) return 'mixed';
  return 'neutral';
}

function urgencyClass(u: string) {
  if (/alta/i.test(u)) return 'high';
  if (/media/i.test(u)) return 'medium';
  return 'low';
}

function sentimentEmoji(label: string) {
  if (/positiv/i.test(label)) return <Smile size={20} />;
  if (/negativ/i.test(label)) return <Frown size={20} />;
  return <Meh size={20} />;
}

function scoreToPercent(score: number) {
  return Math.round(((score + 1) / 2) * 100);
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatusPill({ ok, loading }: { ok: boolean | null; loading?: boolean }) {
  if (loading || ok === null) {
    return <span className="aic-pill aic-pill-loading"><Loader2 size={12} className="animate-spin" /> Connessione…</span>;
  }
  return ok
    ? <span className="aic-pill aic-pill-ok"><span className="aic-pill-dot" /> AI attivo</span>
    : <span className="aic-pill aic-pill-error"><WifiOff size={12} /> Offline</span>;
}

function SentimentMeter({ sentiment }: { sentiment: Sentiment }) {
  const pct = scoreToPercent(sentiment.score);
  const cls = sentimentClass(sentiment.label);

  return (
    <div className={`aic-meter aic-meter-${cls}`}>
      <div className="aic-meter-icon">{sentimentEmoji(sentiment.label)}</div>
      <div className="aic-meter-body">
        <div className="aic-meter-top">
          <span className="aic-meter-label">{sentiment.label}</span>
          <span className="aic-meter-score">
            {sentiment.score > 0 ? '+' : ''}{sentiment.score.toFixed(2)}
          </span>
        </div>
        <div className="aic-meter-track">
          <div className="aic-meter-fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="aic-meter-rationale">{sentiment.rationale}</p>
      </div>
    </div>
  );
}

function AnalysisPanel({ result, chatName }: { result: AnalysisResult; chatName: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const { analysis } = result;

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    });
  };

  return (
    <div className="aic-results">
      {/* Result header */}
      <div className="aic-results-header">
        <div className="aic-results-avatar">{chatName.slice(0, 2).toUpperCase()}</div>
        <div className="aic-results-title">
          <h2>{chatName}</h2>
          <p>
            <MessageSquare size={13} /> {result.messageCount} messaggi
            <span className="aic-sep">·</span>
            <Clock size={13} /> {formatDate(result.generatedAt)}
            <span className="aic-sep">·</span>
            <Brain size={13} /> {result.model}
          </p>
        </div>
        {analysis.priority && (
          <span className={`aic-badge aic-badge-${urgencyClass(analysis.priority)}`}>
            Priorità {analysis.priority}
          </span>
        )}
      </div>

      <div className="aic-results-grid">
        {/* Left column: sentiment + recap */}
        <div className="aic-results-main">
          {analysis.sentiment && <SentimentMeter sentiment={analysis.sentiment} />}

          <div className="aic-panel">
            <div className="aic-panel-head">
              <Sparkles size={15} />
              <h3>Recap conversazione</h3>
            </div>
            <p className="aic-recap-text">{analysis.recap}</p>
            {analysis.conversationStage && (
              <div className="aic-stage-chip">
                <Zap size={13} /> Fase: {analysis.conversationStage}
              </div>
            )}
            {analysis.keyTopics && analysis.keyTopics.length > 0 && (
              <div className="aic-topics">
                {analysis.keyTopics.map((t, i) => (
                  <span key={i} className="aic-topic"><Hash size={11} />{t}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column: actions */}
        {analysis.recommendedActions?.length > 0 && (
          <div className="aic-panel aic-panel-actions">
            <div className="aic-panel-head">
              <ListChecks size={15} />
              <h3>Azioni consigliate</h3>
            </div>
            <div className="aic-timeline">
              {analysis.recommendedActions.map((act, i) => (
                <div key={i} className="aic-timeline-item">
                  <div className="aic-timeline-dot" />
                  <div className="aic-timeline-content">
                    <div className="aic-timeline-top">
                      <span>{act.action}</span>
                      <span className={`aic-badge aic-badge-sm aic-badge-${urgencyClass(act.urgency)}`}>
                        {act.urgency}
                      </span>
                    </div>
                    <p>{act.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Suggested replies */}
      {analysis.suggestedReplies && analysis.suggestedReplies.length > 0 && (
        <div className="aic-panel aic-panel-replies">
          <div className="aic-panel-head">
            <MessageSquare size={15} />
            <h3>Risposte suggerite</h3>
          </div>
          <div className="aic-replies-grid">
            {analysis.suggestedReplies.map((opt, i) => (
              <div key={i} className="aic-reply-card">
                <div className="aic-reply-card-head">
                  <span className="aic-reply-num">{i + 1}</span>
                  <span className="aic-reply-label">{opt.label}</span>
                  <button
                    className={`aic-copy${copied === `r-${i}` ? ' copied' : ''}`}
                    onClick={() => handleCopy(opt.text, `r-${i}`)}
                  >
                    {copied === `r-${i}` ? <><Check size={13} /> Copiato</> : <><Copy size={13} /> Copia</>}
                  </button>
                </div>
                {opt.text && <blockquote>"{opt.text}"</blockquote>}
                {opt.strategy && <p className="aic-reply-tip"><Sparkles size={11} /> {opt.strategy}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function AiCopilot() {
  useDocumentTitle('AI Copilot');

  const { data: sessions = [], isLoading: sessionsLoading } = useSessionsQuery();
  const readySessions = sessions.filter(s => s.status === 'ready');

  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [selectedChatId, setSelectedChatId] = useState('');
  const [chatSearch, setChatSearch] = useState('');

  const { data: chats = [], isLoading: chatsLoading, refetch: refetchChats } = useSessionChatsQuery(
    selectedSessionId,
    !!selectedSessionId,
  );

  const [serviceReachable, setServiceReachable] = useState<boolean | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  useEffect(() => {
    if (!selectedSessionId && readySessions.length > 0) {
      setSelectedSessionId(readySessions[0].id);
    }
  }, [readySessions, selectedSessionId]);

  useEffect(() => {
    setSelectedChatId('');
    setResult(null);
    setError(null);
  }, [selectedSessionId]);

  const checkHealth = useCallback(() => {
    setServiceReachable(null);
    fetch(`${AI_PATH_PREFIX}/health`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(() => setServiceReachable(true))
      .catch(() => setServiceReachable(false));
  }, []);

  useEffect(() => { checkHealth(); }, [checkHealth]);

  const filteredChats = chats.filter(c => {
    if (!chatSearch.trim()) return true;
    const q = chatSearch.toLowerCase();
    return chatLabel(c).toLowerCase().includes(q)
      || c.id.toLowerCase().includes(q)
      || (c.lastMessage?.body || '').toLowerCase().includes(q);
  });

  const selectedChat = chats.find(c => c.id === selectedChatId);
  const selectedSession = sessions.find(s => s.id === selectedSessionId);

  const handleAnalyze = async () => {
    if (!selectedSessionId || !selectedChatId) return;
    setAnalyzing(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`${AI_PATH_PREFIX}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: selectedSessionId, chatId: selectedChatId, limit: 30 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore durante l\'analisi');
    } finally {
      setAnalyzing(false);
    }
  };

  if (serviceReachable === false) {
    return (
      <div className="aic-page">
        <div className="aic-offline">
          <div className="aic-offline-icon"><WifiOff size={32} /></div>
          <h2>Servizio AI non raggiungibile</h2>
          <p>Verifica che il container <code>ai-service</code> sia avviato e raggiungibile.</p>
          <button className="aic-btn" onClick={checkHealth}><RefreshCw size={15} /> Riprova connessione</button>
        </div>
      </div>
    );
  }

  return (
    <div className="aic-page">
      {/* Hero header */}
      <header className="aic-hero">
        <div className="aic-hero-text">
          <div className="aic-hero-icon"><Bot size={22} /></div>
          <div>
            <h1>AI Copilot</h1>
            <p>Analizza le conversazioni WhatsApp — recap, sentiment e azioni consigliate</p>
          </div>
        </div>
        <StatusPill ok={serviceReachable} loading={serviceReachable === null} />
      </header>

      <div className="aic-layout">
        {/* ── Sidebar ── */}
        <aside className="aic-sidebar">
          <div className="aic-sidebar-section">
            <label className="aic-field-label">Sessione</label>
            <select
              className="aic-select"
              value={selectedSessionId}
              onChange={e => setSelectedSessionId(e.target.value)}
              disabled={sessionsLoading}
            >
              <option value="">Seleziona sessione…</option>
              {readySessions.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.phone ? ` · ${s.phone}` : ''}
                </option>
              ))}
            </select>
            {readySessions.length === 0 && !sessionsLoading && (
              <p className="aic-warn"><AlertCircle size={13} /> Nessuna sessione attiva</p>
            )}
          </div>

          {selectedSessionId && (
            <div className="aic-sidebar-section aic-sidebar-chats">
              <div className="aic-chats-head">
                <label className="aic-field-label">Conversazioni</label>
                <button className="aic-icon-btn" onClick={() => refetchChats()} disabled={chatsLoading} title="Aggiorna">
                  <RefreshCw size={14} className={chatsLoading ? 'animate-spin' : ''} />
                </button>
              </div>

              <div className="aic-search">
                <Search size={15} />
                <input
                  type="text"
                  placeholder="Cerca nome o messaggio…"
                  value={chatSearch}
                  onChange={e => setChatSearch(e.target.value)}
                />
              </div>

              <div className="aic-chats">
                {chatsLoading && (
                  <div className="aic-chats-state">
                    <Loader2 size={20} className="animate-spin" />
                    <span>Caricamento chat…</span>
                  </div>
                )}
                {!chatsLoading && filteredChats.length === 0 && (
                  <div className="aic-chats-state muted">Nessuna conversazione</div>
                )}
                {filteredChats.map(chat => (
                  <button
                    key={chat.id}
                    className={`aic-chat${selectedChatId === chat.id ? ' active' : ''}`}
                    onClick={() => setSelectedChatId(chat.id)}
                  >
                    <div className={`aic-chat-avatar${chat.isGroup ? ' group' : ''}`}>
                      {chat.isGroup ? <Users size={15} /> : chatInitials(chat)}
                    </div>
                    <div className="aic-chat-body">
                      <div className="aic-chat-top">
                        <span className="aic-chat-name">{chatLabel(chat)}</span>
                        {chat.unreadCount > 0 && <span className="aic-chat-badge">{chat.unreadCount}</span>}
                      </div>
                      {chat.lastMessage && (
                        <span className="aic-chat-preview">
                          {chat.lastMessage.fromMe ? 'Tu: ' : ''}{chat.lastMessage.body?.slice(0, 55)}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedChatId && (
            <div className="aic-sidebar-footer">
              <button className="aic-btn aic-btn-analyze" onClick={handleAnalyze} disabled={analyzing}>
                {analyzing
                  ? <><Loader2 size={16} className="animate-spin" /> Analisi in corso…</>
                  : <><Sparkles size={16} /> Analizza 30 messaggi</>}
              </button>
            </div>
          )}
        </aside>

        {/* ── Main content ── */}
        <main className="aic-main">
          {error && (
            <div className="aic-alert error">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {analyzing && (
            <div className="aic-analyzing">
              <div className="aic-analyzing-ring">
                <Loader2 size={36} className="animate-spin" />
              </div>
              <h3>Analisi in corso</h3>
              <p>
                Sto leggendo gli ultimi 30 messaggi con{' '}
                <strong>{selectedChat ? chatLabel(selectedChat) : 'la conversazione selezionata'}</strong>
                {selectedSession && <> · sessione <strong>{selectedSession.name}</strong></>}
              </p>
            </div>
          )}

          {!result && !analyzing && !error && (
            <div className="aic-empty">
              <div className="aic-empty-visual">
                <div className="aic-empty-circle"><Brain size={40} /></div>
              </div>
              <h3>Pronto per l'analisi</h3>
              <p>
                Seleziona una conversazione dalla lista a sinistra, poi clicca
                <strong> Analizza 30 messaggi</strong> per ottenere recap, sentiment e azioni consigliate.
              </p>
              <div className="aic-steps">
                <div className="aic-step"><span>1</span> Scegli sessione</div>
                <ArrowRight size={14} className="aic-step-arrow" />
                <div className="aic-step"><span>2</span> Scegli chat</div>
                <ArrowRight size={14} className="aic-step-arrow" />
                <div className="aic-step"><span>3</span> Analizza</div>
              </div>
            </div>
          )}

          {result && !analyzing && (
            <AnalysisPanel
              result={result}
              chatName={selectedChat ? chatLabel(selectedChat) : formatPhone(result.chatId)}
            />
          )}
        </main>
      </div>
    </div>
  );
}
