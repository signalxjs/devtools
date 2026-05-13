/**
 * Lists the reactive primitives (signals, computeds, effects) owned
 * by the selected component. Each row is clickable: expanding it
 * fetches the current value via `get:reactive-value` and renders it
 * with `SerializedValueView`. Values auto-refresh when the page side
 * emits `reactive:updated` for an expanded id.
 */

import { component, effect, signal } from 'sigx';
import type { ComponentId, ReactivePrimitive, SerializedValue } from '@sigx/devtools';
import { panel } from '../context';
import { SerializedValueView } from './SerializedValueView';

const KIND_LABEL: Record<ReactivePrimitive['kind'], string> = {
    signal: 'signal',
    computed: 'computed',
    effect: 'effect',
};

const KIND_COLOR: Record<ReactivePrimitive['kind'], string> = {
    signal: '#0891b2',
    computed: '#7c3aed',
    effect: '#16a34a',
};

function formatAgo(ts: number | null): string {
    if (ts === null) return '—';
    const diff = Date.now() - ts;
    if (diff < 1000) return `${diff}ms ago`;
    if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
    return `${Math.floor(diff / 60_000)}m ago`;
}

const Row = component<{ rec: ReactivePrimitive }>(ctx => {
    const ui = signal<{ expanded: boolean; value: SerializedValue | null; error: string | null }>({
        expanded: false,
        value: null,
        error: null,
    });

    function refetch(id: number) {
        // Effects don't have a serializable value — skip the request
        // and show a friendly placeholder so the row still expands.
        if (ctx.props.rec.kind === 'effect') {
            ui.$set({ expanded: true, value: null, error: 'effects have no value' });
            return;
        }
        panel().connection
            .request<SerializedValue>({ t: 'get:reactive-value', payload: { reactiveId: id } })
            .then(value => {
                if (ui.expanded) ui.$set({ expanded: true, value, error: null });
            })
            .catch(err => {
                if (ui.expanded) ui.$set({ expanded: true, value: null, error: (err as Error).message });
            });
    }

    // Re-fetch when the underlying record's updateCount changes AND
    // the row is currently expanded. The expanded flag gates work so
    // collapsed rows don't generate wire traffic.
    effect(() => {
        const expanded = ui.expanded;
        // Track the counter so this effect re-runs on each update.
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        ctx.props.rec.updateCount;
        if (expanded) refetch(ctx.props.rec.id);
    });

    return () => {
        const r = ctx.props.rec;
        const flash = r.lastUpdatedAt !== null && (Date.now() - r.lastUpdatedAt) < 500;
        return (
            <div style={{
                borderRadius: '2px',
                background: flash ? 'var(--row-active)' : 'transparent',
                transition: 'background 200ms',
            }}>
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'auto auto 80px 1fr auto',
                        gap: '8px',
                        alignItems: 'baseline',
                        padding: '2px 4px',
                        cursor: 'pointer',
                    }}
                    onClick={() => {
                        const next = !ui.expanded;
                        ui.$set({ expanded: next, value: ui.value, error: ui.error });
                        if (next) refetch(r.id);
                    }}
                >
                    <span style={{ width: '10px', opacity: 0.6 }}>{ui.expanded ? '▼' : '▶'}</span>
                    <span style={{ opacity: 0.5 }}>#{r.id}</span>
                    <span style={{ color: KIND_COLOR[r.kind] }}>{KIND_LABEL[r.kind]}</span>
                    <span style={{ opacity: 0.6 }}>{r.updateCount} {r.kind === 'effect' ? 'runs' : 'updates'}</span>
                    <span style={{ opacity: 0.5 }}>{formatAgo(r.lastUpdatedAt)}</span>
                </div>
                {ui.expanded && (
                    <div style={{ paddingLeft: '32px', paddingTop: '2px', paddingBottom: '4px' }}>
                        {ui.error
                            ? <span style={{ opacity: 0.6, fontStyle: 'italic' }}>{ui.error}</span>
                            : ui.value
                                ? <SerializedValueView value={ui.value} />
                                : <span style={{ opacity: 0.5 }}>loading…</span>}
                    </div>
                )}
            </div>
        );
    };
});

export const ReactivesView = component<{ componentId: ComponentId | null }>(ctx => {
    const lastSeed = signal({ id: -1 as ComponentId });

    effect(() => {
        const id = ctx.props.componentId;
        if (id === null) return;
        if (lastSeed.id === id) return;
        lastSeed.id = id;
        panel().connection
            .request<ReactivePrimitive[]>({ t: 'get:reactives', payload: { componentId: id } })
            .then(records => {
                if (Array.isArray(records)) panel().reactives.seed(records);
            })
            .catch(() => { /* component may have unmounted; ignore */ });
    });

    return () => {
        const id = ctx.props.componentId;
        if (id === null) return null;
        const list = panel().reactives.forComponent(id);
        return (
            <div>
                <div style={{ fontWeight: 'bold', margin: '12px 0 4px' }}>reactives</div>
                {list.length === 0
                    ? <div style={{ opacity: 0.6 }}>no signals/effects/computeds owned by this component</div>
                    : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            {list.map(r => <Row rec={r} />)}
                        </div>
                    )}
            </div>
        );
    };
});
