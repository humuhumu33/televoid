#!/usr/bin/env node
// live.witness.mjs — the LIVE witness: the whole Infinite Channel over REAL
// browsers and a REAL network path. One generator page + three viewer pages in
// separate Chromium contexts; links are real RTCDataChannels shaped by the
// deterministic tree; clips are real MediaRecorder webm (PNG stills where the
// headless build lacks an encoder — the mode is reported, not hidden).
//
// Proves, live: viewers PLAY the generator's clips (same κ), the generator's
// links stay ≤ k+1, a killed viewer rejoins under a PEER and plays on.
//
//   node witness/live.witness.mjs [port]

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { startRelay } from "./signal-relay.mjs";
import { treeOf } from "../vendor/holo-fabric-tree.mjs";

// playwright comes from the hologram workspace next door (vendored-not-installed
// discipline; see README — `npm i playwright` anywhere on the resolve path works too).
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); }
catch { ({ chromium } = createRequire("C:/Users/pavel/Desktop/HOLOGRAM/holo-os/system/")("playwright")); }

let pass = 0, fail = 0;
const ok = (c, m, d = "") => { console.log((c ? "  ok  " : "  XX  ") + m + (d ? " — " + d : "")); if (c) pass++; else fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PORT = +(process.argv[2] || 8974);
const K = 2, ROOM = "live-w", SECRET = "live-invite";
const server = await startRelay(PORT);
const base = `http://127.0.0.1:${PORT}`;

// Headless media stacks (shell AND Chrome-for-Testing headless, this machine)
// CRASH on canvas.captureStream+MediaRecorder — witnessed via debug-rec.mjs.
// So the live witness runs the generator in clipmode=png (stills). The webm
// path is the same code driven by a desktop browser; MOVING video over this
// exact fabric is already witnessed by hologram-apps holo-fabric-call.witness.
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const open = async (params) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${base}/web/watch.html?${new URLSearchParams(params)}`);
  return page;
};

const gen = await open({ role: "gen", id: "gen-a", room: ROOM, secret: SECRET, k: K, clipmode: "png" });
await gen.waitForFunction(() => window.state && window.state.pub, null, { timeout: 15000 });
const pub = await gen.evaluate(() => window.state.pub);

const v = {};
for (const id of ["vw-b", "vw-c", "vw-d"]) v[id] = await open({ role: "viewer", id, room: ROOM, secret: SECRET, k: K, pub });

// ── clips flow to every viewer over real data channels ───────────────────────
for (const [id, page] of Object.entries(v))
  await page.waitForFunction(() => window.state.played.length >= 2, null, { timeout: 45000 }).catch(() => {});
const st = {};
for (const [id, page] of Object.entries(v)) st[id] = await page.evaluate(() => window.state);
const g = await gen.evaluate(() => window.state);

ok(Object.values(st).every((s) => s.played.length >= 2), "every viewer PLAYED ≥2 live clips over real RTCDataChannels",
  JSON.stringify(Object.fromEntries(Object.entries(st).map(([i, s]) => [i, s.played.length]))));
const pubKappas = new Set(g.published.map((p) => p.kappa));
ok(Object.values(st).every((s) => s.played.every((p) => pubKappas.has(p.kappa))),
  "every played clip κ is one the generator SIGNED and published (nothing else plays)");
const common = st["vw-b"].played.map((p) => p.kappa).filter((k2) => st["vw-c"].played.some((p) => p.kappa === k2));
ok(common.length >= 1, "viewers share the SAME clips (κ-identical across contexts)", "shared=" + common.length);
ok(Object.values(st).some((s) => s.played.some((p) => p.w > 0)),
  `clips actually RENDER — a media element decoded real pixels (mode=${g.mode})`);
ok(g.links <= K + 1, "generator links bounded ≤ k+1 (O(k) uplink, audience-independent)", "links=" + g.links);

// ── kill vw-d; rejoin under a PEER; the stream survives churn ────────────────
await v["vw-d"].evaluate(() => window.leaveNet());
await v["vw-d"].context().close();
delete v["vw-d"];
await sleep(1200);

let rid = null;
for (let i = 0; i < 500 && !rid; i++) {
  const cand = "vw-re" + i;
  const T = treeOf(["gen-a", "vw-b", "vw-c", cand], K);
  if (T.parentOf(cand) && T.parentOf(cand) !== "gen-a" && !T.childrenOf(cand).includes("gen-a")) rid = cand;
}
const re = await open({ role: "viewer", id: rid, room: ROOM, secret: SECRET, k: K, pub });
await re.waitForFunction(() => window.state.played.length >= 1, null, { timeout: 45000 }).catch(() => {});
const rs = await re.evaluate(() => window.state);
ok(rs.played.length >= 1, "rejoined viewer plays the live stream again (anchored mid-chain)", "played=" + rs.played.length);
ok(!rs.peers.includes("gen-a"), "rejoined viewer's data-channel peers EXCLUDE the generator (peers-only)", "peers=" + rs.peers.join(","));

// ── chat rides the same fabric back up the tree ──────────────────────────────
await re.evaluate(() => window.sendChat("giant spider learns to tapdance"));
await gen.waitForFunction(() => window.state.chat.length >= 1, null, { timeout: 10000 }).catch(() => {});
const gchat = await gen.evaluate(() => window.state.chat);
ok(gchat.some((c) => c.text.includes("tapdance")), "a viewer PROMPT reached the generator over the fabric (the input rail)", JSON.stringify(gchat));

await browser.close();
server.close();
console.log(`\n${pass} ok, ${fail} failed   (clip mode: ${g.mode}, ${g.published.length} clips published)`);
process.exit(fail ? 1 : 0);
