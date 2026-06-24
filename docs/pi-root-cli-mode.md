# Pi Root CLI Mode Plan

Status: implementation plan, finalized for implementation in the 2026-06 CLI-mode design discussion.

## Decision

OpenAlice will support a **root Pi CLI mode**: run `pi` from the OpenAlice repo root and use OpenAlice as a local market/news/analysis context service.

This is a different product shape from the Web UI workspace launcher:

- Pi is the chat interface.
- OpenAlice backend supplies tools over the existing `alice*` CLI gateway.
- The OpenAlice repo root is the Pi project/workspace.
- No Web UI is required.
- No programmatic trading is required for the A-share watchlist use case.
- Heartbeat belongs in Pi's schedule-prompt/plugin layer, not OpenAlice cron for the first version.
- Notifications and IM routing belong to Onlyne in CLI mode.
- Local safety is handled by the user's global Pi setup (Landstrip + sandbox policy), not duplicated in OpenAlice.
- MCP access can use the user's `pi-mcp-adapter` against OpenAlice's local MCP server.

The goal is **chat + watch + research**, not autonomous broker execution.

## Product profile

Introduce a watch-oriented mode:

```bash
OPENALICE_MODE=watch
```

Expected behavior:

| Capability | Watch mode default |
|---|---|
| Alice backend / MCP / CLI gateway | on |
| Vite Web UI | off |
| UTA service | off |
| `alice` CLI | on |
| `traderhub` CLI | on |
| `alice-workspace` CLI | optional, mainly `track` if reused as watchlist/entity store |
| `alice-uta` CLI | hidden / not taught to Pi |
| OpenAlice cron | off; use Pi schedule-prompt/plugin layer for heartbeat |
| Onlyne IM | on through user's Pi/global tooling, not OpenAlice |
| pi-mcp-adapter | optional direct MCP access to OpenAlice tools |
| Workspace isolation | off; root repo is the Pi project |

Implementation can start with boolean flags derived from the mode:

```ts
const mode = process.env['OPENALICE_MODE'] ?? 'full';
const noUi = mode === 'cli' || mode === 'watch' || process.env['OPENALICE_NO_UI'] === '1';
const noUta = mode === 'watch' || process.env['OPENALICE_NO_UTA'] === '1';
```

Keep this boring. Do not build a large profile framework until a second real profile needs it.

## Existing CLI tool surface

The current CLI surface lives in `src/server/cli-commands.ts`.

### Keep for watch mode

`alice`:

```text
alice rss glob
alice rss grep
alice rss read
alice market search
alice analysis search-bars
alice analysis quant
alice think calc
```

`traderhub`:

```text
traderhub board get
traderhub board rotation
traderhub equity profile
traderhub equity financials
traderhub equity ratios
traderhub equity earnings
traderhub equity insiders
traderhub equity short-interest
traderhub equity estimates
traderhub equity discover
traderhub etf search
traderhub etf info
traderhub etf holdings
traderhub etf sectors
traderhub economy fred-search
traderhub economy fred-series
traderhub economy fred-regional
traderhub economy bls-search
traderhub economy bls-series
traderhub economy energy
traderhub economy petroleum
traderhub economy euro-bop
traderhub global cpi
traderhub global rates
traderhub global leading
traderhub global retail
traderhub global house
traderhub global share
traderhub shipping port-search
traderhub shipping port-volume
traderhub shipping chokepoint
traderhub fed documents
traderhub fed balance-sheet
traderhub fed dealers
traderhub crypto options
traderhub crypto futures
traderhub index search
```

Optional `alice-workspace` subset:

```text
alice-workspace track add
alice-workspace track search
```

### Hide by default

`alice-uta` should not be in the watch-mode prompt/tool teaching surface or first-pass MCP/tool discovery. It contains broker/account/order operations, including mutations:

```text
alice-uta order place
alice-uta order modify
alice-uta order cancel
alice-uta position close
alice-uta git push
```

