/**
 * Panel-side connection to the inspected page.
 *
 * Opens a long-lived port to the service worker, keyed by the inspected
 * tab's id. The SW routes messages to/from the content script in that
 * tab, which in turn bridges to the page-world @sigx/devtools plugin.
 *
 * The port may disconnect — typically when the service worker restarts.
 * We handle that transparently: a single `reconnect()` re-opens and
 * resends a `get:apps` probe so the panel state catches up.
 */

import { signal } from '@sigx/reactivity';
import type {
    PageEvent,
    PanelRequestInput,
    PanelResponse,
} from '@sigx/devtools';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

/** Anything the page can send us back. */
type Inbound = PageEvent | PanelResponse;

export interface Connection {
    /** Object signal — read via `.value`, write via assignment. */
    status: { value: ConnectionStatus };
    /** Send a request and resolve with the response payload. */
    request<T = unknown>(req: PanelRequestInput): Promise<T>;
    /** Subscribe to push-style events from the page. */
    onEvent(listener: (event: PageEvent) => void): () => void;
    /** Force a reconnect (used after `disconnected` state). */
    reconnect(): void;
}

export function createConnection(tabId: number): Connection {
    // Wrap in an object signal so the union type doesn't widen — a
    // bare `signal<ConnectionStatus>(...)` returns PrimitiveSignal
    // whose `.value` widens literal unions to `string` via Widen<T>.
    const status = signal({ value: 'connecting' as ConnectionStatus });

    let port: chrome.runtime.Port | null = null;
    let nextRequestId = 1;
    const pending = new Map<number, {
        resolve: (value: unknown) => void;
        reject: (err: Error) => void;
    }>();
    const eventListeners = new Set<(event: PageEvent) => void>();

    function open() {
        status.value = 'connecting';
        port = chrome.runtime.connect({ name: `sigx-devtools:panel:${tabId}` });

        port.onMessage.addListener((msg: Inbound) => {
            // Heuristic: a `response`/`error` carries a numeric `id`
            // matching an outstanding request; anything else is a
            // push event from the page.
            if ((msg as PanelResponse).t === 'response' || (msg as PanelResponse).t === 'error') {
                const r = msg as PanelResponse;
                const slot = pending.get(r.id);
                if (!slot) return;
                pending.delete(r.id);
                if (r.t === 'response') slot.resolve(r.payload);
                else slot.reject(new Error(r.message));
                return;
            }
            // Push event. The presence of a `hello` event also tells
            // us the page side is reachable.
            const event = msg as PageEvent;
            if (event.t === 'hello' && status.value !== 'connected') {
                status.value = 'connected';
            }
            for (const l of eventListeners) {
                try { l(event); } catch (err) {
                    console.error('[sigx-panel] event listener threw:', err);
                }
            }
        });

        port.onDisconnect.addListener(() => {
            port = null;
            status.value = 'disconnected';
            // Reject any outstanding requests so the panel doesn't hang.
            for (const [id, slot] of pending) {
                slot.reject(new Error('disconnected'));
                pending.delete(id);
            }
        });
    }

    open();

    return {
        status,
        request<T>(req: PanelRequestInput): Promise<T> {
            return new Promise<T>((resolve, reject) => {
                if (!port) {
                    reject(new Error('not connected'));
                    return;
                }
                const id = nextRequestId++;
                pending.set(id, {
                    resolve: v => resolve(v as T),
                    reject,
                });
                try {
                    port.postMessage({ ...req, id });
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
            if (port) return;
            open();
        },
    };
}
