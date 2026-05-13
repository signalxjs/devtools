#!/usr/bin/env node
// Entry point for the `sigx-devtools-inspector` CLI. Just hands off
// to the compiled server module — kept tiny so `node` startup is fast.
import('../dist-server/index.js').catch(err => {
    console.error('[sigx-devtools-inspector] failed to start:', err);
    process.exit(1);
});
