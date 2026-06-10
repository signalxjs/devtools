/**
 * `observeStores` discovers store topics through the core inspection
 * registry (`@sigx/runtime-core/inspect`) and forwards them to the
 * wire. These tests use REAL topics from `@sigx/runtime-core` laid out
 * exactly like the redesigned @sigx/store registers them:
 *
 *   - `${storeId}.state`   / name = key            / payload `{ value, prev }`
 *   - `${storeId}.actions` / name = `${action}.onDispatching` (payload: args array),
 *                            `${action}.onDispatched` (payload `{ result, args }`),
 *                            `${action}.onFailure`   (payload `{ error, args }`)
 *   - `${storeId}.events`  / name = event key      / payload = user data
 *
 * The registry is realm-global, so every test destroys all registered
 * topics in afterEach.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createTopic, createTopicGroup } from '@sigx/runtime-core';
import { listTopics } from '@sigx/runtime-core/inspect';
import { observeStores } from '../src/observe-stores';
import type {
    PageEvent,
    StoreActionEvent,
    StoreMutationEvent,
    StoreCustomEvent,
} from '../src/protocol';

function setup() {
    const events: PageEvent[] = [];
    let id = 1;
    const dispose = observeStores({
        nextId: () => id++,
        send: e => events.push(e),
    });
    return { events, dispose };
}

function actionsOf(events: PageEvent[]): StoreActionEvent[] {
    return events
        .filter((e): e is { t: 'store:action'; payload: StoreActionEvent } => e.t === 'store:action')
        .map(e => e.payload);
}

function mutationsOf(events: PageEvent[]): StoreMutationEvent[] {
    return events
        .filter((e): e is { t: 'store:mutation'; payload: StoreMutationEvent } => e.t === 'store:mutation')
        .map(e => e.payload);
}

function customEventsOf(events: PageEvent[]): StoreCustomEvent[] {
    return events
        .filter((e): e is { t: 'store:event'; payload: StoreCustomEvent } => e.t === 'store:event')
        .map(e => e.payload);
}

/** The three topics the store registers per action. */
function makeActionTopics(storeId: string, action: string) {
    const namespace = `${storeId}.actions`;
    return {
        dispatching: createTopic<unknown[]>({ namespace, name: `${action}.onDispatching` }),
        dispatched: createTopic<{ result: unknown; args: unknown[] }>({ namespace, name: `${action}.onDispatched` }),
        failure: createTopic<{ error: unknown; args: unknown[] }>({ namespace, name: `${action}.onFailure` }),
    };
}

const disposers: Array<() => void> = [];

function tracked() {
    const s = setup();
    disposers.push(s.dispose);
    return s;
}

afterEach(() => {
    for (const d of disposers.splice(0)) d();
    // The inspection registry is realm-global — drop every topic so
    // tests stay independent.
    for (const t of listTopics()) t.destroy();
});

