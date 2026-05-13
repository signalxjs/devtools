/**
 * window.postMessage transport.
 *
 * The Chrome MV3 extension's content script can't share JS objects with
 * the page world, so we communicate via `window.postMessage` with a
 * namespace tag. Anything tagged `SIGX_DEVTOOLS` is ours; everything else
 * is ignored.
 *
 * The content script's only job is to ferry these messages between the
 * page world and `chrome.runtime`. That keeps the transport file tiny
 * and the protocol identical for in-page panels (just listen on the same
 * channel from the same window).
 */

import type { IncomingMessage, OutgoingMessage, Transport } from './transport.js';

const TAG = 'SIGX_DEVTOOLS' as const;

/** Direction tag — lets a single window host both sides without echoing. */
type Direction = 'to-panel' | 'to-page';

interface WireEnvelope {
    __sigx: typeof TAG;
    dir: Direction;
    msg: unknown;
}

function isEnvelope(value: unknown): value is WireEnvelope {
    return !!value
        && typeof value === 'object'
        && (value as WireEnvelope).__sigx === TAG;
}

export function createPostMessageTransport(target: Window = window): Transport {
    const listeners = new Set<(msg: IncomingMessage) => void>();

    const onWindowMessage = (event: MessageEvent) => {
        const data = event.data;
        if (!isEnvelope(data)) return;
        if (data.dir !== 'to-page') return;
        // The bridge guarantees `msg` is a PanelRequest; type-erased
        // because postMessage strips structural typing.
        const msg = data.msg as IncomingMessage;
        for (const l of listeners) {
            try {
                l(msg);
            } catch (err) {
                console.error('[sigx-devtools] transport listener threw:', err);
            }
        }
    };

    target.addEventListener('message', onWindowMessage);

    return {
        send(msg: OutgoingMessage) {
            const envelope: WireEnvelope = { __sigx: TAG, dir: 'to-panel', msg };
            // Posting to '*' is acceptable here: the content script filters
            // by the __sigx tag, and nothing sensitive crosses this wire
            // beyond what devtools is meant to show.
            target.postMessage(envelope, '*');
        },
        onMessage(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        close() {
            target.removeEventListener('message', onWindowMessage);
            listeners.clear();
        },
    };
}
