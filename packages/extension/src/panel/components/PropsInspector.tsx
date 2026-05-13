/**
 * Right pane — shows the selected component's props.
 *
 * Lazily resolves the `propsRef` from the page-side value table via
 * `get:value`. The page side only materializes a serialized snapshot
 * when we ask, so opening the panel doesn't force every mounted
 * component's props onto the wire.
 */

import { component, signal, effect } from 'sigx';
import type { ComponentNode, SerializedValue, ValueRef } from '@sigx/devtools';
import { panel } from '../context';
import { SerializedValueView } from './SerializedValueView';
import { ReactivesView } from './ReactivesView';

interface Props {
    node: ComponentNode | null;
}

export const PropsInspector = component<{ node: ComponentNode | null }>(ctx => {
    const value = signal<{ ref: ValueRef | null; result: SerializedValue | null; error: string | null }>(
        { ref: null, result: null, error: null }
    );

    effect(() => {
        const node = ctx.props.node;
        const ref = node?.propsRef ?? null;
        if (ref === null) {
            value.$set({ ref: null, result: null, error: null });
            return;
        }
        if (value.ref === ref) return;
        value.$set({ ref, result: null, error: null });
        panel().connection
            .request<SerializedValue>({ t: 'get:value', payload: { ref } })
            .then(res => {
                if (value.ref === ref) value.result = res;
            })
            .catch(err => {
                if (value.ref === ref) value.error = (err as Error).message;
            });
    });

    return () => {
        const node = ctx.props.node;
        if (!node) {
            return (
                <div style={{ padding: '12px', opacity: 0.6 }}>
                    Select a component to inspect its props.
                </div>
            );
        }
        return (
            <div style={{ padding: '12px', overflow: 'auto', height: '100%', boxSizing: 'border-box' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>{node.name}</div>
                <div style={{ opacity: 0.6, marginBottom: '12px' }}>id: {node.id}</div>
                <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>props</div>
                {node.propsRef === null
                    ? <div style={{ opacity: 0.6 }}>no props</div>
                    : value.error
                        ? <div style={{ color: 'crimson' }}>error: {value.error}</div>
                        : value.result
                            ? <SerializedValueView value={value.result} />
                            : <div style={{ opacity: 0.6 }}>loading…</div>}
                <ReactivesView componentId={node.id} />
            </div>
        );
    };
});