For A-share watch mode, programmatic trading is out of scope. Hiding this from Pi is a visibility/policy mask, not a deletion. Keep the UTA/trading product surface available for future US/HK or other programmable-market modes, and rely on missing UTA configuration to make it unavailable unless explicitly configured.

## CLI vs MCP vs Pi extension boundary

There are three viable ways for root Pi to reach OpenAlice:

1. `alice*` CLI commands via shell.
2. OpenAlice MCP via the user's `pi-mcp-adapter`.
3. A small project-local Pi extension for policy/glue.

OpenAlice already exposes a global MCP endpoint at `/mcp` with no workspace id, plus a scoped endpoint at `/mcp/:wsId` for workspace tools. With a root `openalice-core` workspace registered, `pi-mcp-adapter` can use both:

```text
http://127.0.0.1:<mcpPort>/mcp
http://127.0.0.1:<mcpPort>/mcp/openalice-core
```

The existing `alice*` CLI gateway returns MCP text blocks to the shim. Most data tools return one JSON string because `toMcpContent()` stringifies ordinary object results. Practically:

- CLI stdout is usually JSON-shaped text.
- Some tools may return prose/text blocks.
- The Pi model sees all of it as command output when invoked through `bash`.

Use this boundary:

| Surface | Use for | Examples |
|---|---|---|
| CLI + skill instructions | Structured, query-like data retrieval where stdout JSON is fine, especially when command composition is simpler than MCP wiring. | `alice market search`, `alice analysis quant`, `traderhub equity profile`, `traderhub board get`, `traderhub economy ...` |
| OpenAlice MCP via `pi-mcp-adapter` | Same data tools when Pi should see explicit schemas/tool names instead of shell commands. Prefer this if adapter setup is already reliable. | global `/mcp` for market/news/analysis; `/mcp/openalice-core` for scoped entity/workspace tools |
| Project Pi extension tool | Text-heavy or policy-sensitive glue where schema, caps, confirmation, formatting, scheduling integration, or notification behavior matters. | RSS article read/summarize, schedule-prompt heartbeat helper, Onlyne notification helper, RSS source mutation, watchlist mutation if `track` is not enough |
| Masked by default | Trading mutations in watch mode. They may still exist underneath, but should not be first-visible to the agent. | `alice-uta order place`, `alice-uta position close`, `alice-uta git push` |

This means most existing market/fundamental tools should not be re-wrapped manually. Use either CLI+skill or MCP adapter, then reserve the root `.pi` extension for:

1. result shaping for long text,
2. schedule-prompt heartbeat glue,
3. Onlyne notification/message glue if needed,
4. watch-mode mutation policy,
5. small hot config mutations such as RSS sources and watchlist entries.

Do not re-wrap every OpenAlice command as a Pi extension tool. Start with the few commands where raw CLI/MCP output is unpleasant or unsafe.

## Watch-mode trading mask

Use all three layers, but keep them as visibility/policy controls rather than product deletion:

1. **MCP/CLI manifest filter** — default watch-mode discovery should not list trading/UTA tools or the `alice-uta` export. ToolCenter may still contain the underlying tools for other modes.
2. **CLI shim/export guard** — if `alice-uta` is invoked in watch mode, fail with a clear message such as `UTA is disabled in OPENALICE_MODE=watch` instead of silently attempting broker work.
3. **Pi prompt/skill policy** — `.pi/SYSTEM.md` / `.pi/skills/openalice-watch/SKILL.md` should say this mode is A-share watch/research only and should not use `alice-uta` unless the user explicitly switches modes.

This makes trading invisible to the agent by default while preserving the future path for US/HK or other programmable-market modes.

## Root Pi project configuration

Pi should be launched from the OpenAlice repo root:

```bash
cd /path/to/OpenAlice
pi --approve
```

Project-local Pi files should live in the root `.pi/` directory and should be committed as part of the OpenAlice project when they define shared root CLI behavior.

Commit only the shared project pieces. Local memory/sandbox state stays ignored:

```text
.pi/hindsight/
.pi/sandbox.json
.pi/local.*
```

Use Pi-supported files:

