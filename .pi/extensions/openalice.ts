import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";

type OpenAliceSettings = {
	webPort: number;
	mcpPort: number;
	workspaceId: string;
	autoStart: boolean;
	maxRestarts: number;
	logPath: string;
};

type Health = {
	ok?: boolean;
	mode?: string;
	root?: string;
	mcp?: string;
	workspaceId?: string;
};

const DEFAULTS: OpenAliceSettings = {
	webPort: 47331,
	mcpPort: 47332,
	workspaceId: "openalice-core",
	autoStart: true,
	maxRestarts: 1,
	logPath: "logs/openalice-watch.log",
};

let child: ChildProcess | null = null;
let childStartedByUs = false;
let shuttingDown = false;
let restartCount = 0;
const watchChildren = new Map<string, ChildProcess>();
let stoppingWatchDaemon = false;

export default function (pi: ExtensionAPI) {
	registerOpenAliceCliTools(pi);
	registerWatchDaemonTool(pi);

	pi.registerCommand("openalice", {
		description: "Manage the OpenAlice root watch backend: /openalice status|start",
		async handler(args, ctx) {
			const [verb = "status"] = args.trim().split(/\s+/).filter(Boolean);
			if (verb === "status") {
				ctx.ui.notify(await statusText(), "info");
				return;
			}
			if (verb === "start") {
				const message = await startBackend({ manual: true });
				await startWatchDaemon(ctx);
				ctx.ui.notify(message, "info");
				return;
			}
			ctx.ui.notify("usage: /openalice status | /openalice start", "warning");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!isOpenAliceRoot()) return;
		const cfg = await loadConfig();
		process.env.OPENALICE_MODE = "watch";
		process.env.AQ_WS_ID = cfg.workspaceId;
		process.env.OPENALICE_WEB_PORT = String(cfg.webPort);
		process.env.OPENALICE_MCP_PORT = String(cfg.mcpPort);
		process.env.OPENALICE_MCP_URL = `http://127.0.0.1:${cfg.mcpPort}/mcp`;
		process.env.OPENALICE_CORE_WORKSPACE_DIR = process.cwd();
		ctx.ui.setStatus?.("openalice", "OpenAlice: checking");
		if (!cfg.autoStart || process.env.OPENALICE_AUTO_START === "0") {
			ctx.ui.setStatus?.("openalice", "OpenAlice: stopped");
			return;
		}
		try {
			await startBackend({ manual: false });
			await startWatchDaemon(ctx);
			ctx.ui.setStatus?.("openalice", "OpenAlice: running");
		} catch (error) {
			ctx.ui.setStatus?.("openalice", "OpenAlice: failed");
			ctx.ui.notify(formatError(error), "error");
		}
	});

	pi.on("session_shutdown", async () => {
		shuttingDown = true;
		stopWatchDaemon();
		if (child && childStartedByUs) {
			killChild(child);
		}
	});
}

const CliParams = Type.Object({
	args: Type.Optional(Type.Array(Type.String(), { description: "CLI argv after the binary, e.g. ['rss', 'grep', '半导体']" })),
	timeoutMs: Type.Optional(Type.Number({ description: "Timeout in milliseconds; default 60000" })),
});

const WatchDaemonParams = Type.Object({
	action: Type.Optional(Type.Union([
		Type.Literal("status"),
		Type.Literal("start"),
		Type.Literal("reload"),
		Type.Literal("stop"),
	], { description: "Watch daemon action. Defaults to status." })),
});

type CliParamsValue = { args?: string[]; timeoutMs?: number };
type WatchDaemonParamsValue = { action?: "status" | "start" | "reload" | "stop" };

