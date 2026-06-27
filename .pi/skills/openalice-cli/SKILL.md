---
name: openalice-cli
description: >-
  Use OpenAlice Pi extension tools for market/RSS/analysis/watch CLI
  capabilities: openalice_alice, openalice_traderhub, openalice_watch_cli,
  and openalice_workspace. Activate for OpenAlice CLI usage, RSS archive
  search, traderhub fundamentals/macro/reference data, watch-mode RSS source
  management, and tracked watch entities in the root CLI/watch workspace.
---

# OpenAlice CLI Tools

Use this skill when an agent needs OpenAlice market/RSS/analysis/watch CLI capabilities from Pi.

## Prefer extension tools

The project extension `.pi/extensions/openalice.ts` registers these Pi tools:

- `openalice_alice({ args, timeoutMs? })`
  - RSS archive, market search, bar source search, quant calculations, calculator.
  - Examples:
    - `args: ["rss", "grep", "半导体"]`
    - `args: ["rss", "read", "<id>"]`
    - `args: ["market", "search", "示例标的"]`
    - `args: ["analysis", "search-bars", "000001"]`
    - `args: ["analysis", "quant", ...]`
    - `args: ["think", "calc", "(12.3-10.0)*1000"]`

- `openalice_traderhub({ args, timeoutMs? })`
  - Low-frequency market, fundamentals, macro, calendars, reference boards.
  - Examples:
    - `args: ["board", "rotation"]`
    - `args: ["equity", "profile", "000001"]`
    - `args: ["equity", "ratios", "000001"]`
    - `args: ["etf", "search", "半导体"]`
    - `args: ["index", "search", "科创50"]`

- `openalice_watch_cli({ args, timeoutMs? })`
  - Watch-mode operations, especially RSS source hot configuration.
  - Examples:
    - `args: ["rss", "list"]`
    - `args: ["rss", "add", "<url>"]`
    - `args: ["rss", "enable", "<id>"]`
    - `args: ["rss", "disable", "<id>"]`

- `openalice_workspace({ args, timeoutMs? })`
  - Current root workspace operations such as tracked entities.
  - Examples:
    - `args: ["track", "search", "示例标的"]`
    - `args: ["track", "add", "000001", "示例标的"]`

These tools inject:

```text
OPENALICE_MCP_URL=http://127.0.0.1:47332/mcp
AQ_WS_ID=openalice-core
OPENALICE_MODE=watch
```

Do not shell out to bare `alice` / `traderhub`; they are intentionally not global PATH binaries in this root Pi mode.

## Fallback if extension tools are not loaded yet

Restart the Pi session after editing `.pi/extensions/openalice.ts`. Until restart, direct shell fallback is:

```bash
OPENALICE_MCP_URL=http://127.0.0.1:47332/mcp AQ_WS_ID=openalice-core node src/workspaces/cli/bin/alice --help
OPENALICE_MCP_URL=http://127.0.0.1:47332/mcp AQ_WS_ID=openalice-core node src/workspaces/cli/bin/traderhub --help
OPENALICE_MCP_URL=http://127.0.0.1:47332/mcp AQ_WS_ID=openalice-core node src/workspaces/cli/bin/alice-watch --help
OPENALICE_MCP_URL=http://127.0.0.1:47332/mcp AQ_WS_ID=openalice-core node src/workspaces/cli/bin/alice-workspace --help
```

Only if both extension tools and direct shims fail should the agent fall back to `a-stock-data` / Tencent / Eastmoney direct calls.

## Watch-mode boundary

Do not use `alice-uta` unless the user explicitly switches out of watch mode and requests broker/trading work.
