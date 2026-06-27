#!/usr/bin/env node
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const configPath = process.argv.includes('--config')
  ? process.argv[process.argv.indexOf('--config') + 1]
  : 'config/ulanzi-stock-profile.json';
const dryRun = process.argv.includes('--dry-run');
const topArg = process.argv.includes('--top') ? process.argv[process.argv.indexOf('--top') + 1] : '';
const noActivate = process.argv.includes('--no-activate');
const noRestart = process.argv.includes('--no-restart');

const codeRe = /(?<!\d)([036]\d{5}|[123]\d{5}|[689]\d{5})(?!\d)|\b(NDAQ|IXIC|DJI|SPX|HSI)\b/g;

function uniq(xs) {
  return [...new Set(xs.filter(Boolean).map(String))];
}

function recentMarkdownFiles(dir, limit = 8) {
  if (!existsSync(dir)) return [];
  // ponytail: sync directory stats are simpler here; script runs once daily.
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    .slice(0, limit);
}

function extractTopCodes(notesDir, exclude, k) {
  const files = recentMarkdownFiles(notesDir);
  const score = new Map();
  for (const [fileRank, file] of files.entries()) {
    const text = readFileSync(file, 'utf8');
    let m;
    while ((m = codeRe.exec(text))) {
      const code = m[1] || m[2];
      if (!code || exclude.has(code)) continue;
      const around = text.slice(Math.max(0, m.index - 80), Math.min(text.length, m.index + 120));
      let s = 1 + Math.max(0, 8 - fileRank);
      if (/操作矩阵|候选|机会|Top|排名|评分|主线|涨停|强势/.test(around)) s += 6;
      if (/观望|禁买|剔除|弱于|不加仓|风险|失效/.test(around)) s -= 2;
      score.set(code, (score.get(code) || 0) + s);
    }
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([code]) => code);
}

function readAliceTrack(config) {
  if (config.useAliceTrack === false) return null;
  try {
    const env = {
      ...process.env,
      OPENALICE_MCP_URL: process.env.OPENALICE_MCP_URL || 'http://127.0.0.1:47332/mcp',
      AQ_WS_ID: process.env.AQ_WS_ID || 'openalice-core',
    };
    const out = execFileSync('node', ['src/workspaces/cli/bin/alice-workspace', 'track', 'search', '--query', config.trackQuery || 'stock-cn'], {
      cwd: root,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
    });
    const json = JSON.parse(out);
    const holdings = [];
    const watch = [];
    for (const e of json.entities || []) {
      const code = /stock-cn-(\d{6})/.exec(e.name || '')?.[1] || /(?<!\d)(\d{6})(?!\d)/.exec(e.description || '')?.[1];
      if (!code) continue;
      if (/\[holding\]/i.test(e.description || '')) holdings.push(code);
      else if (/\[watch\]/i.test(e.description || '')) watch.push(code);
    }
    return { holdings: uniq(holdings), watch: uniq(watch) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), holdings: [], watch: [] };
  }
}

function preferConfigOrder(trackCodes, configCodes) {
  const seen = new Set(trackCodes);
  return uniq([...configCodes.filter((c) => seen.has(c)), ...trackCodes]);
}

function resolveSlotToken(token, pools) {
  const m = /^\$(top|watch|holding|index)(\d+)$/.exec(token);
  if (!m) return token;
  const [, kind, n] = m;
  const key = kind === 'index' ? 'indices' : kind === 'watch' ? 'watch' : kind + 's';
  return pools[key]?.[Number(n) - 1] || '';
}

async function writeJsonIfChanged(file, mutate, dryRun) {
  if (!existsSync(file)) return { file, changed: false, reason: 'missing' };
  const json = JSON.parse(await readFile(file, 'utf8'));
  const before = JSON.stringify(json);
  mutate(json);
  const after = JSON.stringify(json);
  if (before === after) return { file, changed: false };
  if (!dryRun) {
    await copyFile(file, `${file}.bak`);
    await writeFile(file, JSON.stringify(json, null, 2) + '\n');
  }
  return { file, changed: true };
}

