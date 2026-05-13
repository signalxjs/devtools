/**
 * Value reference table.
 *
 * The plugin hands the panel small messages with `ValueRef` indirections
 * instead of inline values. The panel asks for `get:value` only for the
 * specific refs it cares about. That keeps message volume manageable when
 * the page mounts hundreds of components — and avoids serializing reactive
 * proxies eagerly.
 *
 * Refs are weakly referenced so that components that unmount can be
 * garbage-collected even if the panel never asked for their props.
 */

import type { ValueRef } from './protocol.js';

export class ValueRefTable {
    private nextId = 1;
    private refs = new Map<ValueRef, WeakRef<object>>();
    /** Values that aren't objects (primitives, functions) are stored strongly. */
    private strong = new Map<ValueRef, unknown>();

    /** Register a value and return a ref. */
    register(value: unknown): ValueRef {
        const id = this.nextId++;
        if (value !== null && typeof value === 'object') {
            this.refs.set(id, new WeakRef(value));
        } else {
            this.strong.set(id, value);
        }
        return id;
    }

    /**
     * Resolve a ref. Returns `{ resolved: false }` if the underlying object
     * has been GC'd — the panel should treat that as "value no longer
     * available" rather than an error.
     */
    resolve(ref: ValueRef): { resolved: true; value: unknown } | { resolved: false } {
        if (this.strong.has(ref)) {
            return { resolved: true, value: this.strong.get(ref) };
        }
        const weak = this.refs.get(ref);
        if (!weak) return { resolved: false };
        const value = weak.deref();
        if (value === undefined) {
            // The referent is gone; drop the slot.
            this.refs.delete(ref);
            return { resolved: false };
        }
        return { resolved: true, value };
    }

    /** Forget a specific ref. */
    release(ref: ValueRef): void {
        this.refs.delete(ref);
        this.strong.delete(ref);
    }
}
