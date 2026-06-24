# OpenAlice Watch Mode

Use this skill when working in OpenAlice root CLI mode for market/news/analysis/watch tasks.

## Tool routing

- Use `alice` for RSS archive, market search, bar-source search, quant calculations, and calculator work.
- Use `traderhub` for low-frequency market/fundamental/macro/reference data.
- Use `alice-workspace track add/search` for watch objects and durable tracked entities. This root mode uses `AQ_WS_ID=openalice-core`.
- Use the configured Pi MCP adapter for OpenAlice tools when schemas/tool calls are more reliable than shell commands.
- Do not use `alice-uta` in watch mode unless the user explicitly switches modes.

## Backend lifecycle

The project extension auto-starts OpenAlice on Pi session start.

Useful commands:

```text
/openalice status
/openalice start
```

Logs are written to `logs/openalice-watch.log`. Do not ask the model to ingest the whole log; inspect only targeted tails/errors when debugging.

## Watch workflow

- Interpret market requests through an A-share/watchlist lens unless the user says otherwise.
- For watch objects, prefer `alice-workspace track add/search` before creating new storage.
- For heartbeat/digest tasks, use Pi schedule-prompt infrastructure.
- For notifications and IM routing, use Onlyne.
- Complex custom alert/event delivery should go through Onlyne loopback rather than OpenAlice-owned automation.

## RSS workflow

- Search archive with `alice rss grep` or `alice rss glob`.
- Read specific items with `alice rss read`.
- RSS source add/remove/enable/disable should use the OpenAlice-owned RSS source management CLI/tool once available; do not edit config files directly.
