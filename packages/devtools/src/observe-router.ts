/**
 * Observe a @sigx/router instance and forward navigations to the panel.
 *
 * The router exposes `currentRoute` as a getter that reads a signal
 * underneath. Wrapping it in an `effect()` from @sigx/reactivity makes
 * us a subscriber to that signal — we get a fresh callback on every
 * navigation without any router-internal coupling.
 *
 * Duck-typed so we don't take a hard dependency on the user's exact
 * router version. (Stores, by contrast, are discovered through the
 * core inspection registry — see observe-stores.ts.)
 */

import { effect } from '@sigx/reactivity';
import type { PageEvent } from './protocol.js';
import { serialize } from './serialize.js';

interface RouteLocation {
    path: string;
    params?: unknown;
    query?: unknown;
}

interface ObservableRouter {
    readonly currentRoute: RouteLocation;
}

export interface RouterObserverOptions {
    send: (event: PageEvent) => void;
}

export function observeRouter(router: ObservableRouter, opts: RouterObserverOptions): () => void {
    let prevPath: string | null = null;
    let firstCall = true;

    const runner = effect(() => {
        // Reading these inside the effect subscribes us to the
        // underlying route signal. On any nav, this body re-runs.
        const route = router.currentRoute;
        if (!route) return;

        // Skip the very first invocation — that's the initial route at
        // mount time, not a "navigation". The panel can ask for the
        // current route on connect if it needs the starting state.
        if (firstCall) {
            firstCall = false;
            prevPath = route.path ?? null;
            return;
        }

        opts.send({
            t: 'router:nav',
            payload: {
                fromPath: prevPath,
                toPath: route.path ?? '(unknown)',
                params: serialize(route.params ?? {}),
                query: serialize(route.query ?? {}),
                at: Date.now(),
            },
        });
        prevPath = route.path ?? null;
    });

    return () => runner.stop();
}