async function maybeActivateProfile(config, profileManifest, { dryRun, noActivate }) {
  if (noActivate || config.activateProfile === false) return { enabled: false, changed: false };
  const appDir = config.appSupportDir;
  const profileName = profileManifest.Name;
  const profileDevice = profileManifest.Device || {};
  const files = [];
  files.push(await writeJsonIfChanged(path.join(appDir, 'config/setting.json'), (s) => {
    s.CurrentProfile = profileName;
  }, dryRun));
  files.push(await writeJsonIfChanged(path.join(appDir, 'config/setting_source.json'), (s) => {
    for (const d of s.Devices || []) {
      if (!profileDevice.UUID || d.CurrentDevice === profileDevice.UUID || d.DeviceType === profileDevice.Model) {
        d.CurrentProfile = profileName;
      }
    }
  }, dryRun));
  return { enabled: true, profileName, changed: files.some((f) => f.changed), files };
}

function isUlanziRunning() {
  try {
    const out = execFileSync('pgrep', ['-f', 'UlanziDeck|Ulanzi Studio'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function restartUlanziStudio(forceQuit = true) {
  // ponytail: app does not hot-reload profile JSON; relaunch is the reliable sync trigger.
  if (forceQuit) {
    try { execFileSync('osascript', ['-e', 'tell application "Ulanzi Studio" to quit'], { stdio: 'ignore', timeout: 5000 }); } catch {}
  }
  try { execFileSync('open', ['-a', 'Ulanzi Studio.app'], { stdio: 'ignore', timeout: 10000 }); } catch (err) {
    console.error('failed to open Ulanzi Studio:', err instanceof Error ? err.message : String(err));
  }
}

const config = JSON.parse(await readFile(configPath, 'utf8'));
const manifestPath = config.manifestPath;
const notesDir = path.resolve(root, config.notesDir || 'notes_and_reports/金融');
const track = readAliceTrack(config);
const holdings = track && !track.error && track.holdings.length
  ? preferConfigOrder(track.holdings, uniq(config.holdings || []))
  : uniq(config.holdings || []);
const watch = track && !track.error && track.watch.length
  ? preferConfigOrder(track.watch, uniq(config.watch || []))
  : uniq(config.watch || []);
const indices = uniq(config.indices || []);
const exclude = new Set([...holdings, ...watch, ...indices]);
const top = topArg
  ? uniq(topArg.split(/[，,\s]+/)).filter((c) => /^\d{6}$/.test(c)).slice(0, Number(config.topK || 3))
  : extractTopCodes(notesDir, exclude, Number(config.topK || 3));
const pools = { holdings, watch, indices, tops: top };
const desired = Object.fromEntries(
  Object.entries(config.slotPlan || {})
    .map(([slot, token]) => [slot, resolveSlotToken(String(token), pools)])
    .filter(([, code]) => code),
);

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const profileRoot = path.dirname(path.dirname(path.dirname(manifestPath)));
const profileManifestPath = path.join(profileRoot, 'manifest.json');
const profileManifest = JSON.parse(await readFile(profileManifestPath, 'utf8'));
const keypad = manifest.Controllers?.find((c) => c.Type === 'Keypad');
if (!keypad?.Actions) throw new Error('Ulanzi manifest has no Keypad Actions');

const changes = [];
for (const [slot, code] of Object.entries(desired)) {
  const action = keypad.Actions[slot];
  if (!action?.ActionParam || action.Action !== 'com.ulanzi.ulanzideck.stock.config') continue;
  const before = action.ActionParam.code_single;
  if (before !== code) {
    action.ActionParam.code_single = code;
    changes.push({ slot, before, after: code });
  }
}

const activation = await maybeActivateProfile(config, profileManifest, { dryRun, noActivate });
const appWasRunning = isUlanziRunning();
const shouldRestart = Boolean(config.restartAppAfterWrite && !noRestart && !dryRun && (changes.length || activation.changed || !appWasRunning));

console.log(JSON.stringify({
  dryRun,
  manifestPath,
  profile: profileManifest.Name,
  trackSource: track?.error ? `fallback: ${track.error}` : 'alice-track',
  holdings,
  watch,
  indices,
  top,
  desired,
  changes,
  activation,
  appWasRunning,
  restartApp: shouldRestart,
}, null, 2));

if (!dryRun && changes.length) {
  const backupDir = path.join(path.dirname(manifestPath), '.backup');
  await mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await copyFile(manifestPath, path.join(backupDir, `manifest.${stamp}.json`));
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

if (shouldRestart) restartUlanziStudio();
