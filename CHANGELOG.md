# Changelog

All notable changes to packages in this repo are documented here.

## [Unreleased]

### Added

- Initial extraction from `signalxjs/core` to its own repo.
- `@sigx/devtools` page-side plugin: component tree, reactivity registry, store + router observers, postMessage and WebSocket transports, configurable throttling, reactivity opt-out.
- `sigx-devtools-extension`: Chrome/Edge MV3 extension with component tree, props inspector, per-component reactives view, activity timeline.
- `sigx-devtools-inspector`: Node CLI + standalone panel for non-browser hosts (Lynx, terminal, Node).
- Browse signal/computed values via `get:reactive-value`, with auto-refresh on update.
