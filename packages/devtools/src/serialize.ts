/**
 * Value serialization for the devtools wire.
 *
 * Handles three nasty cases:
 *   1. Reactive proxies — these would re-track when read; we read through
 *      them but break recursion before they trigger anything dangerous.
 *   2. Cycles — emitted as `{ kind: 'circular' }`.
 *   3. Functions / symbols / bigints — non-JSON values that we transcribe
 *      to a tagged placeholder.
 */

import type { SerializedValue } from './protocol.js';
import { SERIALIZE_MAX_DEPTH, SERIALIZE_MAX_ENTRIES } from './protocol.js';

/**
 * Serialize a value for the devtools panel.
 *
 * Bounded by depth and entry count — never throws, never recurses
 * indefinitely. Reactive proxies are read through normally; the caller is
 * responsible for running this *outside* of any active effect so reads
 * don't accidentally register as dependencies.
 */
export function serialize(value: unknown): SerializedValue {
    return serializeInner(value, 0, new WeakSet());
}

function serializeInner(value: unknown, depth: number, seen: WeakSet<object>): SerializedValue {
    if (value === null) return { kind: 'primitive', value: null };
    if (value === undefined) return { kind: 'undefined' };

    const t = typeof value;
    if (t === 'string' || t === 'number' || t === 'boolean') {
        return { kind: 'primitive', value: value as string | number | boolean };
    }
    if (t === 'bigint') return { kind: 'bigint', value: (value as bigint).toString() };
    if (t === 'symbol') return { kind: 'symbol', description: (value as symbol).description ?? '' };
    if (t === 'function') return { kind: 'function', name: (value as Function).name || '(anonymous)' };

    // Objects and arrays
    if (depth >= SERIALIZE_MAX_DEPTH) {
        return { kind: 'truncated', reason: 'depth' };
    }

    const obj = value as object;
    if (seen.has(obj)) return { kind: 'circular' };
    seen.add(obj);

    if (Array.isArray(obj)) {
        const len = obj.length;
        const cap = Math.min(len, SERIALIZE_MAX_ENTRIES);
        const entries: Array<[number, SerializedValue]> = [];
        for (let i = 0; i < cap; i++) {
            entries.push([i, serializeInner(obj[i], depth + 1, seen)]);
        }
        return { kind: 'array', length: len, entries };
    }

    // Plain-ish object. Use the constructor name where useful (e.g. "Map",
    // "Set", "Date") to give the panel something to render. For reactive
    // proxies, the constructor is the underlying target's constructor.
    const typeName = obj.constructor?.name ?? 'Object';

    // Pull keys via Object.keys — own enumerable string keys only. Symbol
    // keys (like the reactive markers) are intentionally skipped: they
    // belong to the framework's internal protocol, not user state.
    let keys: string[];
    try {
        keys = Object.keys(obj);
    } catch {
        return { kind: 'object', typeName, entries: [] };
    }

    const cap = Math.min(keys.length, SERIALIZE_MAX_ENTRIES);
    const entries: Array<[string, SerializedValue]> = [];
    for (let i = 0; i < cap; i++) {
        const key = keys[i];
        let v: unknown;
        try {
            v = (obj as Record<string, unknown>)[key];
        } catch (err) {
            v = `[throw: ${(err as Error).message}]`;
        }
        entries.push([key, serializeInner(v, depth + 1, seen)]);
    }
    return { kind: 'object', typeName, entries };
}
