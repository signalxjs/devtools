/**
 * Transport abstraction. The plugin doesn't know whether it's talking to a
 * Chrome extension content script, a WebSocket bridge for the Lynx native
 * runtime, or a BroadcastChannel to an in-page overlay. The transport just
 * pumps JSON-serializable objects in and out.
 */

import type { PageEvent, PanelRequest, PanelResponse } from './protocol.js';

export type IncomingMessage = PanelRequest;
export type OutgoingMessage = PageEvent | PanelResponse;

export interface Transport {
    /** Send a message to the panel side. */
    send(msg: OutgoingMessage): void;
    /** Subscribe to messages from the panel. Returns an unsubscribe. */
    onMessage(listener: (msg: IncomingMessage) => void): () => void;
    /** Best-effort teardown. */
    close(): void;
}
