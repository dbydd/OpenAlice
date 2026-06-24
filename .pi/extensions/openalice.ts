import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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

export default function (pi: ExtensionAPI) {
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
			ctx.ui.setStatus?.("openalice", "OpenAlice: running");
		} catch (error) {
			ctx.ui.setStatus?.("openalice", "OpenAlice: failed");
			ctx.ui.notify(formatError(error), "error");
		}
	});

	pi.on("session_shutdown", async () => {
		shuttingDown = true;
		if (child && childStartedByUs) {
			try { child.kill("SIGTERM"); } catch { /* already gone */ }
		}
	});
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
		try { child.kill("SIGTERM"); } catch { /* already gone */ }
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
