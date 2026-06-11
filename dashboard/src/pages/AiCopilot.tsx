import { useState, useEffect, useCallback } from 'react';
import {
  Bot, Loader2, Copy, Check, MessageSquare, Clock,
  Wifi, WifiOff, RefreshCw, User, Sparkles, AlertCircle,
  Search, Users, Smile, Meh, Frown, ListChecks, ChevronRight,
} from 'lucide-react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useSessionsQuery, useSessionChatsQuery } from '../hooks/queries';
import { PageHeader } from '../components/PageHeader';
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

// ─── Config ───────────────────────────────────────────────────────────────────

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
  if (chatId.endsWith('@g.us')) return chatId.replace('@g.us', ' (gruppo)');
  return '+' + chatId.replace('@c.us', '');
}

function chatLabel(chat: ChatSummary) {
  if (chat.name && !chat.name.includes('@')) return chat.name;
  return formatPhone(chat.id);
}

function sentimentIcon(label: string) {
  if (/positiv/i.test(label)) return <Smile size={16} />;
  if (/negativ/i.test(label)) return <Frown size={16} />;
  return <Meh size={16} />;
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

// ─── Analysis Result Card ─────────────────────────────────────────────────────

function AnalysisCard({ result, chatName }: { result: AnalysisResult; chatName: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const { analysis } = result;

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    });
  };

  return (
    <div className="aic-card aic-analysis-card">
      <div className="aic-card-header">
        <div className="aic-avatar"><User size={14} /></div>
        <div className="aic-card-info">
          <span className="aic-phone">{chatName}</span>
          <span className="aic-meta">
            <BookOpenIcon count={result.messageCount} />
            <span className="aic-dot" />
            <Clock size={11} /> {formatDate(result.generatedAt)}
          </span>
        </div>
        {analysis.priority && (
          <span className={`aic-priority aic-priority-${urgencyClass(analysis.priority)}`}>
            {analysis.priority}
          </span>
        )}
      </div>

      <div className="aic-body">
        {/* Sentiment */}
        {analysis.sentiment && (
          <div className={`aic-sentiment aic-sentiment-${sentimentClass(analysis.sentiment.label)}`}>
            <div className="aic-sentiment-header">
              {sentimentIcon(analysis.sentiment.label)}
              <span className="aic-sentiment-label">Sentiment: {analysis.sentiment.label}</span>
              <span className="aic-sentiment-score">
                {analysis.sentiment.score > 0 ? '+' : ''}{analysis.sentiment.score.toFixed(2)}
              </span>
            </div>
            <p className="aic-sentiment-rationale">{analysis.sentiment.rationale}</p>
          </div>
        )}

        {/* Recap */}
        <div className="aic-section aic-section-analysis">
          <div className="aic-section-title"><Sparkles size={12} /> Recap conversazione</div>
          <p className="aic-analysis-text">{analysis.recap}</p>
          {analysis.conversationStage && (
            <p className="aic-stage">Fase: <strong>{analysis.conversationStage}</strong></p>
          )}
        </div>

        {/* Key topics */}
        {analysis.keyTopics && analysis.keyTopics.length > 0 && (
          <div className="aic-topics">
            {analysis.keyTopics.map((t, i) => (
              <span key={i} className="aic-topic-tag">{t}</span>
            ))}
          </div>
        )}

        {/* Recommended actions */}
        {analysis.recommendedActions?.length > 0 && (
          <div className="aic-section">
            <div className="aic-section-title"><ListChecks size={12} /> Azioni consigliate</div>
            <div className="aic-actions">
              {analysis.recommendedActions.map((act, i) => (
                <div key={i} className="aic-action">
                  <div className="aic-action-top">
                    <ChevronRight size={14} />
                    <span className="aic-action-text">{act.action}</span>
                    <span className={`aic-urgency aic-urgency-${urgencyClass(act.urgency)}`}>
                      {act.urgency}
                    </span>
                  </div>
                  <p className="aic-action-reason">{act.reason}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Suggested replies */}
        {analysis.suggestedReplies && analysis.suggestedReplies.length > 0 && (
          <div className="aic-section">
            <div className="aic-section-title"><MessageSquare size={12} /> Risposte suggerite</div>
            <div className="aic-options">
              {analysis.suggestedReplies.map((opt, i) => (
                <div key={i} className="aic-option">
                  <div className="aic-option-top">
                    <span className="aic-option-num">{i + 1}</span>
                    <span className="aic-option-label">{opt.label}</span>
                    <button
                      className={`aic-copy-btn${copied === `reply-${i}` ? ' copied' : ''}`}
                      onClick={() => handleCopy(opt.text, `reply-${i}`)}
                    >
                      {copied === `reply-${i}`
                        ? <><Check size={11} /> Copiato</>
                        : <><Copy size={11} /> Copia</>}
                    </button>
                  </div>
                  {opt.text && <blockquote className="aic-reply">"{opt.text}"</blockquote>}
                  {opt.strategy && <p className="aic-strategy">💡 {opt.strategy}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BookOpenIcon({ count }: { count: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <MessageSquare size={11} /> {count} messaggi analizzati
    </span>
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
        <PageHeader title="AI Copilot" subtitle="Analisi conversazioni WhatsApp con recap, sentiment e azioni consigliate" />
        <div className="aic-center-state">
          <div className="aic-offline-icon"><WifiOff size={28} /></div>
          <h3>Servizio AI non raggiungibile</h3>
          <p>Il servizio AI non risponde. Verifica che il container <code>ai-service</code> sia avviato.</p>
          <button className="aic-btn-primary" onClick={checkHealth}><RefreshCw size={13} /> Riprova</button>
        </div>
      </div>
    );
  }

  return (
    <div className="aic-page">
      <PageHeader title="AI Copilot" subtitle="Seleziona una conversazione e analizza gli ultimi 30 messaggi" />

      <div className="aic-statusbar">
        <span className={`aic-dot-status aic-dot-${serviceReachable ? 'connected' : 'connecting'}`} />
        <span className="aic-ws-label">
          {serviceReachable ? 'AI Service attivo' : 'Connessione…'}
        </span>
        <span className="aic-statusbar-sep" />
        <Wifi size={11} /> <span>Analisi su richiesta</span>
      </div>

      {/* Selectors */}
      <div className="aic-selectors">
        <div className="aic-selector-group">
          <label className="aic-label">Sessione WhatsApp</label>
          <select
            className="aic-select"
            value={selectedSessionId}
            onChange={e => setSelectedSessionId(e.target.value)}
            disabled={sessionsLoading}
          >
            <option value="">— Seleziona sessione —</option>
            {readySessions.map(s => (
              <option key={s.id} value={s.id}>
                {s.name} {s.phone ? `(${s.phone})` : ''}
              </option>
            ))}
          </select>
          {readySessions.length === 0 && !sessionsLoading && (
            <p className="aic-hint-inline"><AlertCircle size={12} /> Nessuna sessione attiva. Avvia una sessione prima.</p>
          )}
        </div>

        {selectedSessionId && (
          <div className="aic-selector-group aic-selector-chat">
            <div className="aic-chat-header">
              <label className="aic-label">Conversazione</label>
              <button className="aic-refresh-btn" onClick={() => refetchChats()} disabled={chatsLoading}>
                <RefreshCw size={12} className={chatsLoading ? 'animate-spin' : ''} />
              </button>
            </div>
            <div className="aic-search">
              <Search size={14} />
              <input
                type="text"
                placeholder="Cerca conversazione…"
                value={chatSearch}
                onChange={e => setChatSearch(e.target.value)}
              />
            </div>
            <div className="aic-chat-list">
              {chatsLoading && (
                <div className="aic-chat-loading"><Loader2 size={16} className="animate-spin" /> Caricamento…</div>
              )}
              {!chatsLoading && filteredChats.length === 0 && (
                <p className="aic-chat-empty">Nessuna conversazione trovata</p>
              )}
              {filteredChats.map(chat => (
                <button
                  key={chat.id}
                  className={`aic-chat-item${selectedChatId === chat.id ? ' selected' : ''}`}
                  onClick={() => setSelectedChatId(chat.id)}
                >
                  <div className="aic-chat-item-icon">
                    {chat.isGroup ? <Users size={14} /> : <User size={14} />}
                  </div>
                  <div className="aic-chat-item-info">
                    <span className="aic-chat-item-name">{chatLabel(chat)}</span>
                    {chat.lastMessage && (
                      <span className="aic-chat-item-preview">
                        {chat.lastMessage.fromMe ? 'Tu: ' : ''}{chat.lastMessage.body?.slice(0, 60)}
                      </span>
                    )}
                  </div>
                  {chat.unreadCount > 0 && (
                    <span className="aic-chat-unread">{chat.unreadCount}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Analyze button */}
      {selectedSessionId && selectedChatId && (
        <div className="aic-analyze-bar">
          <button
            className="aic-btn-primary aic-btn-analyze"
            onClick={handleAnalyze}
            disabled={analyzing}
          >
            {analyzing
              ? <><Loader2 size={14} className="animate-spin" /> Analisi in corso…</>
              : <><Bot size={14} /> Analizza ultimi 30 messaggi</>}
          </button>
          {selectedChat && (
            <span className="aic-analyze-target">
              {chatLabel(selectedChat)}
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="aic-error-banner">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {analyzing && (
        <div className="aic-banner">
          <Loader2 size={13} className="animate-spin" />
          <div>
            <strong>Analisi in corso</strong> · {selectedChat ? chatLabel(selectedChat) : selectedChatId}
            <span className="aic-banner-body"> Recupero cronologia e generazione recap…</span>
          </div>
        </div>
      )}

      {!result && !analyzing && !error && selectedSessionId && (
        <div className="aic-center-state">
          <div className="aic-empty-icon"><Bot size={36} /></div>
          <h3>Seleziona una conversazione</h3>
          <p>Scegli la sessione e la chat da analizzare. L'AI produrrà un recap, il sentiment e le azioni consigliate sugli ultimi 30 messaggi.</p>
        </div>
      )}

      {result && (
        <AnalysisCard
          result={result}
          chatName={selectedChat ? chatLabel(selectedChat) : formatPhone(result.chatId)}
        />
      )}
    </div>
  );
}