```text
.pi/settings.json
.pi/SYSTEM.md
.pi/APPEND_SYSTEM.md
.pi/skills/<skill>/SKILL.md
.pi/extensions/<extension>.ts
```

Do **not** rely on `.pi/AGENTS.md`; Pi project context files are root/ancestor `AGENTS.md` / `CLAUDE.md`, while `.pi/SYSTEM.md` and `.pi/APPEND_SYSTEM.md` are the `.pi` prompt files.

Do not lock down broad `.pi/settings.json` defaults in the first design pass. Root CLI mode will depend on specific Pi settings, but most defaults should be discovered while using the mode and then committed once they are real requirements.

One exception is the OpenAlice daemon connection block: ports and identity should be manually configurable in `.pi/settings.json` with boring defaults, because the extension must know which health URL to check before the backend starts:

```json
{
  "openalice": {
    "webPort": 47331,
    "mcpPort": 47332,
    "workspaceId": "openalice-core",
    "autoStart": true,
    "maxRestarts": 1,
    "logPath": "logs/openalice-watch.log"
  }
}
```

Precedence for the project extension follows the existing Pi extension convention used by plugins such as `pi-rich-renderer`: read settings JSON directly, merge only the extension-owned block, and ignore parse/read failures.

```text
built-in defaults
< ~/.pi/agent/settings.json.openalice
< .pi/settings.json.openalice
< one-off environment overrides
```

This keeps the OpenAlice extension aligned with current Pi plugin practice and avoids requiring a new ExtensionAPI settings accessor. The extension injects the resolved values into `pnpm watch` as `OPENALICE_WEB_PORT`, `OPENALICE_MCP_PORT`, `AQ_WS_ID`, and related env.

Tool-use policy should be mostly prompt/skill-level, not code-level.

Use this split:

```text
.pi/SYSTEM.md
  Short, high-priority mode contract:
  - OpenAlice root CLI mode
  - A-share watch/research, not programmatic trading
  - use OpenAlice tools for market/news/analysis context
  - do not use alice-uta unless the user explicitly switches modes
  - treat config/credential files as sensitive

.pi/skills/openalice-watch/SKILL.md
  Operational playbook:
  - when to use alice vs traderhub vs pi-mcp-adapter
  - common market/news/RSS/analysis workflows
  - how to track watch objects through alice-workspace track
  - how schedule-prompt heartbeat should behave
  - how Onlyne notification/IM flows are used
  - how to inspect backend status through `/openalice status` and where logs are written
```

Keep `.pi/SYSTEM.md` short; put concrete command recipes and evolving behavior in the skill. This keeps code trimming small while still steering the model away from trading surfaces.

## Environment and daemon strategy

The first implementation should be **Pi-session-owned**:

```bash
cd /path/to/OpenAlice
pi --approve
```

Then `.pi/extensions/openalice.ts` owns backend lifecycle for that Pi session:

1. load local env/defaults,
2. check whether OpenAlice MCP is already reachable,
3. start watch backend if needed,
4. wait until MCP is ready,
5. set Pi status/widget,
6. stop the child process on Pi session shutdown if this extension started it.

Do not build a detached daemon in v1. Detached mode needs pid files, stale-pid cleanup, log rotation, and cross-session ownership. Session-owned is enough and avoids orphan processes.

OpenAlice does not currently auto-load `.env`; scripts read `process.env`. The project extension can load `.env` itself and inject env into the child process it spawns. Keep `.env` local and ignored. The repo already ignores:

```gitignore
.env
.env.*
```

Example `.env` for one-off/local overrides:

```env
OPENALICE_MODE=watch
OPENALICE_HOME=/path/to/OpenAlice/workspace/home
AQ_LAUNCHER_ROOT=/path/to/OpenAlice/workspace/launcher
AQ_WS_ID=openalice-core
OPENALICE_WEB_PORT=47331
OPENALICE_MCP_PORT=47332
OPENALICE_MCP_URL=http://127.0.0.1:47332/mcp
PI_CODING_AGENT_DIR=/path/to/OpenAlice/workspace/pi-agent
```

