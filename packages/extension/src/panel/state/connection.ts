/**
 * Panel-side connection to the inspected page.
 *
 * Opens a long-lived port to the service worker, keyed by the inspected
 * tab's id. The SW routes messages to/from the content script in that
 * tab, which in turn bridges to the page-world @sigx/devtools plugin.
 *
 * MV3 service workers are killed after ~30s idle, dragging the port
 * down with them. We defend in two places:
 *
 *   1. Any inbound message — not just `hello` — flips us to `connected`.
 *      The page-side plugin emits `hello` exactly once at install, so
 *      a panel that attached after the page bootstrapped (or after a
 *      reconnect) never saw it. A simple `get:apps` probe round-trip
 *      is now what confirms liveness.
 *   2. The content script auto-reconnects to the SW on disconnect, so
 *      after a SW death the route from panel → page is restored
 *      without needing the page to emit anything on its own.
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
    /** Force a reconnect (used after `disconnected` state, or to retry
     *  a stuck `connecting`). */
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

        const p = chrome.runtime.connect({ name: `sigx-devtools:panel:${tabId}` });
        port = p;

        p.onMessage.addListener((msg: Inbound) => {
            // Any inbound message proves the wire is alive end-to-end
            // (SW → content script → page → and back). The original
            // code only flipped on `hello`, but the plugin emits hello
            // exactly once at install — so a panel that reconnected
            // after the page bootstrapped never saw it.
            if (status.value !== 'connected') status.value = 'connected';

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
            for (const l of eventListeners) {
                try { l(event); } catch (err) {
                    console.error('[sigx-panel] event listener threw:', err);
                }
            }
        });

        p.onDisconnect.addListener(() => {
            if (port !== p) return;
            port = null;
            status.value = 'disconnected';
            for (const [id, slot] of pending) slot.reject(new Error('disconnected'));
            pending.clear();
        });

        // Probe the page so we can confirm liveness without waiting for
        // the page-side plugin to emit something on its own. The page
        // answers `get:apps` regardless of whether any app has mounted
        // yet — an empty list is still a valid response.
        const probeId = nextRequestId++;
        pending.set(probeId, {
            resolve: () => { pending.delete(probeId); },
            reject:  () => { pending.delete(probeId); },
        });
        try {
            p.postMessage({ t: 'get:apps', id: probeId });
        } catch {
            // Port wasn't usable — onDisconnect will fire to reject any
            // remaining pending entries, but drop ours now so we don't
            // leak the slot if disconnect somehow never arrives.
            pending.delete(probeId);
        }
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
            // Allow forcing a reconnect from any state. If a stale port
            // is still around, tear it down first so the new open()
            // sees `port === null`.
            if (port) {
                try { port.disconnect(); } catch { /* noop */ }
                port = null;
            }
            open();
        },
    };
}
