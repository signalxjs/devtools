/**
 * Panel-wide singletons.
 *
 * The panel runs as a single sigx app — there's no DI tree to scope
 * `connection` and `tree` to, so we hold them at module level. The
 * panel entry sets these once before mounting; components import the
 * accessor and pull what they need.
 *
 * If we ever support multiple inspected apps in one panel we'd promote
 * this to a real provide/inject pair.
 */

import type { Connection } from './state/connection';
import type { TreeStore } from './state/tree';
import type { ReactivesStore } from './state/reactives';
import type { ActivityStore } from './state/activity';

export interface PanelContext {
    connection: Connection;
    tree: TreeStore;
    reactives: ReactivesStore;
    activity: ActivityStore;
}

let current: PanelContext | null = null;

export function setPanelContext(ctx: PanelContext) {
    current = ctx;
}

export function panel(): PanelContext {
    if (!current) throw new Error('Panel context not initialized — panel.tsx must set it before any component renders.');
    return current;
}
