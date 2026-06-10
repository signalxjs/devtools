/**
 * DevTools plugin for SignalX.
 *
 * Usage:
 * ```ts
 * import { defineApp } from '@sigx/runtime-core';
 * import { devtools } from '@sigx/devtools';
 *
 * defineApp(<App />).use(devtools()).mount('#app');
 * ```
 *
 * Listens on the shared global devtools hook (installed in
 * `@sigx/reactivity`) and ferries events out over a transport. Two
 * event families are bridged:
 *
 *   - **Component lifecycle** (from `@sigx/runtime-core`) — app:init,
 *     component:mounted/updated/unmounted, component:error.
 *   - **Reactivity primitives** (from `@sigx/reactivity`) — signal,
 *     computed, and effect creation / updates / disposal.
 *
 * Component instance ids come straight from the event's `instanceId`
 * field — they're minted by `runtime-core` via `hook.nextId()`, the
 * same call that mints reactivity ids. That shared id space is what
 * lets the panel join "this component" ↔ "the signals it owns"
 * without ambiguous bookkeeping.
 *
 * Renderer-agnostic by design — only the transport changes between
 * DOM, Lynx, and terminal.
 */

import type { Plugin, AppContext } from '@sigx/runtime-core';
import {
    ensureDevtoolsHook,
    type ComponentInstance,
    type DevtoolsEvent,
} from '@sigx/runtime-core/internals';
import {
    getReactiveById,
    type DevtoolsEventBase,
    type ReactivityDevtoolsEvent,
} from '@sigx/reactivity/internals';
import { toRaw } from '@sigx/reactivity';

import type {
    AppId,
    ComponentId,
    ComponentNode,
    PageEvent,
    PanelRequest,
    ReactivePrimitive,
    ReactivePrimitiveKind,
} from './protocol.js';
import { PROTOCOL_VERSION } from './protocol.js';
import { ValueRefTable } from './value-refs.js';
import { serialize } from './serialize.js';
import type { Transport } from './transport.js';
import { createPostMessageTransport } from './transport-postmessage.js';
import { observeStores } from './observe-stores.js';
import { observeRouter } from './observe-router.js';

const AGENT_VERSION = '0.0.3';

/**
 * Anything that quacks like a @sigx/router result.
 */
interface DevtoolsObservableRouter {
    readonly currentRoute: { path: string; params?: unknown; query?: unknown };
}

export interface DevtoolsOptions {
    /**
     * Custom transport. Defaults to `createPostMessageTransport()` when
     * `window` is available (browser); otherwise the plugin is a no-op
     * so SSR doesn't crash on it.
     */
    transport?: Transport;
    /**
     * App name shown in the panel. Defaults to `'sigx-app'`.
     */
    appName?: string;
    /**
     * Whether to discover and observe @sigx/store instances through
     * the core inspection registry (`@sigx/runtime-core/inspect`).
     * Stores register their state/action/event topics there, so
     * existing AND future stores are picked up automatically — no
     * per-store wiring. Note that observing activates the stores'
     * refCount state watchers (pay-when-observed). Default `true`.
     */
    includeStores?: boolean;
    /**
     * Router instance to observe for navigation events. Optional.
     */
    router?: DevtoolsObservableRouter;
    /**
     * Whether to subscribe to reactivity (signal/effect/computed)
     * events at all. Set `false` for a component-tree-and-timeline-
     * only view, or when the firehose of reactive updates is more
     * noise than signal. Default `true`.
     */
    includeReactivity?: boolean;
    /**
     * Coalesce `reactive:updated` events per-id within this
     * millisecond window. A signal updating 60+ times/sec (animation
     * frame, mouse position) collapses to one wire message per
     * window. The collapsed message carries the latest counter and
     * timestamp. Default 16ms (~one frame). Set 0 to disable.
     */
    throttleMs?: number;
}

/**
 * Type guard: is `event` an event we care about from any layer?
 * Lets us route based on `type` without static knowledge of every
 * possible variant.
 */
function isLayered(event: DevtoolsEventBase): event is DevtoolsEvent | ReactivityDevtoolsEvent {
    return typeof event.type === 'string';
}

