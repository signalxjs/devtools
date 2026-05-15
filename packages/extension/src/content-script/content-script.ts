/**
 * Content script — runs in every page's isolated world.
 *
 * Forwards messages between the page-world `@sigx/devtools` plugin
 * (which uses `window.postMessage` tagged with `__sigx: 'SIGX_DEVTOOLS'`)
 * and the service worker. The SW is the only context that the devtools
 * panel can talk to directly in MV3, so it acts as the router.
 *
 * Connection lifecycle:
 *   - **First-time**: lazy — we don't open a port until the page emits
 *     a sigx message. Avoids creating ports on every page Chrome loads.
 *   - **After disconnect**: proactive — once a page has proven it uses
 *     SigX, we keep the port alive across SW restarts so the panel can
 *     reach the page even when the page itself is momentarily idle.
 *     Without this, after Chrome killed the SW the panel was stranded
 *     until the user reloaded the page.
 *
 * Note: `window.postMessage` is one of the rare APIs that crosses the
 * page-world ↔ isolated-world boundary in Chrome MV3, so no
 * page-injected script is needed. The sigx plugin listens for our
 * envelope on its own `window`.
 */

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

let port: chrome.runtime.Port | null = null;
/** Flips true after the first successful connect. Used to gate the
 *  proactive reconnect logic — we don't want to keep a port alive on
 *  every page in the browser, only ones that have shown they use SigX. */
let everConnected = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelayMs = 250;

function clearReconnect() {
    if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

function scheduleReconnect() {
    if (reconnectTimer !== null) return;
    const delay = reconnectDelayMs;
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, 5_000);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        try {
            getPort();
        } catch {
            // Extension context invalidated (e.g. on update). Stop
            // trying — nothing we can do until the page is reloaded.
        }
    }, delay);
}

function getPort(): chrome.runtime.Port {
    if (port) return port;
    const p = chrome.runtime.connect({ name: 'sigx-devtools:content-script' });
    port = p;
    everConnected = true;
    reconnectDelayMs = 250;
    clearReconnect();

    p.onDisconnect.addListener(() => {
        if (port === p) port = null;
        // Reopen straight away if we've seen SigX on this page. The
        // panel may be sitting on a disconnected state waiting for
        // us — without this, it can't recover until the page itself
        // emits an outbound message.
        if (everConnected) scheduleReconnect();
    });

    p.onMessage.addListener((msg: unknown) => {
        // From the panel side, headed for the page. Re-wrap and post
        // into the page world.
        const envelope: WireEnvelope = { __sigx: TAG, dir: 'to-page', msg };
        window.postMessage(envelope, '*');
    });
    return p;
}

window.addEventListener('message', event => {
    // Only same-window messages — defends against another page somehow
    // posting into ours.
    if (event.source !== window) return;
    const data = event.data;
    if (!isEnvelope(data)) return;
    // Only forward page-to-panel direction. The to-page direction is
    // what we ourselves emit; we'd loop if we forwarded that.
    if (data.dir !== 'to-panel') return;
    try {
        getPort().postMessage(data.msg);
    } catch {
        // Port was disconnected between the `getPort()` cache check and
        // the post. Reset and retry once.
        port = null;
        try { getPort().postMessage(data.msg); } catch { /* give up */ }
    }
});
