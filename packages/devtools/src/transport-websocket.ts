/**
 * WebSocket transport — page-side.
 *
 * The Lynx native runtime (and any other non-browser host) can't speak
 * `window.postMessage`, but it can speak WebSocket. Pages opt into this
 * transport by passing it to `devtools({ transport: createWebSocketTransport(...) })`.
 *
 * Behavior:
 *   - Connects to a configurable `ws://…` URL (typically a localhost
 *     relay run by the developer's machine).
 *   - If the socket isn't open when `send()` is called, messages queue
 *     up to `maxQueue` entries and flush on (re)connect. Older messages
 *     are dropped on overflow — devtools state can re-sync from
 *     get:tree / get:reactives after reconnect.
 *   - Reconnects automatically on disconnect with exponential backoff
 *     capped at `maxBackoffMs`. This matters for mobile dev where the
 *     relay may briefly disappear (laptop sleep, IDE restart).
 *   - Outgoing messages are wrapped in the same `__sigx: SIGX_DEVTOOLS`
 *     envelope so the relay can validate them. Incoming messages are
 *     unwrapped before delivery to listeners.
 */

import type { IncomingMessage, OutgoingMessage, Transport } from './transport.js';

const TAG = 'SIGX_DEVTOOLS' as const;

interface WireEnvelope {
    __sigx: typeof TAG;
    dir: 'to-panel' | 'to-page';
    msg: unknown;
}

function isEnvelope(value: unknown): value is WireEnvelope {
    return !!value
        && typeof value === 'object'
        && (value as WireEnvelope).__sigx === TAG;
}

export interface WebSocketTransportOptions {
    /**
     * Full ws:// or wss:// URL to connect to. Defaults to
     * `ws://localhost:8098/page` — the path the bundled inspector
     * listens on for page-side clients.
     */
    url?: string;
    /**
     * Max queued outgoing messages while disconnected. When exceeded,
     * the oldest entries are dropped. Default 1000.
     */
    maxQueue?: number;
    /**
     * Max reconnect backoff in milliseconds. Default 30 seconds.
     */
    maxBackoffMs?: number;
    /**
     * Override the WebSocket constructor — useful for tests. Defaults
     * to the global `WebSocket`.
     */
    WebSocketImpl?: typeof WebSocket;
}

export function createWebSocketTransport(options: WebSocketTransportOptions = {}): Transport {
    const url = options.url ?? 'ws://localhost:8098/page';
    const maxQueue = options.maxQueue ?? 1000;
    const maxBackoffMs = options.maxBackoffMs ?? 30_000;
    const WebSocketCtor = options.WebSocketImpl
        ?? (typeof WebSocket !== 'undefined' ? WebSocket : null);

    if (!WebSocketCtor) {
        // No WebSocket available in this environment. Return a stub
        // transport that drops everything — same shape as a no-op
        // mode. Callers should detect this via the absence of any
        // hello-event echo and surface the issue.
        return {
            send() {},
            onMessage() { return () => {}; },
            close() {},
        };
    }

    const listeners = new Set<(msg: IncomingMessage) => void>();
    const outgoing: OutgoingMessage[] = [];
    let socket: WebSocket | null = null;
    let closed = false;
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function flushQueue() {
        if (!socket || socket.readyState !== WebSocketCtor!.OPEN) return;
        while (outgoing.length > 0) {
            const msg = outgoing.shift()!;
            try {
                socket.send(JSON.stringify({ __sigx: TAG, dir: 'to-panel', msg }));
            } catch (err) {
                // Re-queue the message and bail; we'll try again on
                // reconnect. Pushing to the front preserves order.
                outgoing.unshift(msg);
                return;
            }
        }
    }

    function scheduleReconnect() {
        if (closed) return;
        if (reconnectTimer !== null) return;
        // Exponential backoff: 250ms, 500ms, 1s, 2s, … capped.
        const delay = Math.min(250 * 2 ** reconnectAttempt, maxBackoffMs);
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
        }, delay);
    }

    function connect() {
        if (closed) return;
        try {
            socket = new WebSocketCtor!(url);
        } catch (err) {
            scheduleReconnect();
            return;
        }
        socket.addEventListener('open', () => {
            reconnectAttempt = 0;
            flushQueue();
        });
        socket.addEventListener('message', event => {
            let parsed: unknown;
            try {
                parsed = typeof event.data === 'string' ? JSON.parse(event.data) : null;
            } catch {
                return;
            }
            if (!isEnvelope(parsed)) return;
            if (parsed.dir !== 'to-page') return;
            const msg = parsed.msg as IncomingMessage;
            for (const l of listeners) {
                try { l(msg); } catch (err) {
                    console.error('[sigx-devtools] ws listener threw:', err);
                }
            }
        });
        socket.addEventListener('close', () => {
            socket = null;
            scheduleReconnect();
        });
        socket.addEventListener('error', () => {
            // The 'close' event fires next; let it handle reconnect.
        });
    }

    connect();

    return {
        send(msg: OutgoingMessage) {
            if (socket && socket.readyState === WebSocketCtor!.OPEN) {
                try {
                    socket.send(JSON.stringify({ __sigx: TAG, dir: 'to-panel', msg }));
                    return;
                } catch {
                    // Fall through to queueing.
                }
            }
            outgoing.push(msg);
            if (outgoing.length > maxQueue) {
                // Drop oldest. The panel can re-sync via get:tree on
                // reconnect, so losing a few intermediate events is OK.
                outgoing.splice(0, outgoing.length - maxQueue);
            }
        },
        onMessage(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        close() {
            closed = true;
            if (reconnectTimer !== null) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            try { socket?.close(); } catch { /* ignore */ }
            socket = null;
            listeners.clear();
            outgoing.length = 0;
        },
    };
}