export function devtools(options: DevtoolsOptions = {}): Plugin<void> {
    return {
        name: 'sigx-devtools',
        install(app) {
            const transport = options.transport
                ?? (typeof window !== 'undefined' ? createPostMessageTransport() : null);
            if (!transport) return;

            const hook = ensureDevtoolsHook();
            const refs = new ValueRefTable();

            // -----------------------------------------------------------------
            // Component registry
            // -----------------------------------------------------------------
            // `componentIds` is a back-reference (instance → id) so we can
            // recover an id from `component:unmounted` and so on without
            // needing the event to also encode the id (it does — `instanceId`
            // — but the WeakMap doubles as our "have we seen this" check).
            const componentIds = new WeakMap<ComponentInstance, ComponentId>();
            const componentParent = new Map<ComponentId, ComponentId | null>();
            const componentNodes = new Map<ComponentId, ComponentInstance>();

            const appIds = new WeakMap<AppContext, AppId>();
            const appCtxs = new Map<AppId, AppContext>();
            let nextAppId = 1;
            const appName = options.appName ?? 'sigx-app';

            // Parent ids now come from `component:created.parentInstanceId`
            // — captured by runtime-core at the moment of setCurrentInstance.
            // The earlier "mounting stack" heuristic only worked for the
            // initial mount cascade and broke when a re-render mounted
            // new children.

            // -----------------------------------------------------------------
            // Reactivity registry
            // -----------------------------------------------------------------
            const includeReactivity = options.includeReactivity !== false;
            const throttleMs = options.throttleMs ?? 16;

            const reactives = new Map<number, ReactivePrimitive>();
            /** Reverse index: component → reactives it owns. */
            const ownedBy = new Map<ComponentId, Set<number>>();

            // Throttle bookkeeping. When an update arrives we update
            // the record immediately (so `get:reactives` always sees
            // fresh state) but defer the wire emission. Pending ids
            // are flushed in a single `setTimeout` per window; any
            // additional updates for the same id within the window
            // simply re-mark the id as pending.
            const pendingUpdates = new Set<number>();
            let flushTimer: ReturnType<typeof setTimeout> | null = null;

            const flushUpdates = () => {
                flushTimer = null;
                for (const id of pendingUpdates) {
                    const rec = reactives.get(id);
                    if (!rec) continue;
                    send({
                        t: 'reactive:updated',
                        payload: {
                            id: rec.id,
                            lastUpdatedAt: rec.lastUpdatedAt ?? Date.now(),
                            updateCount: rec.updateCount,
                        },
                    });
                }
                pendingUpdates.clear();
            };

            const scheduleUpdate = (id: number) => {
                if (throttleMs <= 0) {
                    const rec = reactives.get(id);
                    if (!rec) return;
                    send({
                        t: 'reactive:updated',
                        payload: {
                            id: rec.id,
                            lastUpdatedAt: rec.lastUpdatedAt ?? Date.now(),
                            updateCount: rec.updateCount,
                        },
                    });
                    return;
                }
                pendingUpdates.add(id);
                if (flushTimer === null) {
                    flushTimer = setTimeout(flushUpdates, throttleMs);
                }
            };

            const addToOwner = (componentId: ComponentId | null, reactiveId: number) => {
                if (componentId === null) return;
                let set = ownedBy.get(componentId);
                if (!set) {
                    set = new Set();
                    ownedBy.set(componentId, set);
                }
                set.add(reactiveId);
            };

            const removeReactive = (id: number) => {
                const rec = reactives.get(id);
                if (!rec) return;
                reactives.delete(id);
                if (rec.ownerComponentId !== null) {
                    ownedBy.get(rec.ownerComponentId)?.delete(id);
                }
            };

            // -----------------------------------------------------------------
            // App / component helpers
            // -----------------------------------------------------------------
            const idForApp = (ctx: AppContext): AppId => {
                let id = appIds.get(ctx);
                if (id === undefined) {
                    id = nextAppId++;
                    appIds.set(ctx, id);
                    appCtxs.set(id, ctx);
                }
                return id;
            };

            const propsRefFor = (instance: ComponentInstance) => {
                const props = (instance.ctx as { props?: unknown })?.props;
                if (props === undefined || props === null) return null;
                return refs.register(props);
            };

            const toComponentNode = (id: ComponentId, instance: ComponentInstance, appId: AppId): ComponentNode => ({
                id,
                parentId: componentParent.get(id) ?? null,
                appId,
                name: instance.name ?? '(anonymous)',
                propsRef: propsRefFor(instance),
            });

            // -----------------------------------------------------------------
            // Event router
            // -----------------------------------------------------------------
            const unsubscribe = hook.on((rawEvent: DevtoolsEventBase) => {
                if (!isLayered(rawEvent)) return;

                switch (rawEvent.type) {
                    // ---------------- App / component ----------------
                    case 'app:init': {
                        const appId = idForApp(rawEvent.app);
                        send({ t: 'app:init', payload: { appId, name: appName } });
                        break;
                    }
                    case 'app:unmount': {
                        const appId = appIds.get(rawEvent.app);
                        if (appId !== undefined) {
                            send({ t: 'app:unmount', payload: { appId } });
                            appCtxs.delete(appId);
                        }
                        break;
                    }
                    case 'component:created': {
                        // `instanceId` is null only if no hook was
                        // installed when the ctx was first set — that
                        // would mean we're listening but missed
                        // bootstrap, which the buffer/drain logic
                        // should prevent. Defensive: skip silently.
                        const id = rawEvent.instanceId;
                        if (id === null) break;
                        componentIds.set(rawEvent.instance, id);
                        componentNodes.set(id, rawEvent.instance);
                        componentParent.set(id, rawEvent.parentInstanceId);
                        break;
                    }
                    case 'component:mounted': {
                        const id = rawEvent.instanceId;
                        if (id === null) break;
                        const appId = idForApp(rawEvent.app);
                        send({ t: 'component:mounted', payload: toComponentNode(id, rawEvent.instance, appId) });
                        break;
                    }
                    case 'component:updated': {
                        const id = rawEvent.instanceId;
                        if (id === null) break;
                        send({
                            t: 'component:updated',
                            payload: { id, propsRef: propsRefFor(rawEvent.instance) },
                        });
                        break;
                    }
                    case 'component:unmounted': {
                        const id = rawEvent.instanceId ?? componentIds.get(rawEvent.instance);
                        if (id === undefined || id === null) break;
                        send({ t: 'component:unmounted', payload: { id } });
                        // Drop reactives owned by this component — the
                        // panel doesn't need to display them after unmount.
                        const owned = ownedBy.get(id);
                        if (owned) {
                            for (const rid of owned) reactives.delete(rid);
                            ownedBy.delete(id);
                        }
                        componentParent.delete(id);
                        componentNodes.delete(id);
                        break;
                    }
                    case 'component:error': {
                        const id = rawEvent.instanceId ?? (rawEvent.instance
                            ? componentIds.get(rawEvent.instance) ?? null
                            : null);
                        send({
                            t: 'component:error',
                            payload: {
                                id: id ?? null,
                                message: rawEvent.error.message,
                                stack: rawEvent.error.stack,
                                info: rawEvent.info,
                            },
                        });
                        break;
                    }

                    // ---------------- Reactivity ----------------
                    case 'signal:created':
                    case 'computed:created':
                    case 'effect:created': {
                        if (!includeReactivity) break;
                        const kind: ReactivePrimitiveKind =
                            rawEvent.type === 'signal:created' ? 'signal'
                            : rawEvent.type === 'computed:created' ? 'computed'
                            : 'effect';
                        const rec: ReactivePrimitive = {
                            id: rawEvent.id,
                            kind,
                            ownerComponentId: rawEvent.ownerComponentId,
                            lastUpdatedAt: null,
                            updateCount: 0,
                        };
                        reactives.set(rec.id, rec);
                        addToOwner(rec.ownerComponentId, rec.id);
                        send({ t: 'reactive:created', payload: rec });
                        break;
                    }
                    case 'signal:updated':
                    case 'computed:recomputed':
                    case 'effect:run': {
                        if (!includeReactivity) break;
                        const rec = reactives.get(rawEvent.id);
                        if (!rec) break;
                        rec.updateCount += 1;
                        rec.lastUpdatedAt = Date.now();
                        // Schedule via the throttle window — multiple
                        // updates to the same id collapse to one wire
                        // message per window.
                        scheduleUpdate(rec.id);
                        break;
                    }
                    case 'effect:stopped': {
                        if (!includeReactivity) break;
                        if (reactives.has(rawEvent.id)) {
                            removeReactive(rawEvent.id);
                            send({ t: 'reactive:disposed', payload: { id: rawEvent.id } });
                        }
                        break;
                    }
                }
            });

            // -----------------------------------------------------------------
            // Panel requests
            // -----------------------------------------------------------------
            const unsubMessages = transport.onMessage((req: PanelRequest) => {
                switch (req.t) {
                    case 'get:apps': {
                        const list = Array.from(appCtxs.keys()).map(id => ({ id, name: appName }));
                        transport.send({ t: 'response', id: req.id, payload: list });
                        break;
                    }
                    case 'get:tree': {
                        const { appId } = req.payload;
                        const ctx = appCtxs.get(appId);
                        if (!ctx) {
                            transport.send({ t: 'error', id: req.id, message: `app ${appId} not found` });
                            break;
                        }
                        const nodes: ComponentNode[] = [];
                        for (const [id, instance] of componentNodes) {
                            nodes.push(toComponentNode(id, instance, appId));
                        }
                        transport.send({ t: 'response', id: req.id, payload: nodes });
                        break;
                    }
                    case 'get:value': {
                        const r = refs.resolve(req.payload.ref);
                        if (!r.resolved) {
                            transport.send({ t: 'error', id: req.id, message: 'ref unresolved' });
                            break;
                        }
                        transport.send({
                            t: 'response',
                            id: req.id,
                            payload: serialize(r.value),
                        });
                        break;
                    }
                    case 'get:reactive-value': {
                        // Resolve the reactive id back to its proxy via
                        // the reactivity package's reverse registry,
                        // then serialize through `toRaw` so we don't
                        // re-engage the proxy machinery (avoids
                        // accidental subscriptions or nested-wrap side
                        // effects during inspection).
                        const proxy = getReactiveById(req.payload.reactiveId);
                        if (!proxy) {
                            transport.send({ t: 'error', id: req.id, message: 'reactive unresolved' });
                            break;
                        }
                        let payload;
                        try {
                            payload = serialize(toRaw(proxy));
                        } catch (err) {
                            transport.send({
                                t: 'error',
                                id: req.id,
                                message: `serialize failed: ${(err as Error).message}`,
                            });
                            break;
                        }
                        transport.send({ t: 'response', id: req.id, payload });
                        break;
                    }
                    case 'get:reactives': {
                        const { componentId } = req.payload;
                        const ids = ownedBy.get(componentId);
                        const list: ReactivePrimitive[] = [];
                        if (ids) {
                            for (const id of ids) {
                                const rec = reactives.get(id);
                                if (rec) list.push(rec);
                            }
                        }
                        transport.send({ t: 'response', id: req.id, payload: list });
                        break;
                    }
                    case 'highlight': {
                        transport.send({ t: 'response', id: req.id, payload: { ok: true } });
                        break;
                    }
                    case 'unhighlight': {
                        transport.send({ t: 'response', id: req.id, payload: { ok: true } });
                        break;
                    }
                }
            });

            // ---- Optional store/router observers ----
            // Stores are discovered through the core inspection
            // registry — no per-store handles, no dependency on
            // @sigx/store itself. The router observer still attaches
            // to the user's router instance.
            const observerDisposers: Array<() => void> = [];
            if (options.includeStores !== false) {
                observerDisposers.push(observeStores({
                    nextId: () => hook.nextId(),
                    send,
                }));
            }
            if (options.router) {
                observerDisposers.push(observeRouter(options.router, { send }));
            }

            // Announce ourselves once the wire is up.
            send({ t: 'hello', payload: { protocol: PROTOCOL_VERSION, agentVersion: AGENT_VERSION } });

            // Hold references so closures aren't optimized away.
            void unsubscribe;
            void unsubMessages;
            void observerDisposers;

            function send(event: PageEvent) {
                transport!.send(event);
            }
        },
    };
}
