/**
 * WebSocket transport tests using a fake WebSocket implementation.
 * Verifies queue/flush semantics, envelope direction filtering, and
 * reconnect behavior on close.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWebSocketTransport } from '../src/transport-websocket';

type Listener = (event: any) => void;

interface FakeSocket extends WebSocket {
    _listeners: Record<string, Listener[]>;
    _sent: string[];
    _dispatch(type: string, event?: any): void;
}

let lastSocket: FakeSocket | null = null;
const sockets: FakeSocket[] = [];

class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = FakeWebSocket.CONNECTING;
    url: string;
    _listeners: Record<string, Listener[]> = {};
    _sent: string[] = [];

    constructor(url: string) {
        this.url = url;
        lastSocket = this as unknown as FakeSocket;
        sockets.push(this as unknown as FakeSocket);
    }

    addEventListener(type: string, fn: Listener) {
        (this._listeners[type] ??= []).push(fn);
    }
    removeEventListener(type: string, fn: Listener) {
        const list = this._listeners[type];
        if (!list) return;
        const idx = list.indexOf(fn);
        if (idx >= 0) list.splice(idx, 1);
    }
    send(data: string) { this._sent.push(data); }
    close() {
        this.readyState = FakeWebSocket.CLOSED;
        this._dispatch('close');
    }
    _dispatch(type: string, event: any = {}) {
        for (const l of (this._listeners[type] ?? [])) l(event);
    }
}

// Match Transport's expected static side
const FakeWebSocketImpl = FakeWebSocket as unknown as typeof WebSocket;

beforeEach(() => {
    lastSocket = null;
    sockets.length = 0;
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('createWebSocketTransport', () => {
    it('opens a socket to the configured url and sends queued messages on open', () => {
        const t = createWebSocketTransport({
            url: 'ws://test/page',
            WebSocketImpl: FakeWebSocketImpl,
        });
        expect(lastSocket).not.toBeNull();
        expect(lastSocket!.url).toBe('ws://test/page');

        // send before the socket reports OPEN — should queue
        t.send({ t: 'hello', payload: { protocol: 1, agentVersion: 'x' } } as any);
        expect(lastSocket!._sent).toHaveLength(0);

        // simulate open — queue should flush
        lastSocket!.readyState = FakeWebSocketImpl.OPEN;
        lastSocket!._dispatch('open');
        expect(lastSocket!._sent).toHaveLength(1);
        const wire = JSON.parse(lastSocket!._sent[0]);
        expect(wire.__sigx).toBe('SIGX_DEVTOOLS');
        expect(wire.dir).toBe('to-panel');
        expect(wire.msg.t).toBe('hello');

        t.close();
    });

    it('delivers incoming to-page envelopes to listeners and ignores other directions', () => {
        const t = createWebSocketTransport({
            url: 'ws://test/page',
            WebSocketImpl: FakeWebSocketImpl,
        });
        const received: any[] = [];
        t.onMessage(msg => received.push(msg));

        // Inbound to-page (the only direction we accept)
        lastSocket!._dispatch('message', {
            data: JSON.stringify({ __sigx: 'SIGX_DEVTOOLS', dir: 'to-page', msg: { t: 'get:apps', id: 1 } }),
        });
        // Inbound to-panel — ours echoing back; should be ignored
        lastSocket!._dispatch('message', {
            data: JSON.stringify({ __sigx: 'SIGX_DEVTOOLS', dir: 'to-panel', msg: { t: 'hello' } }),
        });
        // Inbound with wrong tag — ignored
        lastSocket!._dispatch('message', {
            data: JSON.stringify({ __sigx: 'OTHER', dir: 'to-page', msg: {} }),
        });
        // Inbound non-JSON — ignored
        lastSocket!._dispatch('message', { data: 'not json' });

        expect(received).toHaveLength(1);
        expect(received[0]).toEqual({ t: 'get:apps', id: 1 });

        t.close();
    });

    it('reconnects with backoff after close', () => {
        const t = createWebSocketTransport({
            url: 'ws://test/page',
            WebSocketImpl: FakeWebSocketImpl,
            maxBackoffMs: 60_000,
        });
        expect(sockets).toHaveLength(1);

        // simulate disconnect
        lastSocket!.readyState = FakeWebSocketImpl.CLOSED;
        lastSocket!._dispatch('close');

        // First reconnect at 250ms
        vi.advanceTimersByTime(249);
        expect(sockets).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(sockets).toHaveLength(2);

        // Second disconnect — backoff doubles to 500ms
        lastSocket!.readyState = FakeWebSocketImpl.CLOSED;
        lastSocket!._dispatch('close');
        vi.advanceTimersByTime(499);
        expect(sockets).toHaveLength(2);
        vi.advanceTimersByTime(1);
        expect(sockets).toHaveLength(3);

        t.close();
    });

    it('stops reconnecting after close()', () => {
        const t = createWebSocketTransport({
            url: 'ws://test/page',
            WebSocketImpl: FakeWebSocketImpl,
        });
        t.close();
        // Even if we advance time, no new sockets should be created.
        vi.advanceTimersByTime(10_000);
        expect(sockets).toHaveLength(1);
    });

    it('drops oldest queued messages when the queue overflows', () => {
        const t = createWebSocketTransport({
            url: 'ws://test/page',
            WebSocketImpl: FakeWebSocketImpl,
            maxQueue: 3,
        });
        for (let i = 0; i < 5; i++) {
            t.send({ t: 'hello', payload: { protocol: i, agentVersion: 'x' } } as any);
        }
        lastSocket!.readyState = FakeWebSocketImpl.OPEN;
        lastSocket!._dispatch('open');
        // Only the last 3 should have been sent.
        const sent = lastSocket!._sent.map(s => JSON.parse(s).msg.payload.protocol);
        expect(sent).toEqual([2, 3, 4]);

        t.close();
    });
});
