#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { TextDecoder } from 'node:util';

const root = process.cwd();
const cfgPath = path.join(root, 'config/holding-risk-watch.json');
const statePath = path.join(root, 'tmp/holding-risk-watch-state.json');
const pidPath = path.join(root, 'tmp/holding-risk-watch.pid');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, b) => b ? ((a - b) / b) * 100 : 0;

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

function inMarketTime() {
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const hhmm = now.getHours() * 100 + now.getMinutes();
  return (hhmm >= 925 && hhmm <= 1135) || (hhmm >= 1255 && hhmm <= 1505);
}

function txSymbol(code) {
  if (/^(6|9)/.test(code)) return `sh${code}`;
  return `sz${code}`;
}

function readHoldingsNote(file = 'notes_and_reports/金融/持仓跟踪.md') {
  try {
    const text = execFileSync('cat', [file], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });
    const holdings = {};
    for (const line of text.split(/\r?\n/)) {
      if (!line.includes('|')) continue;
      const cells = line.split('|').map((s) => s.trim()).filter(Boolean);
      const code = cells.find((c) => /^\d{6}$/.test(c));
      if (!code) continue;
      const name = cells[cells.indexOf(code) + 1] || cells[0];
      const qty = Number((cells.find((c) => /股/.test(c)) || '').replace(/[^0-9.]/g, '')) || undefined;
      const cost = Number((cells.find((c) => /^\d+\.\d+$/.test(c)) || '').replace(/[^0-9.]/g, '')) || undefined;
      holdings[code] = { name, qty, cost };
    }
    return holdings;
  } catch {
    return {};
  }
}

function readTrackHoldings(trackQuery = 'stock-cn') {
  try {
    const env = {
      ...process.env,
      OPENALICE_MCP_URL: process.env.OPENALICE_MCP_URL || 'http://127.0.0.1:47332/mcp',
      AQ_WS_ID: process.env.AQ_WS_ID || 'openalice-core',
    };
    const out = execFileSync('node', ['src/workspaces/cli/bin/alice-workspace', 'track', 'search', '--query', trackQuery], {
      cwd: root,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10000,
    });
    const json = JSON.parse(out);
    const holdings = {};
    for (const e of json.entities || []) {
      if (!/\[holding\]/i.test(e.description || '')) continue;
      const code = /stock-cn-(\d{6})/.exec(e.name || '')?.[1] || /(?<!\d)(\d{6})(?!\d)/.exec(e.description || '')?.[1];
      if (!code) continue;
      const display = (e.description || '').replace(/^\[holding\]\s*/i, '').split(/[；;]/)[0].trim();
      holdings[code] = { name: display || code };
    }
    return holdings;
  } catch {
    return {};
  }
}

async function fetchQuotes(codes) {
  if (!codes.length) return [];
  const url = `https://qt.gtimg.cn/q=${codes.map(txSymbol).join(',')}`;
  const raw = await fetch(url, { headers: { 'User-Agent': 'OpenAlice-watch' } }).then((r) => r.arrayBuffer());
  const text = new TextDecoder('gb18030').decode(raw);
  return text.split(';').map((line) => {
    const p = line.split('~');
    if (p.length < 52) return null;
    const n = (i) => Number(p[i] || 0);
    return { code: p[2], name: p[1], price: n(3), prev: n(4), open: n(5), high: n(33), low: n(34), amountWan: n(37), turn: n(38), time: p[30], vwap: n(51) };
  }).filter(Boolean);
}

function checkQuote(q, rule, thresholds) {
  const issues = [];
  if (rule.stop && q.price <= Number(rule.stop)) issues.push({ key: 'stop', text: `跌破止损线 ${rule.stop}` });
  if (rule.hardStop && q.price <= Number(rule.hardStop)) issues.push({ key: 'hardStop', text: `跌破硬止损线 ${rule.hardStop}` });
  if (rule.takeProfit && rule.takeProfitAlert !== false && q.price >= Number(rule.takeProfit)) issues.push({ key: 'takeProfit', text: `触及止盈观察线 ${rule.takeProfit}` });
  if (q.prev && pct(q.price, q.prev) <= Number(thresholds.dropFromPrevPct ?? -3)) issues.push({ key: 'dropPrev', text: `较昨收 ${pct(q.price, q.prev).toFixed(2)}%` });
  if (q.open && pct(q.price, q.open) <= Number(thresholds.dropFromOpenPct ?? -2)) issues.push({ key: 'dropOpen', text: `较开盘 ${pct(q.price, q.open).toFixed(2)}%` });
  if (q.high && pct(q.price, q.high) <= Number(thresholds.drawdownFromHighPct ?? -3)) issues.push({ key: 'drawdownHigh', text: `较日高回撤 ${pct(q.price, q.high).toFixed(2)}%` });
  if (q.vwap && q.price < q.vwap * (1 - Number(thresholds.vwapBreakPct ?? 0.8) / 100)) issues.push({ key: 'vwapBreak', text: `跌破VWAP ${q.vwap}` });
  return issues;
}

