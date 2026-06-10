/**
 * @sigx/devtools — DevTools client plugin for SignalX.
 *
 * Install with `app.use(devtools())`. By default it talks to an in-window
 * postMessage bridge (so a Chrome extension content script can pick up the
 * events); pass a custom `Transport` for WebSocket or BroadcastChannel.
 */

export { devtools } from './plugin.js';
export type { DevtoolsOptions } from './plugin.js';

export { createPostMessageTransport } from './transport-postmessage.js';
export { createWebSocketTransport } from './transport-websocket.js';
export type { WebSocketTransportOptions } from './transport-websocket.js';
export type { Transport } from './transport.js';

export type {
    PageEvent,
    PanelRequest,
    PanelRequestInput,
    PanelResponse,
    ComponentNode,
    ReactivePrimitive,
    ReactivePrimitiveKind,
    StoreActionEvent,
    StoreMutationEvent,
    StoreCustomEvent,
    RouterNavEvent,
    SerializedValue,
    AppId,
    ComponentId,
    ValueRef
} from './protocol.js';
export { PROTOCOL_VERSION } from './protocol.js';
