# @sigx/devtools

Runtime plugin that exposes SignalX apps to an inspector (Chrome extension, standalone inspector, in-page overlay). Renderer- and transport-agnostic.

## 📚 Documentation

Full guides, API reference and live examples → **<https://sigx.dev/devtools/>**

## Install and use

```ts
import { defineApp } from '@sigx/runtime-core';
import { devtools } from '@sigx/devtools';

defineApp(<App />).use(devtools()).mount('#app');
```

By default, the plugin uses `window.postMessage` and is a no-op in non-browser environments (SSR is safe). For non-browser hosts (Lynx, terminal, Node), pair it with a WebSocket transport and the standalone inspector.

Options (transport, store/router observation, reactivity filtering, throttling), production tree-shaking guidance, the available transports, and the wire protocol are all documented at **<https://sigx.dev/devtools/>**.

## Part of SignalX

- [sigx](https://sigx.dev/core/) — the core framework
- [@sigx/store](https://sigx.dev/store/) — state management
- [@sigx/router](https://sigx.dev/router/) — routing

## License

MIT