describe('observeStores', () => {
    it('emits store:mutation for state topics that existed before subscribing', () => {
        const topic = createTopic<{ value: unknown; prev: unknown }>({
            namespace: 'todos#1.state',
            name: 'count',
        });
        const { events } = tracked();

        topic.publish({ value: 42, prev: 41 });

        const mutations = mutationsOf(events);
        expect(mutations).toHaveLength(1);
        expect(mutations[0].storeName).toBe('todos#1');
        expect(mutations[0].key).toBe('count');
        expect(mutations[0].value).toEqual({ kind: 'primitive', value: 42 });
        expect(typeof mutations[0].at).toBe('number');
    });

    it('discovers topics created AFTER subscribing (live store discovery)', () => {
        const { events } = tracked();

        // Store instantiated after devtools installed.
        const topic = createTopic<{ value: unknown; prev: unknown }>({
            namespace: 'cart#2.state',
            name: 'items',
        });
        topic.publish({ value: ['apple'], prev: [] });

        const mutations = mutationsOf(events);
        expect(mutations).toHaveLength(1);
        expect(mutations[0].storeName).toBe('cart#2');
        expect(mutations[0].key).toBe('items');
    });

    it('correlates a sync dispatch: dispatching then dispatched share an actionId', () => {
        const { events } = tracked();
        const t = makeActionTopics('todos#1', 'addTodo');

        const args = ['feed cat'];
        t.dispatching.publish(args);
        t.dispatched.publish({ result: 'ok', args });

        const actions = actionsOf(events);
        expect(actions).toHaveLength(2);
        expect(actions[0].phase).toBe('dispatching');
        expect(actions[0].storeName).toBe('todos#1');
        expect(actions[0].actionName).toBe('addTodo');
        expect(actions[0].args).toEqual({
            kind: 'array',
            length: 1,
            entries: [[0, { kind: 'primitive', value: 'feed cat' }]],
        });
        expect(actions[1].phase).toBe('dispatched');
        expect(actions[1].actionId).toBe(actions[0].actionId);
        expect(actions[1].result).toEqual({ kind: 'primitive', value: 'ok' });
        expect(typeof actions[1].durationMs).toBe('number');
        expect(actions[1].durationMs!).toBeGreaterThanOrEqual(0);
    });

    it('correlates overlapping async dispatches by args reference, even out of order', () => {
        const { events } = tracked();
        const t = makeActionTopics('todos#1', 'save');

        const argsA = ['first'];
        const argsB = ['second'];
        t.dispatching.publish(argsA);   // dispatch A starts
        t.dispatching.publish(argsB);   // dispatch B starts
        // B settles BEFORE A — args reference must drive the match,
        // not FIFO order.
        t.dispatched.publish({ result: 'B done', args: argsB });
        t.dispatched.publish({ result: 'A done', args: argsA });

        const actions = actionsOf(events);
        expect(actions.map(a => a.phase)).toEqual([
            'dispatching', 'dispatching', 'dispatched', 'dispatched',
        ]);
        const [startA, startB, doneB, doneA] = actions;
        expect(doneB.actionId).toBe(startB.actionId);
        expect(doneA.actionId).toBe(startA.actionId);
        expect(doneB.result).toEqual({ kind: 'primitive', value: 'B done' });
        expect(doneA.result).toEqual({ kind: 'primitive', value: 'A done' });
    });

    it('falls back to FIFO per action when the args reference is unknown', () => {
        const { events } = tracked();
        const t = makeActionTopics('todos#1', 'save');

        t.dispatching.publish(['oldest']);
        t.dispatching.publish(['newer']);
        // Settles with a DIFFERENT array instance — should consume the
        // oldest pending dispatch.
        t.dispatched.publish({ result: 1, args: ['unrelated'] });

        const actions = actionsOf(events);
        const done = actions.find(a => a.phase === 'dispatched')!;
        const oldest = actions.find(a => a.phase === 'dispatching')!;
        expect(done.actionId).toBe(oldest.actionId);
    });

    it('emits phase=failed with the serialized error on onFailure', () => {
        const { events } = tracked();
        const t = makeActionTopics('todos#1', 'addTodo');

        const args = ['boom'];
        t.dispatching.publish(args);
        t.failure.publish({ error: new Error('nope'), args });

        const actions = actionsOf(events);
        expect(actions).toHaveLength(2);
        expect(actions[1].phase).toBe('failed');
        expect(actions[1].actionId).toBe(actions[0].actionId);
        expect(actions[1].error).toBeTruthy();
        expect(actions[1].result).toBeUndefined();
        expect(typeof actions[1].durationMs).toBe('number');
    });

    it('ignores settle phases with no pending dispatch (attached mid-action)', () => {
        const { events } = tracked();
        const t = makeActionTopics('todos#1', 'addTodo');

        t.dispatched.publish({ result: 'ok', args: ['late'] });

        expect(actionsOf(events)).toHaveLength(0);
    });

    it('passes custom events through as store:event', () => {
        const { events } = tracked();

        // Stores create custom events via createTopicGroup under
        // `${storeId}.events` — topics materialize lazily per key.
        const group = createTopicGroup<{ loggedIn: { user: string } }>({
            namespace: 'auth#1.events',
        });
        group.topics.loggedIn.publish({ user: 'alice' });

        const custom = customEventsOf(events);
        expect(custom).toHaveLength(1);
        expect(custom[0].storeName).toBe('auth#1');
        expect(custom[0].event).toBe('loggedIn');
        expect(custom[0].data).toEqual({
            kind: 'object',
            typeName: 'Object',
            entries: [['user', { kind: 'primitive', value: 'alice' }]],
        });
    });

    it('classifies an action literally named "state" as an action, not a mutation', () => {
        // Full registry key: `todos#1.actions.state.onDispatching` —
        // this matches the `*.state.*` wildcard too, so the namespace
        // suffix check must disambiguate.
        const { events } = tracked();
        const t = makeActionTopics('todos#1', 'state');

        t.dispatching.publish(['x']);

        expect(mutationsOf(events)).toHaveLength(0);
        const actions = actionsOf(events);
        expect(actions).toHaveLength(1);
        expect(actions[0].actionName).toBe('state');
        expect(actions[0].storeName).toBe('todos#1');
    });

    it('ignores registered topics that are not store-shaped', () => {
        const { events } = tracked();

        const misc = createTopic<string>({ namespace: 'misc', name: 'ping' });
        misc.publish('hello');

        expect(events).toHaveLength(0);
    });

    it('stops observing everything — existing and future topics — on dispose', () => {
        const { events, dispose } = tracked();
        const stateTopic = createTopic<{ value: unknown; prev: unknown }>({
            namespace: 'todos#1.state',
            name: 'count',
        });
        const t = makeActionTopics('todos#1', 'addTodo');

        stateTopic.publish({ value: 1, prev: 0 });
        t.dispatching.publish(['before']);
        expect(events).toHaveLength(2);

        dispose();

        stateTopic.publish({ value: 2, prev: 1 });
        t.dispatching.publish(['after']);
        // A store created after dispose must not be observed either.
        const late = createTopic<{ value: unknown; prev: unknown }>({
            namespace: 'late#9.state',
            name: 'x',
        });
        late.publish({ value: 'y', prev: null });

        expect(events).toHaveLength(2);
    });
});
