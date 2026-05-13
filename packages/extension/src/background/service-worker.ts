/**
 * MV3 service worker — routes messages between content scripts and
 * devtools panels, keyed by the inspected tab's ID.
 *
 * Three port name conventions:
 *   - `sigx-devtools:content-script`     opened by the content script;
 *                                        tabId comes from `port.sender.tab.id`.
 *   - `sigx-devtools:panel:<tabId>`      opened by the panel; tabId is
 *                                        encoded in the name because
 *                                        `port.sender` for a panel doesn't
 *                                        include the inspected tab.
 *
 * Service workers can be terminated by Chrome at any time. We don't
 * persist anything across restarts: ports re-open lazily, and the
 * `@sigx/devtools` plugin buffers events on the page side, so a
 * restart looks like a brief disconnect.
 */

interface TabState {
    contentScript?: chrome.runtime.Port;
    panel?: chrome.runtime.Port;
}

const tabs = new Map<number, TabState>();

function getOrCreateTabState(tabId: number): TabState {
    let s = tabs.get(tabId);
    if (!s) {
        s = {};
        tabs.set(tabId, s);
    }
    return s;
}

function cleanupTabIfIdle(tabId: number): void {
    const s = tabs.get(tabId);
    if (s && !s.contentScript && !s.panel) tabs.delete(tabId);
}

chrome.runtime.onConnect.addListener(port => {
    if (port.name === 'sigx-devtools:content-script') {
        const tabId = port.sender?.tab?.id;
        if (typeof tabId !== 'number') {
            // Content scripts always have a sender.tab; if not, the
            // connection is malformed — drop it.
            port.disconnect();
            return;
        }
        const state = getOrCreateTabState(tabId);
        state.contentScript = port;

        port.onMessage.addListener(msg => {
            state.panel?.postMessage(msg);
        });
        port.onDisconnect.addListener(() => {
            if (state.contentScript === port) state.contentScript = undefined;
            cleanupTabIfIdle(tabId);
        });
        return;
    }

    if (port.name.startsWith('sigx-devtools:panel:')) {
        const tabIdStr = port.name.slice('sigx-devtools:panel:'.length);
        const tabId = Number(tabIdStr);
        if (!Number.isFinite(tabId)) {
            port.disconnect();
            return;
        }
        const state = getOrCreateTabState(tabId);
        state.panel = port;

        port.onMessage.addListener(msg => {
            state.contentScript?.postMessage(msg);
        });
        port.onDisconnect.addListener(() => {
            if (state.panel === port) state.panel = undefined;
            cleanupTabIfIdle(tabId);
        });
        return;
    }

    // Unknown port name — not ours.
});

// When a tab navigates or closes, drop its state. The content script's
// onDisconnect will fire too, but doing it here avoids a window where
// the state lingers if the content script crashed silently.
chrome.tabs.onRemoved.addListener(tabId => {
    tabs.delete(tabId);
});
