/**
 * Component tree store.
 *
 * Mirrors the shadow tree the page-side @sigx/devtools plugin maintains.
 * The panel never trusts incoming order — `component:unmounted` may
 * arrive after the parent's `component:unmounted`, etc. — so the store
 * is keyed by id and reconstructs parent/child relationships from the
 * parentId field on each node.
 */

import { signal } from '@sigx/reactivity';
import type { ComponentNode, ComponentId, PageEvent } from '@sigx/devtools';

export interface TreeStore {
    /** All nodes keyed by id. The signal wraps a Map so we can swap the
     *  underlying ref to trigger updates. */
    nodes: { value: Map<ComponentId, ComponentNode> };
    apply(event: PageEvent): void;
    clear(): void;
    /** Children of `id`, or roots if `id == null`. */
    childrenOf(id: ComponentId | null): ComponentNode[];
}

export function createTreeStore(): TreeStore {
    const nodes = signal<{ value: Map<ComponentId, ComponentNode> }>({ value: new Map() });

    function replace(next: Map<ComponentId, ComponentNode>) {
        nodes.value = next;
    }

    return {
        nodes,
        apply(event) {
            switch (event.t) {
                case 'component:mounted': {
                    const next = new Map(nodes.value);
                    next.set(event.payload.id, event.payload);
                    replace(next);
                    break;
                }
                case 'component:updated': {
                    const existing = nodes.value.get(event.payload.id);
                    if (!existing) return;
                    const next = new Map(nodes.value);
                    next.set(event.payload.id, {
                        ...existing,
                        propsRef: event.payload.propsRef,
                    });
                    replace(next);
                    break;
                }
                case 'component:unmounted': {
                    if (!nodes.value.has(event.payload.id)) return;
                    const next = new Map(nodes.value);
                    next.delete(event.payload.id);
                    replace(next);
                    break;
                }
                default:
                    // Other events aren't tree-relevant.
                    break;
            }
        },
        clear() {
            replace(new Map());
        },
        childrenOf(id) {
            const out: ComponentNode[] = [];
            for (const node of nodes.value.values()) {
                if (node.parentId === id) out.push(node);
            }
            // Stable order by mount id — newer children appear after
            // older ones. Good enough for v0; the renderer's actual
            // DOM order would be more correct but isn't on the wire.
            out.sort((a, b) => a.id - b.id);
            return out;
        },
    };
}
