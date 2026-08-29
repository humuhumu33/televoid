#!/usr/bin/env node
// seed.witness.mjs — EVERY SET A TOWER, live: real browsers, real channels.
//
//   1. PROMOTION  — a set that just watches becomes a tower, zero UI events;
//                   a backgrounded set demotes within beats.
//   2. SEEDING    — a set that joins late fills its reel from PEER stores
//                   only (the desk serves zero history bytes), first history
//                   picture inside the 2s budget; a peer serving corrupted
//                   bytes is caught by rederivation and skipped.
//   3. DESK DEATH — the desk crashes; a BRAND NEW set still tunes into the
//                   archive, served entirely by the audience.
//
//   node witness/seed.witness.mjs [port]

import { startRelay } from "./signal-relay.mjs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); }
catch { ({ chromium } = createRequire("C:/Users/pavel/Desktop/HOLOGRAM/holo-os/system/")("playwright")); }

let pass = 0, fail = 0;
const ok = (c, m, d = "") => { console.log((c ? "  ok  " : "  XX  ") + m + (d ? " — " + d : "")); if (c) pass++; else fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PORT = +(process.argv[2] || 9001);
const server = await startRelay(PORT);
const base = `http://127.0.0.1:${PORT}`;
const ROOM = "seed-w", SECRET = "seed-invite", BEAT = 400, MINRATE = 300;
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const open = async (params) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${base}/web/watch.html?${new URLSearchParams({ room: ROOM, secret: SECRET, k: 2, beat: BEAT, minrate: MINRATE, ...params })}`);
  return page;
};

const gen = await open({ role: "gen", id: "gen-a", clipmode: "png" });
await gen.waitForFunction(() => window.state && window.state.pub, null, { timeout: 15000 });
const pub = await gen.evaluate(() => window.state.pub);

// ── 1 · promotion, then demotion — no UI touched ─────────────────────────────
const vA = await open({ role: "viewer", id: "sv-a", pub });
await vA.waitForFunction(() => window.state.tower === true && window.state.capNow === "relay", null, { timeout: 25000 }).catch(() => {});
const a1 = await vA.evaluate(() => ({ tower: window.state.tower, cap: window.state.capNow, played: window.state.played.length }));
ok(a1.tower && a1.cap === "relay", "1. a set that just WATCHES earns towerhood (zero UI events)", JSON.stringify(a1));
await vA.evaluate(() => window.__meter.setVisible(false));
await vA.waitForFunction(() => window.state.capNow === "leaf", null, { timeout: 8000 }).catch(() => {});
ok((await vA.evaluate(() => window.state.capNow)) === "leaf", "1. a backgrounded set DEMOTES itself within beats");
await vA.evaluate(() => window.__meter.setVisible(true));

// ── 2 · seeding: late joiners tune into the archive from the audience ────────
await gen.waitForFunction(() => window.state.published.length >= 8, null, { timeout: 30000 });
await vA.waitForFunction(() => window.state.storeStats && window.state.storeStats.items > 8, null, { timeout: 20000 }).catch(() => {});
const vL = await open({ role: "viewer", id: "sv-l", pub });
await vL.waitForFunction(() => window.state.historyCount >= 4, null, { timeout: 20000 }).catch(() => {});
const l = await vL.evaluate(() => ({ hist: window.state.historyCount, ms: window.state.historyMs, from: window.state.histFrom }));
ok(l.hist >= 4, "2. a late joiner fills its reel with HISTORY from the audience", JSON.stringify(l));
ok(!Object.keys(l.from || {}).includes("gen-a"), "2. the desk served ZERO history bytes (peers only)", "from=" + Object.keys(l.from || {}));
ok(l.ms != null && l.ms < 2000, "2. first history picture inside the 2s budget", l.ms + "ms");

// poison EVERY seeder first (deterministic — whoever answers, it lies), then
// heal one and watch the fetch route around the rot.
await vA.evaluate(() => (window.__corruptServe = true));
await vL.evaluate(() => (window.__corruptServe = true));
const vM = await open({ role: "viewer", id: "sv-m", pub });
await vM.waitForFunction(() => window.state && window.state.histRejects >= 1, null, { timeout: 15000 }).catch(() => {});
const mA = await vM.evaluate(() => ({ rejects: window.state.histRejects, hist: window.state.historyCount }));
ok(mA.rejects >= 1 && mA.hist === 0, "2. corrupted serves are REJECTED by rederivation, nothing laundered", JSON.stringify(mA));
await vA.evaluate(() => (window.__corruptServe = false));
await vM.waitForFunction(() => window.state.historyCount >= 1, null, { timeout: 12000 }).catch(() => {});
const mB = await vM.evaluate(() => ({ rejects: window.state.histRejects, hist: window.state.historyCount }));
ok(mB.hist >= 1, "2. and the fetch ROUTES AROUND the liar the moment an honest peer exists", JSON.stringify(mB));
await vL.evaluate(() => (window.__corruptServe = false));

// ── 3 · the desk dies; the audience IS the archive ───────────────────────────
await gen.context().close();                       // a crash: no bye
await sleep(BEAT * 4);                             // the eviction beats pass
const vZ = await open({ role: "viewer", id: "sv-z", pub });
await vZ.waitForFunction(() => window.state.historyCount >= 4, null, { timeout: 20000 }).catch(() => {});
const z = await vZ.evaluate(() => ({ hist: window.state.historyCount, members: window.state.peers, all: window.net().members() }));
ok(z.hist >= 4, "3. the desk is DEAD and a new set still tunes into the archive from the audience", JSON.stringify(z));
ok(!z.all.includes("gen-a"), "3. the crashed desk was evicted by heartbeat silence (no bye was ever sent)", "members=" + z.all);

await browser.close(); server.close();
console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
