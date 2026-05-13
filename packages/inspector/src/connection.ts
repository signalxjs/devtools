/**
 * Panel-side WebSocket connection for the inspector.
 *
 * Mirrors the shape of the extension's `connection.ts` (request/response
 * matching, signal-backed status, push events) so the shared panel
 * components can use it without modification.
 *
 * Connects to `/panel` on the same origin the panel HTML was served
 * from — that's the inspector relay's panel endpoint.
 */

import { signal } from '@sigx/reactivity';
import type {
    PageEvent,
    PanelRequestInput,
    PanelResponse,
} from '@sigx/devtools';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

type Inbound = PageEvent | PanelResponse;

export interface Connection {
    status: { value: ConnectionStatus };
    request<T = unknown>(req: PanelRequestInput): Promise<T>;
    onEvent(listener: (event: PageEvent) => void): () => void;
    reconnect(): void;
}

const TAG = 'SIGX_DEVTOOLS' as const;

interface Envelope {
    __sigx: typeof TAG;
    dir: 'to-panel' | 'to-page';
    msg: unknown;
}

export function createConnection(): Connection {
    const status = signal({ value: 'connecting' as ConnectionStatus });

    let socket: WebSocket | null = null;
    let nextRequestId = 1;
    const pending = new Map<number, {
        resolve: (value: unknown) => void;
        reject: (err: Error) => void;
    }>();
    const eventListeners = new Set<(event: PageEvent) => void>();
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let closed = false;

    function url(): string {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        return `${proto}://${location.host}/panel`;
    }

    function dispatch(msg: Inbound) {
        // Response vs push event — same shape used by the extension.
        if ((msg as PanelResponse).t === 'response' || (msg as PanelResponse).t === 'error') {
            const r = msg as PanelResponse;
            const slot = pending.get(r.id);
            if (!slot) return;
            pending.delete(r.id);
            if (r.t === 'response') slot.resolve(r.payload);
            else slot.reject(new Error(r.message));
            return;
        }
        const event = msg as PageEvent;
        if (event.t === 'hello' && status.value !== 'connected') {
            status.value = 'connected';
        }
        for (const l of eventListeners) {
            try { l(event); } catch (err) {
                console.error('[sigx-inspector] event listener threw:', err);
            }
        }
    }

    function scheduleReconnect() {
        if (closed) return;
        if (reconnectTimer !== null) return;
        const delay = Math.min(250 * 2 ** reconnectAttempt, 30_000);
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            open();
        }, delay);
    }

    function open() {
        if (closed) return;
        status.value = 'connecting';
        socket = new WebSocket(url());
        socket.addEventListener('open', () => {
            reconnectAttempt = 0;
            // Status flips to 'connected' on the first hello from the
            // page side — until then we may be connected to the relay
            // but the page hasn't attached yet.
        });
        socket.addEventListener('message', event => {
            let parsed: unknown;
            try { parsed = typeof event.data === 'string' ? JSON.parse(event.data) : null; } catch { return; }
            if (!parsed || (parsed as Envelope).__sigx !== TAG) return;
            const env = parsed as Envelope;
            // Page → panel
            if (env.dir !== 'to-panel') return;
            dispatch(env.msg as Inbound);
        });
        socket.addEventListener('close', () => {
            socket = null;
            status.value = 'disconnected';
            for (const [id, slot] of pending) {
                slot.reject(new Error('disconnected'));
                pending.delete(id);
            }
            scheduleReconnect();
        });
        socket.addEventListener('error', () => { /* close handles reconnect */ });
    }

    open();

    return {
        status,
        request<T>(req: PanelRequestInput): Promise<T> {
            return new Promise<T>((resolve, reject) => {
                if (!socket || socket.readyState !== WebSocket.OPEN) {
                    reject(new Error('not connected'));
                    return;
                }
                const id = nextRequestId++;
                pending.set(id, {
                    resolve: v => resolve(v as T),
                    reject,
                });
                try {
                    socket.send(JSON.stringify({
                        __sigx: TAG,
                        dir: 'to-page',
                        msg: { ...req, id },
                    } satisfies Envelope));
                } catch (err) {
                    pending.delete(id);
                    reject(err as Error);
                }
            });
        },
        onEvent(listener) {
            eventListeners.add(listener);
            return () => { eventListeners.delete(listener); };
        },
        reconnect() {
            if (socket) return;
            open();
        },
    };
}
