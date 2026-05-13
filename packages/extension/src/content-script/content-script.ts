/**
 * Content script — runs in every page's isolated world.
 *
 * Forwards messages between the page-world `@sigx/devtools` plugin
 * (which uses `window.postMessage` tagged with `__sigx: 'SIGX_DEVTOOLS'`)
 * and the service worker. The SW is the only context that the devtools
 * panel can talk to directly in MV3, so it acts as the router.
 *
 * Connection lifecycle:
 *   - Lazy: we don't open a port until the page actually emits a sigx
 *     message. Avoids creating ports on every page Chrome ever loads.
 *   - On port disconnect (e.g. service worker restarted), we re-open
 *     transparently on the next outbound message.
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

function getPort(): chrome.runtime.Port {
    if (port) return port;
    port = chrome.runtime.connect({ name: 'sigx-devtools:content-script' });
    port.onDisconnect.addListener(() => {
        port = null;
    });
    port.onMessage.addListener((msg: unknown) => {
        // From the panel side, headed for the page. Re-wrap and post
        // into the page world.
        const envelope: WireEnvelope = { __sigx: TAG, dir: 'to-page', msg };
        window.postMessage(envelope, '*');
    });
    return port;
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
