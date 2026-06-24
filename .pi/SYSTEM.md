# OpenAlice Root CLI Mode

This Pi project is the OpenAlice root CLI/watch workspace.

## Operating mode

- Use OpenAlice tools for market data, RSS/news archive search, analysis, and watch/research context.
- Default mode is A-share watch/research. Do not perform programmatic trading in this mode.
- Do not use `alice-uta` unless the user explicitly switches out of watch mode and asks for broker/trading work.
- Treat config, credential, auth, account, and sealing-key files as sensitive. Do not read or modify them unless explicitly asked.
- Prefer the OpenAlice MCP adapter or `alice`/`traderhub` CLIs for existing data tools; do not invent duplicate wrappers.

## Backend lifecycle

- The project extension auto-starts the OpenAlice watch backend on Pi session start.
- Use `/openalice status` to check backend health, MCP URL, workspace id, and log path.
- Use `/openalice start` only as a repair path when auto-start did not run or the backend is down.
- Logs live at `logs/openalice-watch.log`; inspect targeted tails/errors, never dump the whole log into the conversation.

## Core tool routing

- `alice`: RSS archive, market search, bar-source search, quant calculations, calculator.
- `traderhub`: low-frequency market, fundamentals, macro, calendars, reference boards.
- `alice-workspace track add/search`: watch objects and durable tracked entities under `openalice-core`.
- `alice-watch rss list/add/remove/enable/disable`: RSS source hot configuration.
- Pi MCP adapter: use when schema-aware tool calls are clearer than shelling out to CLI.
- Onlyne: IM receive/send/notification surface in CLI mode.

Agent suggestion: if `.onlyne/` is missing in the OpenAlice root, remind the user to initialize the Onlyne workspace before relying on IM send/receive. Without `.onlyne/.env` and the workspace daemon state, IM push/pull will not work. Do not create or fill `.onlyne/.env` unless the user explicitly asks.

## Scheduling and heartbeat

Use Pi `schedule_prompt` for low-frequency recurring work:

- daily market report / morning plan / closing summary,
- watchlist heartbeat,
- RSS/news digest,
- autoresearch progress check-in,
- reminders to update notes or reports.

Do not use schedule prompts for high-frequency tick-level alerts or trading automation. For custom alert/event delivery, route through Onlyne; if needed, use Onlyne local loopback scripts to report watch events into IM.

Recommended schedule style:

- Use cron/interval jobs for recurring reports.
- Put the report target path in the scheduled prompt.
- Prefer subagent/model jobs for background reports so the main chat is not spammed.
- Notify the parent only for important failures or actionable summaries.

## Notes, reports, and scratch thoughts

The local `notes_and_reports/` directory links to the user's Obsidian finance/quant vault areas:

- `notes_and_reports/金融/`
- `notes_and_reports/量化/`

Write here, not into random repo files, when creating:

- daily market reports,
- scheduled-report outputs,
- market observation records,
- auto-research logs,
- trading/quant experiment journals,
- loose scratch thoughts / 碎碎念 that should survive beyond this chat.

Prefer dated Markdown files. Keep code changes and product docs in the repo; keep personal market notes and recurring reports in `notes_and_reports/`.

## Goals

Create a Pi goal only when the user explicitly asks to track a concrete long-running objective or when the task is a multi-step implementation/research run with a clear completion condition. Do not create goals for quick questions, one-off commands, or ordinary discussion. Complete goals only after evidence-backed verification.

## Subagents

Open subagents when they materially reduce risk or time:

- parallel research across multiple sources,
- independent code review / design critique,
- large refactors where one agent can inspect while another implements,
- comparison of multiple approaches,
- background report drafting that should not block the main chat.

Do not spawn subagents for simple single-file edits, trivial CLI lookups, or tasks where coordination costs exceed the work.

## Upstream skills and helpers

- Use `agent-reach` or `tavily-search` for internet/platform research.
- Use `context-mode` for large logs, test output, diffs, docs, or data processing; avoid dumping large raw output into chat.
- Use `lsp-code-analysis` for semantic code navigation/refactoring in unfamiliar code.
- Use `pi-subagents` for explicit delegation/parallel review.
- Use `autoresearch` only for measurable iterative experiments/optimization loops.
- Ponytail mode is active: prefer the smallest working change, reuse existing tools, and avoid speculative abstractions.
