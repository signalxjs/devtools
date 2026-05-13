/**
 * Activity timeline — append-only ring buffer of recent events.
 *
 * Captures store actions, store mutations, and router navigations as
 * they happen. The panel renders this as a chronological feed; the
 * buffer is capped so a long-running session can't grow without bound.
 */

import { signal } from '@sigx/reactivity';
import type {
    PageEvent,
    StoreActionEvent,
    StoreMutationEvent,
    RouterNavEvent,
} from '@sigx/devtools';

export type ActivityEntry =
    | { kind: 'action';   key: string; at: number; data: StoreActionEvent }
    | { kind: 'mutation'; key: string; at: number; data: StoreMutationEvent }
    | { kind: 'nav';      key: string; at: number; data: RouterNavEvent };

const MAX_ENTRIES = 200;

export interface ActivityStore {
    entries: { value: ActivityEntry[] };
    apply(event: PageEvent): void;
    clear(): void;
}

export function createActivityStore(): ActivityStore {
    const entries = signal<{ value: ActivityEntry[] }>({ value: [] });

    function push(entry: ActivityEntry) {
        const next = entries.value.length >= MAX_ENTRIES
            ? entries.value.slice(1)
            : entries.value.slice();
        next.push(entry);
        entries.value = next;
    }

    let nextLocalKey = 1;

    return {
        entries,
        apply(event) {
            switch (event.t) {
                case 'store:action':
                    push({
                        kind: 'action',
                        // Key uses actionId + phase so dispatching/dispatched
                        // entries remain distinct rows.
                        key: `a${event.payload.actionId}-${event.payload.phase}`,
                        at: event.payload.at,
                        data: event.payload,
                    });
                    break;
                case 'store:mutation':
                    push({
                        kind: 'mutation',
                        key: `m${nextLocalKey++}`,
                        at: event.payload.at,
                        data: event.payload,
                    });
                    break;
                case 'router:nav':
                    push({
                        kind: 'nav',
                        key: `n${nextLocalKey++}`,
                        at: event.payload.at,
                        data: event.payload,
                    });
                    break;
                default:
                    break;
            }
        },
        clear() {
            entries.value = [];
        },
    };
}
