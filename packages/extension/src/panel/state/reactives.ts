/**
 * Per-component reactives registry — mirrors what the page-side plugin
 * tracks. Lets the panel render "this component owns N signals,
 * updated K times" without round-tripping to the page on every render.
 *
 * Driven by `reactive:created/updated/disposed` push events. The panel
 * also seeds itself via `get:reactives` when a component is first
 * selected (in case it mounted before the panel attached).
 */

import { signal } from '@sigx/reactivity';
import type {
    ComponentId,
    PageEvent,
    ReactivePrimitive,
} from '@sigx/devtools';

export interface ReactivesStore {
    /** All known reactives keyed by id. */
    byId: { value: Map<number, ReactivePrimitive> };
    apply(event: PageEvent): void;
    /** Replace records with a snapshot from `get:reactives`. */
    seed(records: ReactivePrimitive[]): void;
    /** Return reactives owned by a given component, in id order. */
    forComponent(id: ComponentId): ReactivePrimitive[];
    clear(): void;
}

export function createReactivesStore(): ReactivesStore {
    const byId = signal<{ value: Map<number, ReactivePrimitive> }>({ value: new Map() });

    function replace(next: Map<number, ReactivePrimitive>) {
        byId.value = next;
    }

    return {
        byId,
        apply(event) {
            switch (event.t) {
                case 'reactive:created': {
                    const next = new Map(byId.value);
                    next.set(event.payload.id, event.payload);
                    replace(next);
                    break;
                }
                case 'reactive:updated': {
                    const existing = byId.value.get(event.payload.id);
                    if (!existing) return;
                    const next = new Map(byId.value);
                    next.set(event.payload.id, {
                        ...existing,
                        lastUpdatedAt: event.payload.lastUpdatedAt,
                        updateCount: event.payload.updateCount,
                    });
                    replace(next);
                    break;
                }
                case 'reactive:disposed': {
                    if (!byId.value.has(event.payload.id)) return;
                    const next = new Map(byId.value);
                    next.delete(event.payload.id);
                    replace(next);
                    break;
                }
                default:
                    break;
            }
        },
        seed(records) {
            const next = new Map(byId.value);
            for (const rec of records) next.set(rec.id, rec);
            replace(next);
        },
        forComponent(id) {
            const out: ReactivePrimitive[] = [];
            for (const r of byId.value.values()) {
                if (r.ownerComponentId === id) out.push(r);
            }
            out.sort((a, b) => a.id - b.id);
            return out;
        },
        clear() {
            replace(new Map());
        },
    };
}
