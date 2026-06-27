---
name: openalice-watch
description: >-
  Use when working in the OpenAlice root CLI/watch workspace for A-share
  watch/research, scheduled market reports, RSS/news archive tasks, Onlyne
  report routing, OpenAlice backend lifecycle, and notes_and_reports output
  conventions. Prefer OpenAlice Pi extension tools and avoid alice-uta unless
  explicitly requested.
---

# OpenAlice Watch Mode

Use this skill when working in OpenAlice root CLI mode for market/news/analysis/watch tasks.

## Tool routing

Prefer the Pi extension tools registered by `.pi/extensions/openalice.ts`; they inject `OPENALICE_MCP_URL` and `AQ_WS_ID=openalice-core` automatically, so agents do not need PATH shims or shell env prefixes.

- `openalice_alice({ args })` — RSS archive, market search, bar-source search, quant calculations, calculator.
  - Examples: `args: ["rss", "grep", "半导体"]`, `args: ["market", "search", "半导体"]`, `args: ["analysis", "search-bars", "000001"]`.
- `openalice_traderhub({ args })` — low-frequency market/fundamental/macro/reference data.
  - Examples: `args: ["board", "rotation"]`, `args: ["equity", "profile", "000001"]`, `args: ["etf", "search", "半导体"]`.
- `openalice_watch_cli({ args })` — watch-mode CLI operations such as RSS source management.
  - Examples: `args: ["rss", "list"]`, `args: ["rss", "enable", "<id>"]`.
- `openalice_workspace({ args })` — current root workspace operations such as `track add/search`.
  - Examples: `args: ["track", "search", "示例标的"]`, `args: ["track", "add", "000001", "示例标的"]`.
- Use the configured Pi MCP adapter for OpenAlice tools when schemas/tool calls are more reliable than CLI-style argv.
- Do not use `alice-uta` in watch mode unless the user explicitly switches modes.

If extension tools are unavailable after editing the extension, restart the Pi session. Until then, direct shell fallback is:

```bash
OPENALICE_MCP_URL=http://127.0.0.1:47332/mcp AQ_WS_ID=openalice-core node src/workspaces/cli/bin/alice --help
OPENALICE_MCP_URL=http://127.0.0.1:47332/mcp AQ_WS_ID=openalice-core node src/workspaces/cli/bin/traderhub --help
```

Do not report `alice`/`traderhub` as unavailable solely because `command -v alice` is empty; the repo shims are intentionally workspace-local.

## Backend lifecycle

The project extension auto-starts OpenAlice on Pi session start.

Useful commands:

```text
/openalice status
/openalice start
```

Logs are written to `logs/openalice-watch.log`. Do not ingest the whole log; inspect only targeted tails/errors when debugging.

## Watch workflow

- Interpret market requests through an A-share/watchlist lens unless the user says otherwise.
- For watch objects, prefer `alice-workspace track add/search` before creating new storage.
- For heartbeat/digest tasks, use Pi schedule-prompt infrastructure.
- For deterministic long-running local watchers, use `openalice_watch_daemon({ action: "status" | "start" | "reload" | "stop" })`; scripts are declared in `config/watch-daemon.json` and own their own business logic/Onlyne loopback notifications. Watcher scripts must keep recoverable/idempotent state such as pid/lock files, cooldowns, last-seen markers, and durable offsets so they can resume safely after Pi exits, crashes, or `pi -c` restarts.
- For notifications and IM routing, use Onlyne.
- Complex custom alert/event delivery should go through Onlyne loopback inside the watched script, not through LLM or `alice-uta`.

## Notes and reports

Use `notes_and_reports/金融/` and `notes_and_reports/量化/` for durable market notes, daily reports, scheduled report outputs, autoresearch logs, market observation records, and loose scratch thoughts. Prefer dated Markdown files, e.g. `notes_and_reports/金融/2026-06-24-daily-report.md`.

## RSS workflow

- Search archive with `openalice_alice({ args: ["rss", "grep", "<query>"] })` or `openalice_alice({ args: ["rss", "glob", "<pattern>"] })`.
- Read specific items with `openalice_alice({ args: ["rss", "read", "<id>"] })`.
- Manage RSS sources with `openalice_watch_cli({ args: ["rss", "list|add|remove|enable|disable", ...] })`; do not edit config files directly.
