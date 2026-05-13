/**
 * Panel entry. Boots the sigx app into #root.
 *
 * The panel script runs inside the devtools panel's own iframe.
 * `chrome.devtools.inspectedWindow.tabId` is the id of the tab being
 * inspected — we pass that to the connection so the service worker
 * knows which content-script port to route to.
 */

import { effect, render } from 'sigx';
import { App } from './App';
import { createConnection } from './state/connection';
import { createTreeStore } from './state/tree';
import { createReactivesStore } from './state/reactives';
import { createActivityStore } from './state/activity';
import { setPanelContext } from './context';

const tabId = chrome.devtools.inspectedWindow.tabId;
const connection = createConnection(tabId);
const tree = createTreeStore();
const reactives = createReactivesStore();
const activity = createActivityStore();

// Pipe push events into every store. Each store only handles the
// event types it cares about; the others are no-ops.
connection.onEvent(event => {
    tree.apply(event);
    reactives.apply(event);
    activity.apply(event);
});

// Whenever the connection (re)opens, ask for the current tree so we
// don't miss the pre-attach state. The page side also buffers events
// but `get:tree` gives us a complete snapshot in one round trip.
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
            .catch(() => {
                // Page may not have a sigx app yet — fine, we'll see
                // app:init when one mounts.
            });
    }
    lastStatus = status;
});

setPanelContext({ connection, tree, reactives, activity });

render(<App />, document.getElementById('root')!);
