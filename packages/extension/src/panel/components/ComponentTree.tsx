/**
 * Left pane — recursive component tree.
 *
 * Each node renders its name + id, indented by depth. Clicking a row
 * selects it; selection drives the right-side inspector. Expand/collapse
 * is per-id and persists across re-renders for the lifetime of the
 * tree component (which is the lifetime of the panel).
 */

import { component, signal } from 'sigx';
import type { ComponentId, ComponentNode } from '@sigx/devtools';
import { panel } from '../context';

interface RowProps {
    node: ComponentNode;
    depth: number;
    selected: ComponentId | null;
    onSelect: (id: ComponentId) => void;
    expanded: Set<ComponentId>;
    onToggle: (id: ComponentId) => void;
}

const TreeRow = component<{
    node: ComponentNode;
    depth: number;
    selected: ComponentId | null;
    onSelect: (id: ComponentId) => void;
    expanded: Set<ComponentId>;
    onToggle: (id: ComponentId) => void;
}>(ctx => {
    return () => {
        const { node, depth, selected, onSelect, expanded, onToggle } = ctx.props;
        const children = panel().tree.childrenOf(node.id);
        const isOpen = expanded.has(node.id);
        const isSelected = selected === node.id;
        return (
            <>
                <div
                    style={{
                        padding: '2px 6px',
                        paddingLeft: `${4 + depth * 14}px`,
                        cursor: 'pointer',
                        background: isSelected ? 'var(--row-active)' : 'transparent',
                        whiteSpace: 'nowrap',
                    }}
                    onClick={() => onSelect(node.id)}
                >
                    {children.length > 0
                        ? (
                            <span
                                style={{ display: 'inline-block', width: '12px', userSelect: 'none' }}
                                onClick={(e: MouseEvent) => { e.stopPropagation(); onToggle(node.id); }}
                            >{isOpen ? '▼' : '▶'}</span>
                        )
                        : <span style={{ display: 'inline-block', width: '12px' }} />}
                    <span style={{ color: 'var(--accent)' }}>{node.name}</span>
                    <span style={{ opacity: 0.5 }}> #{node.id}</span>
                </div>
                {isOpen && children.map(child => (
                    <TreeRow
                        node={child}
                        depth={depth + 1}
                        selected={selected}
                        onSelect={onSelect}
                        expanded={expanded}
                        onToggle={onToggle}
                    />
                ))}
            </>
        );
    };
});

export const ComponentTree = component<{
    selected: ComponentId | null;
    onSelect: (id: ComponentId) => void;
}>(ctx => {
    // `signal(new Set(...))` returns the reactive Set proxy directly.
    // `add` / `delete` go through collection instrumentations which
    // trigger reactivity; `has` reads track the iteration key.
    const expanded = signal(new Set<ComponentId>());

    const toggle = (id: ComponentId) => {
        if (expanded.has(id)) expanded.delete(id);
        else expanded.add(id);
    };

    return () => {
        const roots = panel().tree.childrenOf(null);
        if (roots.length === 0) {
            return (
                <div style={{ padding: '12px', opacity: 0.6 }}>
                    Waiting for a SignalX app to mount on this page…
                </div>
            );
        }
        return (
            <div style={{ padding: '4px 0', overflow: 'auto', height: '100%', boxSizing: 'border-box' }}>
                {roots.map(root => (
                    <TreeRow
                        node={root}
                        depth={0}
                        selected={ctx.props.selected}
                        onSelect={ctx.props.onSelect}
                        expanded={expanded}
                        onToggle={toggle}
                    />
                ))}
            </div>
        );
    };
});
