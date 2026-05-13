/**
 * `observeRouter` subscribes to a router's `currentRoute` getter via
 * an effect. The first read is skipped (it's the initial route, not
 * a navigation); subsequent changes emit `router:nav` with from/to.
 */

import { describe, it, expect } from 'vitest';
import { signal } from '@sigx/reactivity';
import { observeRouter } from '../src/observe-router';
import type { PageEvent } from '../src/protocol';

interface Route {
    path: string;
    params?: unknown;
    query?: unknown;
}

function makeRouter(initial: Route): {
    router: { readonly currentRoute: Route };
    navigate: (next: Route) => void;
} {
    const state = signal({ value: initial });
    return {
        router: {
            get currentRoute() {
                return state.value;
            },
        },
        navigate(next) {
            state.value = next;
        },
    };
}

describe('observeRouter', () => {
    it('skips the initial route and emits router:nav for subsequent changes', () => {
        const { router, navigate } = makeRouter({ path: '/', params: {}, query: {} });
        const events: PageEvent[] = [];
        observeRouter(router, { send: e => events.push(e) });

        // No event for the initial read.
        expect(events).toHaveLength(0);

        navigate({ path: '/about', params: {}, query: { ref: 'home' } });
        const e1 = events.find(e => e.t === 'router:nav');
        expect(e1).toBeTruthy();
        if (e1?.t === 'router:nav') {
            expect(e1.payload.fromPath).toBe('/');
            expect(e1.payload.toPath).toBe('/about');
        }

        navigate({ path: '/about/team', params: {}, query: {} });
        const navs = events.filter(e => e.t === 'router:nav');
        expect(navs).toHaveLength(2);
        if (navs[1]?.t === 'router:nav') {
            expect(navs[1].payload.fromPath).toBe('/about');
            expect(navs[1].payload.toPath).toBe('/about/team');
        }
    });

    it('stops emitting after dispose', () => {
        const { router, navigate } = makeRouter({ path: '/', params: {}, query: {} });
        const events: PageEvent[] = [];
        const dispose = observeRouter(router, { send: e => events.push(e) });

        navigate({ path: '/a', params: {}, query: {} });
        expect(events.filter(e => e.t === 'router:nav')).toHaveLength(1);

        dispose();
        navigate({ path: '/b', params: {}, query: {} });
        expect(events.filter(e => e.t === 'router:nav')).toHaveLength(1);
    });
});