function sendLoopback(text) {
  const req = JSON.stringify({ id: `holding-risk-${Date.now()}`, op: 'loopback', text, raw_text: false });
  execFileSync('onlyne', ['client', req], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
}

function cooldownKey(code, issues) {
  const keys = new Set(issues.map((i) => i.key));
  if (keys.has('hardStop')) return `${code}:hardStop`;
  if (keys.has('stop')) return `${code}:stop`;
  if (keys.has('takeProfit')) return `${code}:takeProfit`;
  if (keys.has('vwapBreak')) return `${code}:vwapBreak`;
  if (keys.has('dropPrev')) return `${code}:dropPrev`;
  if (keys.has('dropOpen')) return `${code}:dropOpen`;
  if (keys.has('drawdownHigh')) return `${code}:drawdownHigh`;
  return `${code}:${[...keys].sort().join('|')}`;
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function acquireLock() {
  await mkdir(path.dirname(pidPath), { recursive: true });
  if (existsSync(pidPath)) {
    const old = Number((await readFile(pidPath, 'utf8')).trim());
    if (old && old !== process.pid && processAlive(old)) {
      console.log(`holding-risk-loop already running pid=${old}`);
      process.exit(0);
    }
  }
  await writeFile(pidPath, `${process.pid}\n`);
  const cleanup = async () => { try { await writeFile(pidPath, ''); } catch {} };
  process.once('SIGTERM', async () => { await cleanup(); process.exit(0); });
  process.once('SIGINT', async () => { await cleanup(); process.exit(0); });
}

async function main() {
  await acquireLock();
  await mkdir(path.dirname(statePath), { recursive: true });
  let state = await readJson(statePath, { last: {} });
  for (;;) {
    const cfg = await readJson(cfgPath, { enabled: false });
    if (!cfg.enabled) { await sleep(60_000); continue; }
    if (cfg.marketTimeOnly !== false && !inMarketTime()) { await sleep(Number(cfg.intervalMs || 60_000)); continue; }
    const explicitHoldings = cfg.holdings || {};
    const noteHoldings = cfg.holdingsNote ? readHoldingsNote(cfg.holdingsNote) : {};
    const trackHoldings = cfg.useAliceTrack === false ? {} : readTrackHoldings(cfg.trackQuery || 'stock-cn');
    const holdings = { ...trackHoldings, ...noteHoldings, ...explicitHoldings };
    const quotes = await fetchQuotes(Object.keys(holdings));
    const now = Date.now();
    for (const q of quotes) {
      const rule = holdings[q.code] || {};
      const explicit = Boolean(explicitHoldings[q.code]);
      if (!explicit && cfg.notifyTrackHoldingsWithoutRules !== true) continue;
      const issues = checkQuote(q, rule, cfg.thresholds || {});
      if (!issues.length) continue;
      const key = cooldownKey(q.code, issues);
      if (now - Number(state.last[key] || 0) < Number(cfg.cooldownMs || 600_000)) continue;
      state.last[key] = now;
      const issueText = issues.map((i) => i.text).join('；');
      const text = `**持仓风控触发｜${rule.name || q.name} ${q.code}**\n\n` +
        `现价：${q.price}；昨收：${q.prev}；开盘：${q.open}；VWAP：${q.vwap}；日高：${q.high}\n\n` +
        `触发：${issueText}\n\n` +
        `动作：请立即复核是否止盈、降仓、止损或禁止加仓。`;
      try { sendLoopback(text); console.log(new Date().toISOString(), 'alert', q.code, issueText); }
      catch (err) { console.error(new Date().toISOString(), 'loopback failed', err?.message || err); }
    }
    await writeFile(statePath, JSON.stringify(state, null, 2) + '\n');
    await sleep(Number(cfg.intervalMs || 60_000));
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
