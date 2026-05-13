/**
 * `observeStore` duck-types a @sigx/store result and forwards its
 * lifecycle events to the wire. These tests build a minimal fake
 * matching the shape and assert the wire calls.
 */

import { describe, it, expect } from 'vitest';
import { observeStore } from '../src/observe-store';
import type { PageEvent, StoreActionEvent, StoreMutationEvent } from '../src/protocol';

interface Subscribable<T extends unknown[]> {
    subscribe(fn: (...args: T) => void): { unsubscribe(): void };
}

function makeTopic<T extends unknown[]>(): Subscribable<T> & { publish: (...args: T) => void } {
    const listeners = new Set<(...args: T) => void>();
    return {
        subscribe(fn) {
            listeners.add(fn);
            return { unsubscribe: () => { listeners.delete(fn); } };
        },
        publish(...args: T) {
            for (const l of listeners) l(...args);
        },
    };
}

describe('observeStore', () => {
    it('emits store:action with phase=dispatching then dispatched, matched by actionId', () => {
        const dispatching = makeTopic<[unknown[]]>();
        const dispatched = makeTopic<[unknown, ...unknown[]]>();
        const failure = makeTopic<[unknown, ...unknown[]]>();
        const store = {
            name: 'todos',
            actions: {
                onDispatching: { addTodo: dispatching },
                onDispatched:  { addTodo: dispatched },
                onFailure:     { addTodo: failure },
            },
        };
        const events: PageEvent[] = [];
        let id = 1;
        observeStore(store, {
            nextId: () => id++,
            send: e => events.push(e),
            defaultName: 'fallback',
        });

        // Subscription forwards `arguments` as a single IArguments-like
        // value. In our test we pass an args array directly.
        dispatching.publish(['feed cat'] as any);
        dispatched.publish('ok' as any, 'feed cat' as any);

        const actions = events.filter((e): e is { t: 'store:action'; payload: StoreActionEvent } =>
            e.t === 'store:action'
        );
        expect(actions).toHaveLength(2);
        expect(actions[0].payload.phase).toBe('dispatching');
        expect(actions[0].payload.storeName).toBe('todos');
        expect(actions[0].payload.actionName).toBe('addTodo');
        expect(actions[1].payload.phase).toBe('dispatched');
        // dispatched should carry the same actionId as dispatching
        expect(actions[1].payload.actionId).toBe(actions[0].payload.actionId);
        // durationMs is set on the second phase
        expect(typeof actions[1].payload.durationMs).toBe('number');
        expect(actions[1].payload.durationMs!).toBeGreaterThanOrEqual(0);
    });

    it('emits store:action with phase=failed when the failure topic fires', () => {
        const dispatching = makeTopic<[unknown[]]>();
        const dispatched = makeTopic<[unknown, ...unknown[]]>();
        const failure = makeTopic<[unknown, ...unknown[]]>();
        const store = {
            name: 'todos',
            actions: {
                onDispatching: { addTodo: dispatching },
                onDispatched:  { addTodo: dispatched },
                onFailure:     { addTodo: failure },
            },
        };
        const events: PageEvent[] = [];
        let id = 1;
        observeStore(store, { nextId: () => id++, send: e => events.push(e), defaultName: 'x' });

        dispatching.publish(['boom'] as any);
        failure.publish(new Error('nope') as any, 'boom' as any);

        const failed = events.find(
            (e): e is { t: 'store:action'; payload: StoreActionEvent } =>
                e.t === 'store:action' && e.payload.phase === 'failed'
        );
        expect(failed).toBeTruthy();
        expect(failed!.payload.error).toBeTruthy();
    });

    it('converts onMutated${Key} event names back to camelCase keys', () => {
        const onMutatedCount = makeTopic<[unknown]>();
        const onMutatedUserName = makeTopic<[unknown]>();
        const store = {
            name: 's',
            events: {
                onMutatedCount,
                onMutatedUserName,
            },
        };
        const events: PageEvent[] = [];
        observeStore(store, {
            nextId: () => 1,
            send: e => events.push(e),
            defaultName: 's',
        });

        onMutatedCount.publish(42);
        onMutatedUserName.publish('alice');

        const mutations = events.filter(
            (e): e is { t: 'store:mutation'; payload: StoreMutationEvent } => e.t === 'store:mutation'
        );
        expect(mutations.map(m => m.payload.key)).toEqual(['count', 'userName']);
    });

    it('falls back to defaultName when the store has no name', () => {
        const onMutatedX = makeTopic<[unknown]>();
        const store = { events: { onMutatedX } };
        const events: PageEvent[] = [];
        observeStore(store, { nextId: () => 1, send: e => events.push(e), defaultName: 'fallback' });
        onMutatedX.publish('hi');
        const m = events.find(e => e.t === 'store:mutation');
        expect((m as any).payload.storeName).toBe('fallback');
    });

    it('unsubscribes every topic when the disposer is called', () => {
        const topic = makeTopic<[unknown[]]>();
        const store = {
            name: 's',
            actions: {
                onDispatching: { foo: topic },
                onDispatched: {},
                onFailure: {},
            },
        };
        const events: PageEvent[] = [];
        const dispose = observeStore(store, {
            nextId: () => 1,
            send: e => events.push(e),
            defaultName: 's',
        });
        topic.publish(['before'] as any);
        dispose();
        topic.publish(['after'] as any);
        // Only the pre-dispose event made it through.
        expect(events.filter(e => e.t === 'store:action')).toHaveLength(1);
    });
});
