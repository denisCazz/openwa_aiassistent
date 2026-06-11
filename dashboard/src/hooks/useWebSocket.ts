import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';

interface SessionStatusEvent {
  sessionId: string;
  status: string;
  timestamp: string;
}

interface QRCodeEvent {
  sessionId: string;
  qrCode: string;
  timestamp: string;
}

interface MessageEvent {
  sessionId: string;
  message: Record<string, unknown>;
  timestamp: string;
}

interface WebSocketEvents {
  onSessionStatus?: (event: SessionStatusEvent) => void;
  onQRCode?: (event: QRCodeEvent) => void;
  onMessage?: (event: MessageEvent) => void;
}

interface WSEventMessage {
  type: 'event';
  payload: {
    event: string;
    sessionId: string;
    data: Record<string, unknown>;
  };
  timestamp: string;
}

// Use current origin for WebSocket (goes through nginx proxy in Docker)
const SOCKET_URL = import.meta.env.VITE_WS_URL || window.location.origin;

export function useWebSocket(events: WebSocketEvents = {}) {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const eventsRef = useRef(events);

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  const connect = useCallback(() => {
    if (socketRef.current?.connected) return;

    const apiKey = sessionStorage.getItem('openwa_api_key');
    if (!apiKey) {
      console.warn('[WebSocket] No API key found, skipping connection');
      return;
    }

    socketRef.current = io(`${SOCKET_URL}/events`, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      auth: { apiKey },
      extraHeaders: { 'X-API-Key': apiKey },
      query: { apiKey },
    });

    const socket = socketRef.current;

    socket.on('connect', () => {
      console.log('[WebSocket] Connected');
      setIsConnected(true);
      socket.emit('message', {
        type: 'subscribe',
        sessionId: '*',
        events: ['session.status', 'session.qr', 'message.received'],
      });
    });

    socket.on('disconnect', () => {
      console.log('[WebSocket] Disconnected');
      setIsConnected(false);
    });

    socket.on('connect_error', error => {
      console.warn('[WebSocket] Connection error:', error.message);
    });

    socket.on('message', (message: WSEventMessage) => {
      if (message.type !== 'event') return;

      const { event, sessionId, data } = message.payload;
      const timestamp = message.timestamp;

      if (event === 'session.status' && eventsRef.current.onSessionStatus) {
        eventsRef.current.onSessionStatus({
          sessionId,
          status: String(data.status ?? ''),
          timestamp,
        });
      }

      if (event === 'session.qr' && eventsRef.current.onQRCode && typeof data.qrCode === 'string') {
        eventsRef.current.onQRCode({
          sessionId,
          qrCode: data.qrCode,
          timestamp,
        });
      }

      if (event === 'message.received' && eventsRef.current.onMessage) {
        eventsRef.current.onMessage({
          sessionId,
          message: data,
          timestamp,
        });
      }
    });
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [connect]);

  return { isConnected };
}
