/**
 * DevTools wire protocol.
 *
 * Messages are JSON-serializable so the same protocol works across every
 * transport — postMessage today, WebSocket for the Lynx native runtime
 * tomorrow, BroadcastChannel for an in-page overlay. No DOM types, no
 * runtime references on the wire; the plugin side holds the live objects
 * and resolves IDs.
 *
 * Large or reactive values are never sent inline. The plugin keeps a
 * {@link ValueRef} table; the panel asks for `get:value` when it needs to
 * render an object. That keeps individual messages small and avoids
 * accidentally serializing reactive proxies into themselves.
 */

/** Protocol version. Bump when message shapes change incompatibly. */
export const PROTOCOL_VERSION = 1;

/** Stable IDs minted by the plugin. */
export type AppId = number;
export type ComponentId = number;
/** Indirection for values the panel may inspect on demand. */
export type ValueRef = number;

/** A snapshot of a component for the tree view. */
export interface ComponentNode {
    id: ComponentId;
    parentId: ComponentId | null;
    appId: AppId;
    name: string;
    /** ValueRef to the props record. Null when the component has no props. */
    propsRef: ValueRef | null;
}

/** Reactive primitive kind — drives the panel's icon and grouping. */
export type ReactivePrimitiveKind = 'signal' | 'computed' | 'effect';

/** A reactive primitive owned (or unowned) by a component. */
export interface ReactivePrimitive {
    id: number;
    kind: ReactivePrimitiveKind;
    /** Component id this was created under, or null for module-level primitives. */
    ownerComponentId: ComponentId | null;
    /** Most recent update wall-clock time (ms since epoch). null if never updated. */
    lastUpdatedAt: number | null;
    /**
     * Number of updates observed since creation. For effects, the
     * number of times the effect body has run.
     */
    updateCount: number;
}

// ----------------------------------------------------------------------------
// Page → Panel (events)
// ----------------------------------------------------------------------------

/** Wire shape for store actions — three-phase: dispatching → dispatched | failed. */
export interface StoreActionEvent {
    /** Monotonic id linking the three phases of a single dispatch. */
    actionId: number;
    storeName: string;
    actionName: string;
    phase: 'dispatching' | 'dispatched' | 'failed';
    /** Serialized args. Present on every phase. */
    args: SerializedValue;
    /** Serialized result. Present on `dispatched` (or undefined). */
    result?: SerializedValue;
    /** Serialized error reason. Present on `failed`. */
    error?: SerializedValue;
    /** Milliseconds from dispatching to dispatched/failed. Set on later phases. */
    durationMs?: number;
    /** Wall-clock ms since epoch when this phase fired. */
    at: number;
}

/** Wire shape for store state mutations. */
export interface StoreMutationEvent {
    storeName: string;
    key: string;
    /** Serialized new value. Inline because mutations are usually small. */
    value: SerializedValue;
    at: number;
}

/** Wire shape for router navigations. */
export interface RouterNavEvent {
    fromPath: string | null;
    toPath: string;
    params: SerializedValue;
    query: SerializedValue;
    at: number;
}

export type PageEvent =
    | { t: 'hello';              payload: { protocol: number; agentVersion: string } }
    | { t: 'app:init';           payload: { appId: AppId; name: string } }
    | { t: 'app:unmount';        payload: { appId: AppId } }
    | { t: 'component:mounted';  payload: ComponentNode }
    | { t: 'component:updated';  payload: { id: ComponentId; propsRef: ValueRef | null } }
    | { t: 'component:unmounted'; payload: { id: ComponentId } }
    | { t: 'component:error';    payload: { id: ComponentId | null; message: string; stack?: string; info: string } }
    | { t: 'reactive:created';   payload: ReactivePrimitive }
    | { t: 'reactive:updated';   payload: { id: number; lastUpdatedAt: number; updateCount: number } }
    | { t: 'reactive:disposed';  payload: { id: number } }
    | { t: 'store:action';       payload: StoreActionEvent }
    | { t: 'store:mutation';     payload: StoreMutationEvent }
    | { t: 'router:nav';         payload: RouterNavEvent }
    | { t: 'value:resolved';     payload: { ref: ValueRef; value: SerializedValue } };

// ----------------------------------------------------------------------------
// Panel → Page (requests)
// ----------------------------------------------------------------------------

export type PanelRequest =
    | { t: 'get:apps';            id: number }
    | { t: 'get:tree';            id: number; payload: { appId: AppId } }
    | { t: 'get:value';           id: number; payload: { ref: ValueRef } }
    | { t: 'get:reactive-value';  id: number; payload: { reactiveId: number } }
    | { t: 'get:reactives';       id: number; payload: { componentId: ComponentId } }
    | { t: 'highlight';           id: number; payload: { componentId: ComponentId } }
    | { t: 'unhighlight';         id: number; payload: {} };

/**
 * Same as `PanelRequest` minus the `id` field — what callers pass into
 * `Connection.request()`. Kept as an explicit union so contextual
 * narrowing on `t` works at call sites (TS's `Omit` distribution on a
 * union with literal-tagged variants can lose the discriminant).
 */
export type PanelRequestInput =
    | { t: 'get:apps' }
    | { t: 'get:tree';            payload: { appId: AppId } }
    | { t: 'get:value';           payload: { ref: ValueRef } }
    | { t: 'get:reactive-value';  payload: { reactiveId: number } }
    | { t: 'get:reactives';       payload: { componentId: ComponentId } }
    | { t: 'highlight';           payload: { componentId: ComponentId } }
    | { t: 'unhighlight';         payload: {} };

export type PanelResponse =
    | { t: 'response'; id: number; payload: unknown }
    | { t: 'error';    id: number; message: string };

// ----------------------------------------------------------------------------
// Value serialization
// ----------------------------------------------------------------------------

/**
 * Wire format for inspected values. Reactive proxies are unwrapped first;
 * cycles are broken via a "circular" marker so we never recurse forever.
 * Functions become `{ __type: 'function', name }` placeholders.
 */
export type SerializedValue =
    | { kind: 'primitive'; value: string | number | boolean | null }
    | { kind: 'undefined' }
    | { kind: 'bigint';    value: string }
    | { kind: 'symbol';    description: string }
    | { kind: 'function';  name: string }
    | { kind: 'array';     length: number; entries: Array<[number, SerializedValue]> }
    | { kind: 'object';    typeName: string; entries: Array<[string, SerializedValue]> }
    | { kind: 'circular' }
    | { kind: 'truncated'; reason: 'depth' | 'size' };

/** Maximum recursion depth before we cut off and emit `{ kind: 'truncated' }`. */
export const SERIALIZE_MAX_DEPTH = 4;
/** Cap entries per object/array to keep messages bounded. */
export const SERIALIZE_MAX_ENTRIES = 100;
