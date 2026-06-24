/**
 * Guardian — root Pi watch entry.
 *
 * Session-owned backend for `cd OpenAlice && pi --approve` via the project Pi
 * extension. Starts Alice only: no UTA, no Vite, no PTY workspace session.
 */

import { resolve } from 'node:path'
import { homedir } from 'node:os'
import type { ChildProcess } from 'node:child_process'
import {
  readPortsFile,
  resolvePortConfig,
  planPorts,
  spawnChild,
  waitForHttp,
  installCascadeShutdown,
} from './shared.js'

async function main(): Promise<void> {
  const dataHome = process.env['OPENALICE_HOME'] ?? resolve(homedir(), '.openalice')
  const ports = await planPorts(resolvePortConfig(process.env, await readPortsFile(dataHome)))
  const root = process.env['OPENALICE_CORE_WORKSPACE_DIR'] ?? process.cwd()
  const workspaceId = process.env['AQ_WS_ID'] ?? 'openalice-core'

  console.log('')
  console.log(`[guardian/watch] Alice    →  http://localhost:${ports.webPort}`)
  console.log(`[guardian/watch] MCP      →  http://localhost:${ports.mcpPort}/mcp`)
  console.log(`[guardian/watch] Workspace→  ${workspaceId} (${root})`)
  console.log('')

  const baseEnv: NodeJS.ProcessEnv = {
    ...process.env,
    OPENALICE_HOME: dataHome,
    OPENALICE_MODE: 'watch',
    OPENALICE_WEB_PORT: String(ports.webPort),
    OPENALICE_MCP_PORT: String(ports.mcpPort),
    AQ_WS_ID: workspaceId,
    OPENALICE_CORE_WORKSPACE_DIR: root,
    OPENALICE_MCP_URL: `http://127.0.0.1:${ports.mcpPort}/mcp`,
    NODE_OPTIONS: [process.env['NODE_OPTIONS'], '--conditions=openalice-source'].filter(Boolean).join(' '),
  }

  const alice: ChildProcess = spawnChild({
    name: 'alice',
    command: 'tsx',
    args: ['watch', 'src/main.ts'],
    env: baseEnv,
    prefixLogs: true,
  })

  const ready = await waitForHttp(`http://127.0.0.1:${ports.webPort}/__health`, { timeoutMs: 15_000 })
  if (!ready) {
    console.error(`[guardian/watch] Alice failed to become healthy within 15s — aborting`)
    try { alice.kill('SIGTERM') } catch { /* noop */ }
    process.exit(1)
  }
  console.log(`[guardian/watch] Alice ready`)

  installCascadeShutdown({ children: [alice] })
}

main().catch((err: unknown) => {
  console.error('[guardian/watch] fatal:', err)
  process.exit(1)
})
