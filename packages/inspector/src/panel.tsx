/**
 * Standalone panel entry — same UI components as the Chrome extension,
 * different connection layer. The relay server serves this as the
 * root HTML and the browser tab is the inspector "shell".
 */

import { effect, render } from 'sigx';

// Reuse the extension's panel components verbatim. The only thing
// that differs in this build is the connection layer (WebSocket vs
// chrome.runtime port), so we drop in our own connection here and
// reuse the rest.
import { App } from '../../extension/src/panel/App';
import { setPanelContext } from '../../extension/src/panel/context';
import { createTreeStore } from '../../extension/src/panel/state/tree';
import { createReactivesStore } from '../../extension/src/panel/state/reactives';
import { createActivityStore } from '../../extension/src/panel/state/activity';
import { createConnection } from './connection';

const connection = createConnection();
const tree = createTreeStore();
const reactives = createReactivesStore();
const activity = createActivityStore();

connection.onEvent(event => {
    tree.apply(event);
    reactives.apply(event);
    activity.apply(event);
});

let lastStatus: string | null = null;
effect(() => {
    const status = connection.status.value;
    if (status === 'connected' && lastStatus !== 'connected') {
        tree.clear();
        reactives.clear();
        activity.clear();
        connection
            .request<unknown[]>({ t: 'get:tree', payload: { appId: 1 } })
            .then(nodes => {
                if (!Array.isArray(nodes)) return;
                for (const node of nodes) {
                    tree.apply({ t: 'component:mounted', payload: node as any });
                }
            })
            .catch(() => { /* page side may not be there yet */ });
    }
    lastStatus = status;
});

setPanelContext({ connection, tree, reactives, activity });

render(<App />, document.getElementById('root')!);
