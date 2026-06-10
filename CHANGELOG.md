# Changelog

All notable changes to packages in this repo are documented here.

## [Unreleased]

### Changed

- `@sigx/devtools`: stores are now discovered automatically through the core
  inspection registry (`@sigx/runtime-core/inspect`, core 0.5.0) instead of
  duck-typing per-store handles — the `stores` option is replaced by
  `includeStores` (default `true`), and stores created after the plugin
  installs are observed too. Requires `@sigx/runtime-core` ^0.5.0. (#6)

### Added

- `store:event` wire event — store custom events (`defineEvents`) are now
  forwarded to the panel. Additive to protocol v1. (#6)
- Initial extraction from `signalxjs/core` to its own repo.
- `@sigx/devtools` page-side plugin: component tree, reactivity registry, store + router observers, postMessage and WebSocket transports, configurable throttling, reactivity opt-out.
- `sigx-devtools-extension`: Chrome/Edge MV3 extension with component tree, props inspector, per-component reactives view, activity timeline.
- `sigx-devtools-inspector`: Node CLI + standalone panel for non-browser hosts (Lynx, terminal, Node).
- Browse signal/computed values via `get:reactive-value`, with auto-refresh on update.
