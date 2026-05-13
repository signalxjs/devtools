/**
 * Observe a @sigx/store instance and forward its action and mutation
 * events to the panel.
 *
 * We avoid taking a hard dependency on `@sigx/store` — instead we duck
 * type the shape so any object matching it works. That keeps the
 * devtools package independent of which version of store the user has
 * installed; the trade-off is that breakage in the store API will only
 * surface at runtime.
 *
 * The store API exposes:
 *   - `actions.onDispatching[name].subscribe(fn)` (and `onDispatched`, `onFailure`)
 *   - `events.onMutated${Key}.subscribe(fn)`
 *   - `name: string`
 */

import type { PageEvent } from './protocol.js';
import { serialize } from './serialize.js';

interface Subscription {
    unsubscribe(): void;
}

interface Subscribable {
    subscribe(fn: (...args: any[]) => void): Subscription;
}

interface ObservableStore {
    name?: string;
    actions?: {
        onDispatching?: Record<string, Subscribable | undefined>;
        onDispatched?: Record<string, Subscribable | undefined>;
        onFailure?: Record<string, Subscribable | undefined>;
    } & Record<string, unknown>;
    events?: Record<string, Subscribable | undefined>;
}

export interface StoreObserverOptions {
    /** Mint a fresh action id (shared id space with the hook). */
    nextId: () => number;
    /** Emit a wire event. */
    send: (event: PageEvent) => void;
    /** Fallback name if the store doesn't carry one. */
    defaultName: string;
}

/**
 * Subscribe to every action and state mutation on `store`. Returns
 * an unsubscribe that drops all the subscriptions in one call.
 */
export function observeStore(store: ObservableStore, opts: StoreObserverOptions): () => void {
    const subs: Subscription[] = [];
    const storeName = store.name ?? opts.defaultName;

    // ----- Actions -----
    const dispatching = store.actions?.onDispatching ?? {};
    const dispatched = store.actions?.onDispatched ?? {};
    const failure = store.actions?.onFailure ?? {};

    // Per-dispatch state: actionId + start time, keyed by the args
    // object reference. The store's onDispatching/onDispatched events
    // share an `args` IArguments value for sync dispatches and a
    // result/args pair for async — see store.ts:204–225. We can't
    // assume reference equality of args across handlers, so we track
    // ordered pending dispatches per actionName and dequeue on
    // dispatched/failed.
    type Pending = { actionId: number; startedAt: number };
    const pending = new Map<string, Pending[]>();

    const actionNames = new Set<string>([
        ...Object.keys(dispatching),
        ...Object.keys(dispatched),
        ...Object.keys(failure),
    ]);

    for (const actionName of actionNames) {
        const d = dispatching[actionName];
        if (d && typeof d.subscribe === 'function') {
            subs.push(d.subscribe((...args: unknown[]) => {
                const actionId = opts.nextId();
                const startedAt = performance.now();
                let queue = pending.get(actionName);
                if (!queue) { queue = []; pending.set(actionName, queue); }
                queue.push({ actionId, startedAt });
                opts.send({
                    t: 'store:action',
                    payload: {
                        actionId,
                        storeName,
                        actionName,
                        phase: 'dispatching',
                        args: serialize(args),
                        at: Date.now(),
                    },
                });
            }));
        }
        const dd = dispatched[actionName];
        if (dd && typeof dd.subscribe === 'function') {
            // store.ts subscribes via a wrapper that fans args as
            // (result, ...args). See the subscription wrapper at
            // store.ts:184–192.
            subs.push(dd.subscribe((...args: unknown[]) => {
                const [result, ...originalArgs] = args;
                const queue = pending.get(actionName);
                const slot = queue?.shift();
                if (!slot) {
                    // Dispatched without a matching dispatching —
                    // possible if devtools attached mid-action.
                    return;
                }
                opts.send({
                    t: 'store:action',
                    payload: {
                        actionId: slot.actionId,
                        storeName,
                        actionName,
                        phase: 'dispatched',
                        args: serialize(originalArgs),
                        result: serialize(result),
                        durationMs: performance.now() - slot.startedAt,
                        at: Date.now(),
                    },
                });
            }));
        }
        const f = failure[actionName];
        if (f && typeof f.subscribe === 'function') {
            subs.push(f.subscribe((...args: unknown[]) => {
                const [reason, ...originalArgs] = args;
                const queue = pending.get(actionName);
                const slot = queue?.shift();
                if (!slot) return;
                opts.send({
                    t: 'store:action',
                    payload: {
                        actionId: slot.actionId,
                        storeName,
                        actionName,
                        phase: 'failed',
                        args: serialize(originalArgs),
                        error: serialize(reason),
                        durationMs: performance.now() - slot.startedAt,
                        at: Date.now(),
                    },
                });
            }));
        }
    }

    // ----- State mutations -----
    // The store names its events `onMutated${Key}` — strip the
    // prefix to recover the property key for the wire.
    const events = store.events ?? {};
    for (const eventName of Object.keys(events)) {
        if (!eventName.startsWith('onMutated')) continue;
        const topic = events[eventName];
        if (!topic || typeof topic.subscribe !== 'function') continue;
        const rest = eventName.slice('onMutated'.length);
        const key = rest.charAt(0).toLowerCase() + rest.slice(1);
        subs.push(topic.subscribe((value: unknown) => {
            opts.send({
                t: 'store:mutation',
                payload: {
                    storeName,
                    key,
                    value: serialize(value),
                    at: Date.now(),
                },
            });
        }));
    }

    return () => {
        for (const s of subs) {
            try { s.unsubscribe(); } catch { /* best effort */ }
        }
        subs.length = 0;
    };
}