function registerWatchDaemonTool(pi: ExtensionAPI): void {
	pi.registerTool(defineTool({
		name: "openalice_watch_daemon",
		label: "OpenAlice watch daemon",
		description: "Manage deterministic local watch scripts declared in config/watch-daemon.json: status/start/reload/stop. Scripts own their own business logic and notifications; this daemon only supervises process lifecycle. IMPORTANT for agents: watcher scripts must keep recoverable/idempotent state (pid/lock, cooldowns, last-seen markers, durable offsets) so they can resume safely after Pi exits, crashes, or pi -c restarts.",
		parameters: WatchDaemonParams,
		executionMode: "serial",
		async execute(_id, params) {
			const action = (params as WatchDaemonParamsValue).action ?? "status";
			if (action === "start") await startWatchDaemon();
			if (action === "reload") { stopWatchDaemon(); await startWatchDaemon(); }
			if (action === "stop") stopWatchDaemon();
			return { content: [{ type: "text", text: await watchDaemonStatusText() }] };
		},
	}));
}

function registerOpenAliceCliTools(pi: ExtensionAPI): void {
	const specs: Array<{ name: string; binary: "alice" | "traderhub" | "alice-watch" | "alice-workspace"; label: string; description: string }> = [
		{ name: "openalice_alice", binary: "alice", label: "OpenAlice alice", description: "Run the OpenAlice alice CLI shim for RSS archive, market search, bar search, quant calculations, and calculator work. Pass argv as args, e.g. ['rss','grep','半导体']." },
		{ name: "openalice_traderhub", binary: "traderhub", label: "OpenAlice traderhub", description: "Run the OpenAlice traderhub CLI shim for low-frequency market, fundamentals, macro, calendars, boards, ETFs, and reference data." },
		{ name: "openalice_watch_cli", binary: "alice-watch", label: "OpenAlice alice-watch", description: "Run the OpenAlice alice-watch CLI shim for watch-mode operations such as RSS source management. Do not use for trading." },
		{ name: "openalice_workspace", binary: "alice-workspace", label: "OpenAlice alice-workspace", description: "Run the OpenAlice alice-workspace CLI shim for current root workspace operations such as track add/search. This uses AQ_WS_ID=openalice-core by default." },
	];
	for (const spec of specs) {
		pi.registerTool(defineTool({
			name: spec.name,
			label: spec.label,
			description: `${spec.description}\nThe tool injects OPENALICE_MCP_URL and AQ_WS_ID automatically; do not shell out to bare PATH commands.`,
			parameters: CliParams,
			executionMode: "parallel",
			async execute(_id, params) {
				return { content: [{ type: "text", text: await runOpenAliceCli(spec.binary, params as CliParamsValue) }] };
			},
		}));
	}
}

