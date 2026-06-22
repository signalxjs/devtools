/**
 * Top bar — shows connection state to the inspected page.
 */

import { component } from 'sigx';
import { panel } from '../context';

const COLORS = {
    connecting: '#d97706',
    connected: '#16a34a',
    disconnected: '#dc2626',
};

const LABELS = {
    connecting: 'Connecting…',
    connected: 'Connected',
    disconnected: 'Disconnected',
};

export const ConnectionStatus = component(() => {
    return () => {
        const status = panel().connection.status.value;
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 12px',
                borderBottom: '1px solid var(--line)',
                fontSize: '11px',
            }}>
                <span style={{
                    display: 'inline-block',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: COLORS[status],
                }} />
                <span>{LABELS[status]}</span>
                {status !== 'connected' && (
                    <button
                        style={{ marginLeft: 'auto', fontSize: '11px' }}
                        onClick={() => panel().connection.reconnect()}
                    >Reconnect</button>
                )}
            </div>
        );
    };
});
