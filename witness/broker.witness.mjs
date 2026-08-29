#!/usr/bin/env node
// broker.witness.mjs — the SERVERLESS door, live: generator + two viewers
// rendezvous over PUBLIC MQTT brokers (door=broker — no relay of ours running;
// the local server here serves static files ONLY, /signal is never touched),
// form real data-channel tree links, and the stream plays.
//
// Network-dependent by nature: exits 127 (SKIP, holospaces vv convention) when
// no public broker is reachable from this machine.
//
//   node witness/broker.witness.mjs [port]

import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); }
catch { ({ chromium } = createRequire("C:/Users/pavel/Desktop/HOLOGRAM/holo-os/system/")("playwright")); }

let pass = 0, fail = 0;
const ok = (c, m, d = "") => { console.log((c ? "  ok  " : "  XX  ") + m + (d ? " — " + d : "")); if (c) pass++; else fail++; };

// static-only server — NO /signal endpoint, so rendezvous can only be the broker.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const MIME = { ".html": "text/html", ".mjs": "text/javascript" };
const PORT = +(process.argv[2] || 8978);
const server = http.createServer((req, res) => {
  const fp = path.join(ROOT, new URL(req.url, "http://x").pathname.replace(/^\//, ""));
  if (fp.startsWith(ROOT) && existsSync(fp)) { res.writeHead(200, { "content-type": MIME[path.extname(fp)] || "text/plain" }); res.end(readFileSync(fp)); }
  else res.writeHead(404).end();
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const base = `http://127.0.0.1:${PORT}`;

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });

// reachability probe: can a page open a broker WebSocket at all?
// (must run from a real http origin — about:blank pages may not open sockets)
const probe = await (await browser.newContext()).newPage();
await probe.goto(base + "/README.md");
const reachable = await probe.evaluate(() => new Promise((res) => {
  let done = false; const fin = (v) => { if (!done) { done = true; res(v); } };
  try { const ws = new WebSocket("wss://broker.emqx.io:8084/mqtt", "mqtt"); ws.onopen = () => { ws.close(); fin(true); }; ws.onerror = () => fin(false); }
  catch { fin(false); }
  setTimeout(() => fin(false), 8000);
})).catch(() => false);
if (!reachable) { console.error("broker.witness: SKIP — no public broker reachable"); await browser.close(); server.close(); process.exit(127); }

const ROOM = "brk-" + Math.random().toString(36).slice(2, 8);   // fresh room per run
const SECRET = "brk-invite-" + Math.random().toString(36).slice(2, 8);
const open = async (params) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${base}/web/watch.html?${new URLSearchParams({ ...params, door: "broker", room: ROOM, secret: SECRET, k: 2 })}`);
  return page;
};

const gen = await open({ role: "gen", id: "bg-a", clipmode: "png" });
await gen.waitForFunction(() => window.state && window.state.pub, null, { timeout: 20000 });
const pub = await gen.evaluate(() => window.state.pub);
const v1 = await open({ role: "viewer", id: "bv-b", pub });
const v2 = await open({ role: "viewer", id: "bv-c", pub });

for (const p of [v1, v2]) await p.waitForFunction(() => window.state.played.length >= 1, null, { timeout: 60000 }).catch(() => {});
const s1 = await v1.evaluate(() => window.state);
const s2 = await v2.evaluate(() => window.state);
const g = await gen.evaluate(() => window.state);

ok(s1.played.length >= 1 && s2.played.length >= 1,
  "viewers found the channel through PUBLIC brokers only and played live clips", JSON.stringify([s1.played.length, s2.played.length]));
const pubK = new Set(g.published.map((p) => p.kappa));
ok([...s1.played, ...s2.played].every((p) => pubK.has(p.kappa)), "every played κ was signed by the channel (through an untrusted door)");
ok(s1.links >= 1 && s2.links >= 1, "real RTCDataChannel tree links formed via broker-carried sealed SDP", JSON.stringify([s1.links, s2.links]));

await browser.close(); server.close();
console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