Prefer `.pi/settings.json.openalice` for committed project defaults and `.env`/process env for local overrides.

The extension should provide only two slash commands:

```text
/openalice status
/openalice start
```

Do not add stop/restart commands in v1; the expected path is automatic session startup, and agent-visible kill/restart controls make it too easy for the agent to kill its own backend. Manual startup is the exception path.

It should start long-lived resources from `session_start`, not from the extension factory top level. Pi loads extension factories in contexts that may not start a session; long-lived child processes belong to session lifecycle hooks.

## Required code changes

Keep these minimal.

### 1. Watch/CLI startup mode

Add a CLI/watch startup path to Guardian:

- skip Vite when `OPENALICE_NO_UI=1` or `OPENALICE_MODE=cli|watch`
- skip UTA when `OPENALICE_NO_UTA=1` or `OPENALICE_MODE=watch`
- allow Alice to boot without `OPENALICE_UTA_URL` in no-UTA mode
- mask trading/UTA tools from default MCP/CLI discovery in watch mode, without deleting or unregistering the underlying product surface

### 2. Root pseudo-workspace identity

The `alice*` CLI gateway currently requires a valid `AQ_WS_ID`. Even global exports (`alice`, `traderhub`) are resolved through `/cli/:wsId/:export` and validate that workspace id.

Register a stable root workspace identity:

```json
{
  "id": "openalice-core",
  "tag": "openalice-core",
  "dir": "/path/to/OpenAlice",
  "agents": ["pi"],
  "template": "root"
}
```

This is the chosen v1 approach. It can be automatic when `OPENALICE_MODE=watch` or `OPENALICE_CORE_WORKSPACE_DIR` is set. It should not run template bootstrap, create a child workspace directory, or open a PTY session. `openalice-core` is only an identity/route key for CLI and scoped MCP tools.

Terminal/session multiplexing is outside OpenAlice v1. The user's CLI mode can run under Zellij; if a new terminal is ever needed, use Zellij APIs rather than reviving OpenAlice's PTY workspace pool for root mode.

### 3. Watch startup command

Add a dedicated package script and Guardian entry:

```json
{
  "watch": "tsx scripts/guardian/watch.ts"
}
```

The Pi extension should spawn:

```bash
pnpm watch
```

Do not name this `dev:watch`; `dev` implies development/debug mode. Root Pi CLI mode is a user-facing daemon/watch entry, not the full development stack.

`watch.ts` scope is intentionally small:

1. read/plan ports,
2. set `OPENALICE_MODE=watch`,
3. set `OPENALICE_HOME`, `OPENALICE_WEB_PORT`, `OPENALICE_MCP_PORT`,
4. set `AQ_WS_ID=openalice-core`,
5. set `OPENALICE_CORE_WORKSPACE_DIR` to the repo root,
6. spawn Alice backend,
7. wait for `GET /__health` readiness on the Alice web port,
8. cascade-shutdown Alice on exit.

It should not start UTA, start Vite, watch the UTA restart flag, or open PTY sessions. Reuse `scripts/guardian/shared.ts`; do not copy the full `dev.ts` stack.

### 4. Project-local Pi extension owns backend lifecycle

Add `.pi/extensions/openalice.ts`:

- load `.env` and apply defaults (`OPENALICE_MODE=watch`, `AQ_WS_ID=openalice-core`, etc.)
- check backend readiness via `GET /__health` on the Alice web port
- auto-start the watch backend on Pi `session_start` by default
- honor `OPENALICE_AUTO_START=0` to skip automatic startup
- spawn the watch backend only when needed
- keep the backend session-owned in v1
- automatically restart unexpected backend exits up to `openalice.maxRestarts` times
- write backend stdout/stderr to `logs/openalice-watch.log`
- provide only `/openalice status` and `/openalice start`
- make `/openalice status` report backend state, pid if known, health URL, MCP URL, and log path
- set Pi status/widget so the user can see backend state

