/**
 * Recursive renderer for the protocol's SerializedValue type.
 *
 * The format mirrors the JS type tree: primitive, undefined, bigint,
 * symbol, function, array, object, plus the bookkeeping markers
 * `circular` and `truncated`. Each rendered value is collapsible —
 * the panel doesn't try to lay out a deep object eagerly.
 */

import { component, signal } from 'sigx';
import type { SerializedValue } from '@sigx/devtools';

interface ValueProps {
    value: SerializedValue;
}

const KEY_COLOR = '#7a3e9d';
const STRING_COLOR = '#a31515';
const NUMBER_COLOR = '#098658';
const KEYWORD_COLOR = '#0000ff';

export const SerializedValueView = component<{ value: SerializedValue }>(ctx => {
    const expanded = signal(false);

    return () => {
        const v = ctx.props.value;
        switch (v.kind) {
            case 'undefined':
                return <span style={{ color: KEYWORD_COLOR, opacity: 0.7 }}>undefined</span>;
            case 'primitive':
                if (v.value === null) {
                    return <span style={{ color: KEYWORD_COLOR }}>null</span>;
                }
                if (typeof v.value === 'string') {
                    return <span style={{ color: STRING_COLOR }}>"{v.value}"</span>;
                }
                if (typeof v.value === 'boolean') {
                    return <span style={{ color: KEYWORD_COLOR }}>{String(v.value)}</span>;
                }
                return <span style={{ color: NUMBER_COLOR }}>{String(v.value)}</span>;
            case 'bigint':
                return <span style={{ color: NUMBER_COLOR }}>{v.value}n</span>;
            case 'symbol':
                return <span style={{ color: KEYWORD_COLOR }}>Symbol({v.description})</span>;
            case 'function':
                return <span style={{ color: KEYWORD_COLOR }}>ƒ {v.name}()</span>;
            case 'circular':
                return <span style={{ opacity: 0.6 }}>[circular]</span>;
            case 'truncated':
                return <span style={{ opacity: 0.6 }}>[truncated: {v.reason}]</span>;
            case 'array': {
                const summary = `Array(${v.length})`;
                if (!expanded.value) {
                    return (
                        <span style={{ cursor: 'pointer' }} onClick={() => { expanded.value = true; }}>
                            ▶ <span style={{ opacity: 0.7 }}>{summary}</span>
                        </span>
                    );
                }
                return (
                    <span>
                        <span style={{ cursor: 'pointer' }} onClick={() => { expanded.value = false; }}>
                            ▼ <span style={{ opacity: 0.7 }}>{summary}</span>
                        </span>
                        <div style={{ paddingLeft: '16px' }}>
                            {v.entries.map(([idx, child]) => (
                                <div>
                                    <span style={{ color: KEY_COLOR }}>{idx}</span>: <SerializedValueView value={child} />
                                </div>
                            ))}
                            {v.entries.length < v.length && (
                                <div style={{ opacity: 0.6 }}>… {v.length - v.entries.length} more</div>
                            )}
                        </div>
                    </span>
                );
            }
            case 'object': {
                const summary = v.typeName === 'Object' ? 'Object' : v.typeName;
                if (!expanded.value) {
                    return (
                        <span style={{ cursor: 'pointer' }} onClick={() => { expanded.value = true; }}>
                            ▶ <span style={{ opacity: 0.7 }}>{summary}</span>
                            {v.entries.length > 0 && (
                                <span style={{ opacity: 0.5 }}> {'{'}{v.entries.length}{'}'}</span>
                            )}
                        </span>
                    );
                }
                return (
                    <span>
                        <span style={{ cursor: 'pointer' }} onClick={() => { expanded.value = false; }}>
                            ▼ <span style={{ opacity: 0.7 }}>{summary}</span>
                        </span>
                        <div style={{ paddingLeft: '16px' }}>
                            {v.entries.map(([key, child]) => (
                                <div>
                                    <span style={{ color: KEY_COLOR }}>{key}</span>: <SerializedValueView value={child} />
                                </div>
                            ))}
                        </div>
                    </span>
                );
            }
        }
    };
});
