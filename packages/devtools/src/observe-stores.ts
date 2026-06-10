/**
 * Discover and observe every @sigx/store instance through the core
 * inspection registry (`@sigx/runtime-core/inspect`) and forward
 * store activity to the panel.
 *
 * Stores built on core 0.5.0 register all their topics with meaningful
 * namespaces, so devtools no longer needs a per-store handle:
 *
 *   - `${storeId}.state`   — name = state key, payload `{ value, prev }`
 *   - `${storeId}.actions` — names `${action}.onDispatching` (payload:
 *     the args array), `${action}.onDispatched` (payload
 *     `{ result, args }`), `${action}.onFailure` (payload
 *     `{ error, args }`)
 *   - `${storeId}.events`  — custom events; name = event key, payload =
 *     whatever the user published
 *
 * `subscribeTopics` observes topics that already exist AND topics
 * created later, so stores instantiated after the plugin installs are
 * picked up automatically. Subscribing activates the stores' refCount
 * watchers — state observation is pay-when-observed by design.
 *
 * Wildcard patterns match over `${namespace}.${name}` with `*` → `.*`,
 * so `*.state.*` also matches an *action* topic like
 * `todos#1.actions.state.onDispatching` (an action named `state`).
 * Every handler therefore re-checks `meta.namespace`'s suffix before
 * emitting — the pattern is a coarse filter, the namespace suffix is
 * the source of truth.
 */

import { subscribeTopics } from '@sigx/runtime-core/inspect';
import type { PageEvent } from './protocol.js';
import { serialize } from './serialize.js';

export interface StoreDiscoveryOptions {
    /** Mint a fresh action id (shared id space with the hook). */
    nextId: () => number;
    /** Emit a wire event. */
    send: (event: PageEvent) => void;
}

/** A dispatch we've seen `onDispatching` for but not yet a settle phase. */
interface PendingDispatch {
    /** The args array instance published on `onDispatching`. */
    args: unknown;
    actionId: number;
    startedAt: number;
}

const PHASE_SUFFIXES = [
    ['.onDispatching', 'dispatching'],
    ['.onDispatched', 'dispatched'],
    ['.onFailure', 'failed'],
] as const;

/** `'todos#1.state'` + `'.state'` → `'todos#1'`; null when no match. */
function storeIdFrom(namespace: string, suffix: string): string | null {
    if (!namespace.endsWith(suffix)) return null;
    const id = namespace.slice(0, -suffix.length);
    return id.length > 0 ? id : null;
}

/**
 * Subscribe to all store topics in the inspection registry — current
 * and future. Returns an unsubscribe that tears everything down.
 */
export function observeStores(opts: StoreDiscoveryOptions): () => void {
    // In-flight dispatches, keyed per store + action. The NUL
    // separator keeps the two parts unambiguous regardless of what
    // characters a store id or action name contains.
    const pending = new Map<string, PendingDispatch[]>();

    // ----- State mutations: `${storeId}.state`, name = key -----
    const stateSub = subscribeTopics('*.state.*', (data, meta) => {
        const storeId = storeIdFrom(meta.namespace, '.state');
        if (storeId === null) return;
        // Payload is `{ value, prev }` — the wire carries the new value.
        const value = (data as { value?: unknown } | null | undefined)?.value;
        opts.send({
            t: 'store:mutation',
            payload: {
                storeName: storeId,
                key: meta.name,
                value: serialize(value),
                at: Date.now(),
            },
        });
    });

    // ----- Actions: `${storeId}.actions`, name = `${action}.${phase}` -----
    const actionSub = subscribeTopics('*.actions.*', (data, meta) => {
        const storeId = storeIdFrom(meta.namespace, '.actions');
        if (storeId === null) return;

        const match = PHASE_SUFFIXES.find(([suffix]) => meta.name.endsWith(suffix));
        if (!match) return;
        const [suffix, phase] = match;
        const actionName = meta.name.slice(0, -suffix.length);
        if (actionName.length === 0) return;
        const queueKey = `${storeId}\u0000${actionName}`;

        if (phase === 'dispatching') {
            // Payload is the args array itself. The store publishes the
            // SAME array instance to onDispatched/onFailure (as
            // `payload.args`), which is what lets us correlate phases
            // even when async dispatches settle out of order.
            const actionId = opts.nextId();
            let queue = pending.get(queueKey);
            if (!queue) { queue = []; pending.set(queueKey, queue); }
            queue.push({ args: data, actionId, startedAt: performance.now() });
            opts.send({
                t: 'store:action',
                payload: {
                    actionId,
                    storeName: storeId,
                    actionName,
                    phase: 'dispatching',
                    args: serialize(data),
                    at: Date.now(),
                },
            });
            return;
        }

        // Settle phases: payload `{ result, args }` or `{ error, args }`.
        const payload = (data ?? {}) as { result?: unknown; error?: unknown; args?: unknown };
        const queue = pending.get(queueKey);
        if (!queue || queue.length === 0) {
            // Settled without a matching dispatching — possible if
            // devtools attached mid-action. Skip silently.
            return;
        }
        // Correlate by args array reference; fall back to FIFO when the
        // reference isn't found (defensive — shouldn't happen with the
        // real store, which republishes the same instance).
        let index = queue.findIndex(p => p.args === payload.args);
        if (index === -1) index = 0;
        const [slot] = queue.splice(index, 1);
        if (queue.length === 0) pending.delete(queueKey);

        opts.send({
            t: 'store:action',
            payload: {
                actionId: slot.actionId,
                storeName: storeId,
                actionName,
                phase,
                args: serialize(payload.args),
                ...(phase === 'dispatched'
                    ? { result: serialize(payload.result) }
                    : { error: serialize(payload.error) }),
                durationMs: performance.now() - slot.startedAt,
                at: Date.now(),
            },
        });
    });

    // ----- Custom events: `${storeId}.events`, name = event key -----
    const eventSub = subscribeTopics('*.events.*', (data, meta) => {
        const storeId = storeIdFrom(meta.namespace, '.events');
        if (storeId === null) return;
        opts.send({
            t: 'store:event',
            payload: {
                storeName: storeId,
                event: meta.name,
                data: serialize(data),
                at: Date.now(),
            },
        });
    });

    return () => {
        for (const sub of [stateSub, actionSub, eventSub]) {
            try { sub.unsubscribe(); } catch { /* best effort */ }
        }
        pending.clear();
    };
}