The extension is also the right place to inject env for the child backend process. This removes the need for a separate `pi-openalice` wrapper as the primary entrypoint. Auto-start must only run when Pi is launched from the OpenAlice repo root; verify with cheap markers such as `package.json`, `src/main.ts`, and `scripts/guardian/watch.ts`.

Do not pipe backend logs into the Pi conversation. Append them to `logs/openalice-watch.log` with a session marker on startup. Keep the log file in v1; no log rotation yet. `/openalice status` should print the log path so the user can inspect it manually when needed.

Unexpected backend exits should restart automatically up to `openalice.maxRestarts` times. Default `maxRestarts` is `1`; users may raise or lower it in `.pi/settings.json`. Do not build an infinite supervisor loop in v1.

Add a boring health route on the Alice web port:

```text
GET /__health
```

Example response:

```json
{
  "ok": true,
  "mode": "watch",
  "root": "/path/to/OpenAlice",
  "mcp": "http://127.0.0.1:47332/mcp",
  "workspaceId": "openalice-core"
}
```

The Pi extension should wait on `/__health`, not on the MCP protocol endpoint. It should only reuse an existing backend when `mode`, `root`, and `workspaceId` match the current OpenAlice repo root and `openalice-core`; otherwise it should report the mismatch instead of attaching to the wrong checkout. No pid file in v1.

MCP adapter failures can be diagnosed separately through `/openalice status`.

### 5. Prompt/skill policy

Add the root Pi instructions in `.pi/SYSTEM.md` or `.pi/skills/openalice-watch/SKILL.md`.

Do not hard-code every usage rule in TypeScript unless the backend must enforce a safety boundary. For watch mode, hiding `alice-uta` from prompts/default discovery and not starting UTA is enough for the first implementation.

## Mutable configuration surface

Do **not** build a broad `alice-config` CLI first. Most OpenAlice configuration is cold state:

- AI provider credentials
- broker/account config
- ports
- sealing/auth settings
- market-data provider keys

Those can stay in JSON files or a future admin surface because root Pi watch mode should not mutate them often.

The hot configuration surface for watch mode is much smaller:

1. RSS/feed sources — add/remove/list/enable/disable.
2. Watchlist/tracked entities — add/remove/search/update notes.

The existing `alice-workspace track add/search` already covers the v1 watchlist need through `entity_upsert` / `entity_search`. Reuse it. Do not add a dedicated watchlist store in v1.

More complex listener/alert flows can route through Onlyne rather than OpenAlice-owned automation. If needed, add a local Onlyne loopback later so scripts can report custom watch events into the user's normal IM notification surface.

RSS source management is the one hot-config surface that should get a narrow OpenAlice-owned CLI/tool in v1. Do not let the Pi extension edit RSS config files directly; direct file mutation risks runtime/config-state drift.

Keep it narrow and domain-named, not a kitchen-sink config tool. Example shape:

```text
alice-watch rss list
alice-watch rss add --name ... --url ... --source ... --category ...
alice-watch rss enable --source ...
alice-watch rss disable --source ...
alice-watch rss remove --source ...
```

Do not add a parallel watchlist CLI in v1. Watchlist/tracked objects use `alice-workspace track add/search` unless that proves insufficient.

Keep provider/broker credential management out of this first pass.

## Deferred

- Broad `alice-config` CLI for cold admin settings.
- Direct Pi-extension writes to OpenAlice RSS config files.
- Dedicated watchlist persistence if `alice-workspace track` plus Onlyne loopback events are not enough.
- A-share-specific TraderHub/market-data improvements after we see what current data coverage lacks.
- Production packaging for root CLI mode.
- README repositioning. README is product positioning; update it later with an explicit framing decision.

## Non-goals

- Replacing the workspace launcher for every use case.
- Deleting UTA or trading functionality.
- Treating watch-mode trading visibility masks as a permanent security boundary.
- Building a second scheduler inside OpenAlice for this mode.
- Building a detached daemon supervisor in v1.
- Adding a dotenv dependency when the project Pi extension can load `.env` for its child process.
