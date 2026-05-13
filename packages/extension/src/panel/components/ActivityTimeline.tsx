/**
 * Chronological activity feed — store actions, mutations, router navs.
 * Newest entries appear at the top so freshly-fired events are
 * immediately visible without scrolling.
 */

import { component, signal } from 'sigx';
import type { ActivityEntry } from '../state/activity';
import { panel } from '../context';
import { SerializedValueView } from './SerializedValueView';

const ICONS: Record<ActivityEntry['kind'], string> = {
    action: '⚡',
    mutation: '✎',
    nav: '↪',
};

const COLORS: Record<ActivityEntry['kind'], string> = {
    action: '#7c3aed',
    mutation: '#0891b2',
    nav: '#dc2626',
};

function formatTime(at: number): string {
    const d = new Date(at);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
}

const Row = component<{ entry: ActivityEntry }>(ctx => {
    const expanded = signal({ open: false });
    return () => {
        const e = ctx.props.entry;
        const summary = (() => {
            switch (e.kind) {
                case 'action':
                    return `${e.data.storeName}.${e.data.actionName}() — ${e.data.phase}${e.data.durationMs ? ` (${e.data.durationMs.toFixed(1)}ms)` : ''}`;
                case 'mutation':
                    return `${e.data.storeName}.${e.data.key} mutated`;
                case 'nav':
                    return `${e.data.fromPath ?? '(none)'} → ${e.data.toPath}`;
            }
        })();
        return (
            <div style={{ borderBottom: '1px solid var(--line)', padding: '4px 8px' }}>
                <div
                    style={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr', gap: '8px', cursor: 'pointer', alignItems: 'baseline' }}
                    onClick={() => { expanded.open = !expanded.open; }}
                >
                    <span style={{ color: COLORS[e.kind], width: '14px', textAlign: 'center' }}>{ICONS[e.kind]}</span>
                    <span style={{ opacity: 0.5, fontVariantNumeric: 'tabular-nums' }}>{formatTime(e.at)}</span>
                    <span>{summary}</span>
                </div>
                {expanded.open && (
                    <div style={{ paddingLeft: '30px', paddingTop: '4px', opacity: 0.85 }}>
                        {e.kind === 'action' && (
                            <>
                                <div><span style={{ opacity: 0.6 }}>args:</span> <SerializedValueView value={e.data.args} /></div>
                                {e.data.result !== undefined && (
                                    <div><span style={{ opacity: 0.6 }}>result:</span> <SerializedValueView value={e.data.result} /></div>
                                )}
                                {e.data.error !== undefined && (
                                    <div style={{ color: 'crimson' }}>
                                        <span style={{ opacity: 0.6 }}>error:</span> <SerializedValueView value={e.data.error} />
                                    </div>
                                )}
                            </>
                        )}
                        {e.kind === 'mutation' && (
                            <div><span style={{ opacity: 0.6 }}>value:</span> <SerializedValueView value={e.data.value} /></div>
                        )}
                        {e.kind === 'nav' && (
                            <>
                                <div><span style={{ opacity: 0.6 }}>params:</span> <SerializedValueView value={e.data.params} /></div>
                                <div><span style={{ opacity: 0.6 }}>query:</span> <SerializedValueView value={e.data.query} /></div>
                            </>
                        )}
                    </div>
                )}
            </div>
        );
    };
});

export const ActivityTimeline = component(() => {
    return () => {
        const entries = panel().activity.entries.value;
        if (entries.length === 0) {
            return (
                <div style={{ padding: '12px', opacity: 0.6 }}>
                    No activity yet. Dispatch a store action or navigate to see events here.
                </div>
            );
        }
        // Newest first — copy to avoid mutating the store's array
        const reversed = entries.slice().reverse();
        return (
            <div style={{ overflow: 'auto', height: '100%' }}>
                <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                    <span style={{ opacity: 0.7 }}>{entries.length} event{entries.length === 1 ? '' : 's'}</span>
                    <button
                        style={{ marginLeft: 'auto', fontSize: '11px' }}
                        onClick={() => panel().activity.clear()}
                    >Clear</button>
                </div>
                {reversed.map(entry => <Row entry={entry} />)}
            </div>
        );
    };
});
