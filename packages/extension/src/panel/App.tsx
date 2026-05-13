/**
 * Panel root — connection status, tab bar, and the active tab body.
 *
 * Two tabs in v0:
 *   - Components: tree on the left, props/reactives inspector on the right.
 *   - Activity:   chronological feed of store actions + mutations + nav.
 */

import { component, signal } from 'sigx';
import type { ComponentId } from '@sigx/devtools';
import { ConnectionStatus } from './components/ConnectionStatus';
import { ComponentTree } from './components/ComponentTree';
import { PropsInspector } from './components/PropsInspector';
import { ActivityTimeline } from './components/ActivityTimeline';
import { panel } from './context';

type Tab = 'components' | 'activity';

const TAB_LABEL: Record<Tab, string> = {
    components: 'Components',
    activity: 'Activity',
};

const ComponentsView = component<{
    selected: ComponentId | null;
    onSelect: (id: ComponentId) => void;
}>(ctx => {
    return () => {
        const selId = ctx.props.selected;
        const node = selId === null ? null : panel().tree.nodes.value.get(selId) ?? null;
        return (
            <div style={{ display: 'flex', flex: '1 1 auto', minHeight: 0 }}>
                <div style={{ flex: '0 0 40%', borderRight: '1px solid var(--line)', minHeight: 0 }}>
                    <ComponentTree selected={selId} onSelect={ctx.props.onSelect} />
                </div>
                <div style={{ flex: '1 1 auto', minHeight: 0 }}>
                    <PropsInspector node={node} />
                </div>
            </div>
        );
    };
});

const TabBar = component<{ active: Tab; onSelect: (tab: Tab) => void }>(ctx => {
    return () => (
        <div style={{ display: 'flex', borderBottom: '1px solid var(--line)' }}>
            {(['components', 'activity'] as Tab[]).map(tab => {
                const isActive = ctx.props.active === tab;
                return (
                    <button
                        onClick={() => ctx.props.onSelect(tab)}
                        style={{
                            border: 'none',
                            borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                            background: 'transparent',
                            color: 'inherit',
                            padding: '6px 14px',
                            cursor: 'pointer',
                            font: 'inherit',
                            opacity: isActive ? 1 : 0.6,
                        }}
                    >{TAB_LABEL[tab]}</button>
                );
            })}
        </div>
    );
});

export const App = component(() => {
    const tab = signal({ value: 'components' as Tab });
    const selected = signal({ id: null as ComponentId | null });

    return () => (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
            <ConnectionStatus />
            <TabBar active={tab.value} onSelect={t => { tab.value = t; }} />
            {tab.value === 'components'
                ? <ComponentsView selected={selected.id} onSelect={(id) => { selected.id = id; }} />
                : <div style={{ flex: '1 1 auto', minHeight: 0 }}><ActivityTimeline /></div>}
        </div>
    );
});
