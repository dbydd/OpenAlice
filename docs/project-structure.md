# Project Structure

OpenAlice is a pnpm monorepo. The current architecture is split between:

- **Alice** (`src/`) — app/backend, market/news/analysis tools, workspace launcher, CLI/MCP surfaces.
- **UTA** (`services/uta/`) — broker/trading carrier process.
- **Packages** (`packages/`) — shared protocol/client libraries.
- **UI** (`ui/`) — React/Vite frontend.
- **Data** (`~/.openalice/data` by default) — portable user state.
- **Workspace launcher root** (`~/.openalice/workspaces` by default) — managed agent workspaces and session state.

## Top-level layout

```text
src/                         # Alice process
  main.ts                    # composition root
  core/                      # tool registry, workspace tool center, config, stores, event log
  ai-providers/              # provider preset catalog only; not an execution layer
  domain/                    # market-data, analysis, news, thinking
  services/                  # auth, UTA client SDK, UTA supervisor
  server/                    # MCP server, CLI gateway, OpenTypeBB routes
  tool/                      # ToolCenter tool definitions
  webui/                     # Hono web routes/middleware
  workspaces/                # native CLI workspace launcher
  migrations/                # versioned data migrations
  task/                      # cron/automation support

services/uta/                # UTA process; owns broker/trading domain
  src/main.ts
  src/http/
  src/domain/trading/

packages/
  uta-protocol/              # Alice <-> UTA wire types and SDK
  ibkr/                      # IBKR TWS port
  opentypebb/                # OpenBB TS port

ui/                          # React/Vite frontend
scripts/guardian/            # dev/prod supervisor
DEFAULT/ and default/         # shipped defaults/skills/templates assets
data/                        # legacy/repo-local user state only when OPENALICE_HOME=$PWD
```

## Alice process (`src/`)

Important areas:

| Path | Current responsibility |
|---|---|
| `src/core/tool-center.ts` | Central tool registry used by MCP and CLI exports. |
| `src/core/workspace-tool-center.ts` | Per-workspace scoped tool registry (`inbox`, `entity`, `workspace_path`). |
| `src/core/config.ts` | JSON config loader/sealer. Config lives under `data/config/`. |
| `src/server/mcp.ts` | MCP protocol server and `/cli/:wsId/:export/*` mount. |
| `src/server/cli.ts` | HTTP gateway backing `alice`, `alice-uta`, `alice-workspace`, `traderhub`. |
| `src/server/cli-commands.ts` | Public CLI command map. |
| `src/workspaces/` | PTY/session launcher for native agent CLIs (`claude`, `codex`, `opencode`, `pi`, `shell`). |
| `src/tool/` | Thin tool definitions over domain/services. |
| `src/domain/market-data/` | In-process market data clients and search. |
| `src/domain/news/` | RSS archive collector/search. |
| `src/domain/analysis/` | Indicators and expression evaluation support. |
| `src/domain/thinking/` | Safe calculator/evaluator. |

The old in-process AI loop, `AgentCenter`, connector system, Telegram/web chat connectors, and MCP Ask connector are retired. Native agent CLIs now run the model loop.

## UTA process (`services/uta/`)

UTA owns broker/trading state and all broker implementations. Alice talks to it over `@traderalice/uta-protocol` HTTP/SDK boundaries.

Important areas:

```text
services/uta/src/main.ts
services/uta/src/http/routes-trading.ts
services/uta/src/domain/trading/brokers/
services/uta/src/domain/trading/git/
services/uta/src/domain/trading/order-sync-poller.ts
```

In watch/root-Pi CLI mode, UTA should be skipped by default because the A-share monitoring workflow is chat/research/alerting, not programmatic trading.

## CLI surfaces

The public CLI surface is not separate business logic. It is a manifest-driven wrapper over ToolCenter via `src/server/cli.ts`.

Current binaries:

| Binary | Scope | Purpose |
|---|---|---|
| `alice` | global | RSS, market search, quant/analysis, calculator. |
| `traderhub` | global | Boards, equities, ETFs, macro, indices, crypto derivatives. |
| `alice-workspace` | scoped | Inbox/entity/peer workspace tools. |
| `alice-uta` | global | Trading/account/order tools. Hide in watch mode. |

Cron/scheduling is deliberately not exported as CLI today.

## Workspace launcher

`src/workspaces/` launches native CLIs in PTY sessions. The launcher injects:

- `AQ_WS_ID`
- `OPENALICE_MCP_URL`
- `PATH` with `src/workspaces/cli/bin`
- per-workspace agent config where needed
- project skills into `.claude/skills`, `.agents/skills`, `.pi/skills`

Managed workspaces default to:

```text
$AQ_LAUNCHER_ROOT/workspaces/<wsId>
```

with registry/state at:

```text
$AQ_LAUNCHER_ROOT/workspaces.json
$AQ_LAUNCHER_ROOT/state/
```

Root Pi CLI mode is intentionally different: the OpenAlice repo root is the Pi project, while `workspace/` can hold local runtime state.

## Data roots

| Env | Default | Controls |
|---|---|---|
| `OPENALICE_HOME` | `~/.openalice` | User data root; config under `data/config`. |
| `AQ_LAUNCHER_ROOT` | `~/.openalice/workspaces` | Workspace launcher registry/state/workspaces. |
| `OPENALICE_GLOBAL_DIR` | `~/.openalice` | User-global provider keys. |
| `PI_CODING_AGENT_DIR` | `~/.pi/agent` | Pi agent global dir override; useful for root-local `.pi-agent`. |

`OPENALICE_HOME` does **not** move managed workspaces; set `AQ_LAUNCHER_ROOT` separately.

## Root Pi CLI mode

See [pi-root-cli-mode.md](./pi-root-cli-mode.md) for the implementation plan.
