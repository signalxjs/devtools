/**
 * Tests for the @sigx/devtools plugin's throttling + includeReactivity
 * options. Drives the plugin directly with a fake transport and
 * pumps events into the global hook so we don't need a full app.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { devtools } from '../src/plugin';
import {
    DEVTOOLS_HOOK_KEY,
    ensureDevtoolsHook,
} from '@sigx/reactivity/internals';
import type { PageEvent } from '../src/protocol';
import type { Transport } from '../src/transport';

function fakeApp(): { hook: (h: unknown) => unknown } {
    return { hook: () => undefined };
}

function fakeTransport(sent: PageEvent[]): Transport {
    return {
        send: msg => sent.push(msg as PageEvent),
        onMessage: () => () => {},
        close: () => {},
    };
}

describe('plugin throttling', () => {
    beforeEach(() => {
        delete (globalThis as any)[DEVTOOLS_HOOK_KEY];
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
        delete (globalThis as any)[DEVTOOLS_HOOK_KEY];
    });

    it('coalesces multiple reactive:updated events for the same id into one wire message per window', () => {
        const sent: PageEvent[] = [];
        const plugin = devtools({ transport: fakeTransport(sent), throttleMs: 50 });
        plugin.install!(fakeApp() as any);

        const hook = ensureDevtoolsHook();
        // Create a signal first so the plugin tracks it.
        hook.emit({ type: 'signal:created', id: 1, kind: 'object', ownerComponentId: null } as any);
        sent.length = 0; // drop hello + create

        // 100 updates in the same window — should collapse to 1.
        for (let i = 0; i < 100; i++) {
            hook.emit({ type: 'signal:updated', id: 1, key: 'value' } as any);
        }
        // Before the window elapses, no wire messages should have fired.
        expect(sent.filter(e => e.t === 'reactive:updated')).toHaveLength(0);

        vi.advanceTimersByTime(50);
        const updated = sent.filter(e => e.t === 'reactive:updated');
        expect(updated).toHaveLength(1);
        // The single message carries the cumulative count.
        if (updated[0].t === 'reactive:updated') {
            expect(updated[0].payload.updateCount).toBe(100);
        }
    });

    it('separates updates for different ids in the same window', () => {
        const sent: PageEvent[] = [];
        const plugin = devtools({ transport: fakeTransport(sent), throttleMs: 50 });
        plugin.install!(fakeApp() as any);

        const hook = ensureDevtoolsHook();
        hook.emit({ type: 'signal:created', id: 1, kind: 'object', ownerComponentId: null } as any);
        hook.emit({ type: 'signal:created', id: 2, kind: 'object', ownerComponentId: null } as any);
        sent.length = 0;

        hook.emit({ type: 'signal:updated', id: 1, key: 'a' } as any);
        hook.emit({ type: 'signal:updated', id: 2, key: 'b' } as any);
        hook.emit({ type: 'signal:updated', id: 1, key: 'a' } as any);
        vi.advanceTimersByTime(50);

        const updated = sent.filter(e => e.t === 'reactive:updated');
        expect(updated).toHaveLength(2);
        const ids = updated.map(e => e.t === 'reactive:updated' ? e.payload.id : 0).sort();
        expect(ids).toEqual([1, 2]);
    });

    it('with throttleMs=0, every update flushes synchronously', () => {
        const sent: PageEvent[] = [];
        const plugin = devtools({ transport: fakeTransport(sent), throttleMs: 0 });
        plugin.install!(fakeApp() as any);

        const hook = ensureDevtoolsHook();
        hook.emit({ type: 'signal:created', id: 1, kind: 'object', ownerComponentId: null } as any);
        sent.length = 0;

        hook.emit({ type: 'signal:updated', id: 1, key: 'a' } as any);
        hook.emit({ type: 'signal:updated', id: 1, key: 'a' } as any);
        hook.emit({ type: 'signal:updated', id: 1, key: 'a' } as any);
        // No timer advance — already flushed.
        expect(sent.filter(e => e.t === 'reactive:updated')).toHaveLength(3);
    });
});

describe('plugin includeReactivity', () => {
    beforeEach(() => {
        delete (globalThis as any)[DEVTOOLS_HOOK_KEY];
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
        delete (globalThis as any)[DEVTOOLS_HOOK_KEY];
    });

    it('emits no reactive:* messages when includeReactivity is false', () => {
        const sent: PageEvent[] = [];
        const plugin = devtools({ transport: fakeTransport(sent), includeReactivity: false });
        plugin.install!(fakeApp() as any);

        const hook = ensureDevtoolsHook();
        hook.emit({ type: 'signal:created', id: 1, kind: 'object', ownerComponentId: null } as any);
        hook.emit({ type: 'signal:updated', id: 1, key: 'a' } as any);
        hook.emit({ type: 'effect:created', id: 2, ownerComponentId: null } as any);
        hook.emit({ type: 'effect:run', id: 2, durationMs: 1 } as any);
        hook.emit({ type: 'effect:stopped', id: 2 } as any);
        vi.advanceTimersByTime(100);

        expect(sent.filter(e => e.t.startsWith('reactive:'))).toHaveLength(0);
    });

    it('component events still flow when includeReactivity is false', () => {
        const sent: PageEvent[] = [];
        const plugin = devtools({ transport: fakeTransport(sent), includeReactivity: false });
        plugin.install!(fakeApp() as any);

        const hook = ensureDevtoolsHook();
        const fakeApp_ = {} as any;
        const fakeInstance = { name: 'X', ctx: {}, vnode: {} } as any;
        hook.emit({ type: 'component:created', app: fakeApp_, instance: fakeInstance, instanceId: 1 } as any);
        hook.emit({ type: 'component:mounted', app: fakeApp_, instance: fakeInstance, instanceId: 1 } as any);

        // Mounted message should be on the wire even though reactivity is off.
        expect(sent.some(e => e.t === 'component:mounted')).toBe(true);
    });
});