async function runOpenAliceCli(binary: "alice" | "traderhub" | "alice-watch" | "alice-workspace", params: CliParamsValue): Promise<string> {
	if (!isOpenAliceRoot()) throw new Error("not in OpenAlice root");
	const cfg = await loadConfig();
	const script = resolve(process.cwd(), "src", "workspaces", "cli", "bin", binary);
	if (!existsSync(script)) throw new Error(`missing OpenAlice CLI shim: ${script}`);
	const args = Array.isArray(params.args) ? params.args : [];
	const timeoutMs = Number.isFinite(params.timeoutMs) && Number(params.timeoutMs) > 0 ? Number(params.timeoutMs) : 60_000;
	const env = {
		...process.env,
		OPENALICE_MODE: "watch",
		OPENALICE_WEB_PORT: String(cfg.webPort),
		OPENALICE_MCP_PORT: String(cfg.mcpPort),
		OPENALICE_MCP_URL: `http://127.0.0.1:${cfg.mcpPort}/mcp`,
		AQ_WS_ID: cfg.workspaceId,
		OPENALICE_CORE_WORKSPACE_DIR: process.cwd(),
	};
	return await new Promise((resolvePromise, reject) => {
		const proc = spawn(process.execPath, [script, ...args], { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		const cap = 100_000;
		const timer = setTimeout(() => {
			proc.kill("SIGTERM");
			reject(new Error(`${binary} timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		proc.stdout?.on("data", (chunk) => { stdout = (stdout + chunk.toString()).slice(-cap); });
		proc.stderr?.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-cap); });
		proc.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		proc.once("exit", (code, signal) => {
			clearTimeout(timer);
			const text = [stdout.trimEnd(), stderr.trimEnd() ? `stderr:\n${stderr.trimEnd()}` : ""].filter(Boolean).join("\n");
			if (code === 0) resolvePromise(text || "(no output)");
			else reject(new Error(`${binary} exited code=${code ?? "null"} signal=${signal ?? "null"}\n${text}`));
		});
	});
}

type WatchDaemonConfig = {
	enabled?: boolean;
	scripts?: Array<{
		id: string;
		enabled?: boolean;
		command: string;
		args?: string[];
		restart?: boolean;
		restartDelayMs?: number;
		logPath?: string;
	}>;
};

async function startWatchDaemon(ctx?: any): Promise<void> {
	if (!isOpenAliceRoot() || shuttingDown) return;
	const cfgPath = resolve(process.cwd(), "config", "watch-daemon.json");
	let cfg: WatchDaemonConfig;
	try { cfg = JSON.parse(await readFile(cfgPath, "utf8")) as WatchDaemonConfig; } catch { return; }
	if (cfg.enabled === false) return;
	for (const script of cfg.scripts ?? []) {
		if (!script?.id || script.enabled === false || !script.command) continue;
		if (watchChildren.has(script.id)) continue;
		await spawnWatchScript(script, ctx);
	}
}

function stopWatchDaemon(): void {
	stoppingWatchDaemon = true;
	for (const proc of watchChildren.values()) killChild(proc);
	watchChildren.clear();
	setTimeout(() => { stoppingWatchDaemon = false; }, 1000);
}

async function watchDaemonStatusText(): Promise<string> {
	const cfgPath = resolve(process.cwd(), "config", "watch-daemon.json");
	let declared: string[] = [];
	try {
		const cfg = JSON.parse(await readFile(cfgPath, "utf8")) as WatchDaemonConfig;
		declared = (cfg.scripts ?? []).filter((s) => s.enabled !== false).map((s) => s.id);
	} catch { /* no config */ }
	return [
		`declared: ${declared.length ? declared.join(", ") : "none"}`,
		`running: ${watchChildren.size ? [...watchChildren.entries()].map(([id, p]) => `${id}:${p.pid ?? "?"}`).join(", ") : "none"}`,
	].join("\n");
}

async function spawnWatchScript(script: NonNullable<WatchDaemonConfig["scripts"]>[number], ctx?: any): Promise<void> {
	const logPath = resolve(process.cwd(), script.logPath || join("logs", "watch-daemon", `${script.id}.log`));
	await mkdir(dirname(logPath), { recursive: true });
	const log = createWriteStream(logPath, { flags: "a" });
	log.write(`\n--- watch script ${script.id} start ${new Date().toISOString()} ---\n`);
	const cfg = await loadConfig();
	const env = {
		...process.env,
		OPENALICE_MODE: "watch",
		OPENALICE_WEB_PORT: String(cfg.webPort),
		OPENALICE_MCP_PORT: String(cfg.mcpPort),
		OPENALICE_MCP_URL: `http://127.0.0.1:${cfg.mcpPort}/mcp`,
		AQ_WS_ID: cfg.workspaceId,
		OPENALICE_CORE_WORKSPACE_DIR: process.cwd(),
	};
	const proc = spawn(script.command, script.args ?? [], {
		cwd: process.cwd(),
		env,
		stdio: ["ignore", "pipe", "pipe"],
		shell: process.platform === "win32",
		detached: process.platform !== "win32",
	});
	watchChildren.set(script.id, proc);
	proc.stdout?.pipe(log, { end: false });
	proc.stderr?.pipe(log, { end: false });
	proc.once("exit", (code, signal) => {
		watchChildren.delete(script.id);
		log.write(`--- watch script ${script.id} exit code=${code ?? "null"} signal=${signal ?? "null"} ${new Date().toISOString()} ---\n`);
		log.end();
		const shouldRestart = !shuttingDown && !stoppingWatchDaemon && script.restart !== false && code !== 0;
		if (shouldRestart) {
			setTimeout(() => { void spawnWatchScript(script, ctx).catch((err) => ctx?.ui?.notify?.(`watch script ${script.id} restart failed: ${formatError(err)}`, "warning")); }, Math.max(1000, Number(script.restartDelayMs) || 5000));
		}
	});
	ctx?.ui?.setStatus?.(`watch:${script.id}`, `watch:${script.id} running`);
}

async function startBackend(opts: { manual: boolean }): Promise<string> {
	if (!isOpenAliceRoot()) return "not in OpenAlice root; not starting backend";
	const cfg = await loadConfig();
	const existing = await readHealth(cfg);
	if (existing.ok && healthMatches(existing.body, cfg)) {
		return `OpenAlice already running: ${healthUrl(cfg)}`;
	}
	if (existing.ok) {
		throw new Error(`OpenAlice port is occupied by another instance: ${describeHealth(existing.body)}`);
	}
	if (child) return `OpenAlice is starting (pid ${child.pid ?? "unknown"})`;

	await mkdir(dirname(resolve(process.cwd(), cfg.logPath)), { recursive: true });
	const log = createWriteStream(resolve(process.cwd(), cfg.logPath), { flags: "a" });
	log.write(`\n--- OpenAlice watch session ${new Date().toISOString()} ---\n`);

	const envFile = await readDotEnv(resolve(process.cwd(), ".env"));
	const env = {
		...envFile,
		...process.env,
		OPENALICE_MODE: "watch",
		OPENALICE_WEB_PORT: String(cfg.webPort),
		OPENALICE_MCP_PORT: String(cfg.mcpPort),
		OPENALICE_MCP_URL: `http://127.0.0.1:${cfg.mcpPort}/mcp`,
		AQ_WS_ID: cfg.workspaceId,
		OPENALICE_CORE_WORKSPACE_DIR: process.cwd(),
	};

	childStartedByUs = true;
	child = spawn("pnpm", ["watch"], {
		cwd: process.cwd(),
		env,
		stdio: ["ignore", "pipe", "pipe"],
		shell: process.platform === "win32",
		detached: process.platform !== "win32",
	});
	child.stdout?.pipe(log, { end: false });
	child.stderr?.pipe(log, { end: false });
	child.once("exit", (code, signal) => {
		log.write(`--- OpenAlice watch exited code=${code ?? "null"} signal=${signal ?? "null"} ${new Date().toISOString()} ---\n`);
		log.end();
		child = null;
		if (!shuttingDown && restartCount < cfg.maxRestarts) {
			restartCount += 1;
			void startBackend({ manual: false }).catch(() => undefined);
		}
	});

	const ready = await waitForHealthy(cfg, 20_000);
	if (!ready) {
		killChild(child);
		throw new Error(`OpenAlice did not become healthy at ${healthUrl(cfg)}; see ${cfg.logPath}`);
	}
	return opts.manual ? `OpenAlice started: ${healthUrl(cfg)}` : `OpenAlice auto-started: ${healthUrl(cfg)}`;
}

async function statusText(): Promise<string> {
	const cfg = await loadConfig();
	const health = await readHealth(cfg);
	const state = health.ok && healthMatches(health.body, cfg) ? "running" : health.ok ? "mismatch" : child ? "starting" : "stopped";
	return [
		`OpenAlice: ${state}`,
		`pid: ${child?.pid ?? "unknown"}`,
		`watch scripts: ${watchChildren.size ? [...watchChildren.entries()].map(([id, p]) => `${id}:${p.pid ?? "?"}`).join(", ") : "none"}`,
		`health: ${healthUrl(cfg)}`,
		`mcp: http://127.0.0.1:${cfg.mcpPort}/mcp`,
		`workspace: ${cfg.workspaceId}`,
		`root: ${process.cwd()}`,
		`log: ${cfg.logPath}`,
		health.ok && !healthMatches(health.body, cfg) ? `mismatch: ${describeHealth(health.body)}` : "",
	].filter(Boolean).join("\n");
}

async function loadConfig(): Promise<OpenAliceSettings> {
	const [globalSettings, projectSettings] = await Promise.all([
		readSettings(join(homedir(), ".pi", "agent", "settings.json")),
		readSettings(resolve(process.cwd(), ".pi", "settings.json")),
	]);
	const raw = { ...globalSettings?.openalice, ...projectSettings?.openalice } as Record<string, unknown>;
	return {
		webPort: readPort(process.env.OPENALICE_WEB_PORT ?? raw.webPort, DEFAULTS.webPort),
		mcpPort: readPort(process.env.OPENALICE_MCP_PORT ?? raw.mcpPort, DEFAULTS.mcpPort),
		workspaceId: readString(process.env.AQ_WS_ID ?? raw.workspaceId, DEFAULTS.workspaceId),
		autoStart: readBool(process.env.OPENALICE_AUTO_START ?? raw.autoStart, DEFAULTS.autoStart),
		maxRestarts: readNonNegativeInt(process.env.OPENALICE_MAX_RESTARTS ?? raw.maxRestarts, DEFAULTS.maxRestarts),
		logPath: readString(process.env.OPENALICE_LOG_PATH ?? raw.logPath, DEFAULTS.logPath),
	};
}

async function readSettings(path: string): Promise<any> {
	try { return JSON.parse(await readFile(path, "utf8")); } catch { return undefined; }
}

async function readDotEnv(path: string): Promise<Record<string, string>> {
	try {
		const out: Record<string, string> = {};
		for (const line of (await readFile(path, "utf8")).split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eq = trimmed.indexOf("=");
			if (eq < 1) continue;
			const key = trimmed.slice(0, eq).trim();
			let value = trimmed.slice(eq + 1).trim();
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
			out[key] = value;
		}
		return out;
	} catch { return {}; }
}

async function waitForHealthy(cfg: OpenAliceSettings, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const health = await readHealth(cfg);
		if (health.ok && healthMatches(health.body, cfg)) return true;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	return false;
}

async function readHealth(cfg: OpenAliceSettings): Promise<{ ok: boolean; body?: Health }> {
	try {
		const res = await fetch(healthUrl(cfg));
		if (!res.ok) return { ok: false };
		return { ok: true, body: await res.json() as Health };
	} catch { return { ok: false }; }
}

function healthMatches(health: Health | undefined, cfg: OpenAliceSettings): boolean {
	return health?.ok === true && health.mode === "watch" && resolve(health.root ?? "") === process.cwd() && health.workspaceId === cfg.workspaceId;
}

function describeHealth(health: Health | undefined): string {
	return `mode=${health?.mode ?? "?"} root=${health?.root ?? "?"} workspaceId=${health?.workspaceId ?? "?"}`;
}

function healthUrl(cfg: OpenAliceSettings): string {
	return `http://127.0.0.1:${cfg.webPort}/__health`;
}

function isOpenAliceRoot(): boolean {
	return existsSync(resolve(process.cwd(), "package.json")) && existsSync(resolve(process.cwd(), "src", "main.ts")) && existsSync(resolve(process.cwd(), "scripts", "guardian", "watch.ts"));
}

function killChild(proc: ChildProcess): void {
	try {
		if (process.platform !== "win32" && proc.pid) process.kill(-proc.pid, "SIGTERM");
		else proc.kill("SIGTERM");
	} catch {
		try { proc.kill("SIGTERM"); } catch { /* already gone */ }
	}
}

function readPort(value: unknown, fallback: number): number {
	const n = Number(value);
	return Number.isInteger(n) && n > 0 && n <= 65535 ? n : fallback;
}
function readNonNegativeInt(value: unknown, fallback: number): number {
	const n = Number(value);
	return Number.isInteger(n) && n >= 0 ? n : fallback;
}
function readString(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim() ? value : fallback;
}
function readBool(value: unknown, fallback: boolean): boolean {
	if (typeof value === "boolean") return value;
	if (typeof value === "string") return !["0", "false", "no", "off"].includes(value.toLowerCase());
	return fallback;
}
function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
