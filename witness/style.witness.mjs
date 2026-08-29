#!/usr/bin/env node
// style.witness.mjs — the portal terminal laws, enforced:
//
//   1. NO HYPHEN  — the character "-" appears in no user facing string
//                   (web/strings.mjs, deep, functions sampled) and nowhere in
//                   README prose (code spans, fenced blocks, link targets and
//                   URLs are code, not prose — stripped before the scan).
//   2. NO SCROLL  — the page never grows a scrollbar, phone (360×640) through
//                   4K (3840×2160).
//   3. THE RATIO  — PHI is exported, --phi is set, and the rendered screen to
//                   console split measures phi within 3%.
//   4. INSTANT    — measured, not intended: cold static under 1.5s, warm
//                   reload static under 400ms (service worker shell), zap
//                   static within 120ms of input, every clip assembled BEFORE
//                   its air time (positive prefetch slack), a viewer
//                   transmission acknowledged by the desk under 1s.
//
//   node witness/style.witness.mjs [port]

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { startRelay } from "./signal-relay.mjs";
import * as STRINGS from "../web/strings.mjs";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); }
catch { ({ chromium } = createRequire("C:/Users/pavel/Desktop/HOLOGRAM/holo-os/system/")("playwright")); }

let pass = 0, fail = 0;
const ok = (c, m, d = "") => { console.log((c ? "  ok  " : "  XX  ") + m + (d ? " — " + d : "")); if (c) pass++; else fail++; };
const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── 1 · no hyphen ────────────────────────────────────────────────────────────
{
  const bad = [];
  const walk = (v, at) => {
    if (typeof v === "string") { if (v.includes("-") || v.includes("—")) bad.push(at + ": " + v); }
    else if (typeof v === "function") { try { walk(v(2, "sample"), at + "()"); } catch {} }
    else if (v && typeof v === "object") for (const [k2, x] of Object.entries(v)) walk(x, at + "." + k2);
  };
  for (const [k2, v] of Object.entries(STRINGS)) if (k2 !== "PHI") walk(v, k2);
  ok(bad.length === 0, "1. zero hyphens across every user facing string", bad.join(" | "));

  let md = readFileSync(path.join(HERE, "..", "README.md"), "utf8");
  md = md.replace(/```[\s\S]*?```/g, "")        // fenced blocks are code
         .replace(/`[^`\n]*`/g, "")             // inline code is code
         .replace(/\]\([^)]*\)/g, "]")          // link targets are addresses
         .replace(/https?:\S+/g, "")            // URLs are addresses
         .replace(/^\s*\|[\s|:-]+\|\s*$/gm, "");// GFM table separator rows are syntax, invisible when rendered
  const hits = [...md.matchAll(/[^\s]*[-—][^\s]*/g)].map((m) => m[0]);
  ok(hits.length === 0, "1. zero hyphens and zero em dashes in README prose (code and addresses exempt)", hits.slice(0, 6).join(" "));
}

// ── 2–4 · the living page ────────────────────────────────────────────────────
const PORT = +(process.argv[2] || 8985);
const server = await startRelay(PORT);
const base = `http://127.0.0.1:${PORT}`;
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });

const genCtx = await browser.newContext();
const gen = await (await genCtx.newPage());
await gen.goto(`${base}/web/watch.html?role=gen&id=sg-a&room=style-w&secret=s&k=2&clipmode=png`);
await gen.waitForFunction(() => window.state && window.state.pub, null, { timeout: 15000 });
const pub = await gen.evaluate(() => window.state.pub);

const openViewer = async (w, h) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.goto(`${base}/web/watch.html?role=viewer&id=sv-${w}&room=style-w&secret=s&k=2&pub=${pub}`);
  return page;
};

// 2 · no scroll at both extremes (leave the mesh politely — a closed context
// without a bye is a ghost member that orphans later joiners in the tree)
for (const [w, h] of [[360, 640], [3840, 2160]]) {
  const p = await openViewer(w, h);
  await p.waitForTimeout(800);
  const m = await p.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight,
                                      sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  ok(m.sh <= m.ch + 1 && m.sw <= m.cw + 1, `2. no scrollbar at ${w}×${h}`, JSON.stringify(m));
  await p.evaluate(() => window.leaveNet && window.leaveNet()).catch(() => {});
  await p.context().close();
}

// 3 · the ratio, exported and rendered
const v = await openViewer(1280, 800);
await v.waitForFunction(() => window.state.played.length >= 2, null, { timeout: 30000 });
ok(Math.abs(STRINGS.PHI - 1.618) < 1e-9, "3. PHI exported as 1.618");
const ratio = await v.evaluate(() => {
  const phi = getComputedStyle(document.documentElement).getPropertyValue("--phi").trim();
  const s = document.getElementById("screen").getBoundingClientRect().height;
  const c = document.getElementById("console").getBoundingClientRect().height;
  return { phi, split: s / c };
});
ok(ratio.phi === "1.618" && Math.abs(ratio.split - 1.618) / 1.618 < 0.03,
  "3. screen : console renders at phi (within 3%)", JSON.stringify(ratio));

// 4 · instant, measured
const cold = await v.evaluate(() => window.state.paintMs);
ok(cold != null && cold < 1500, "4. cold first picture (static) under 1.5s", Math.round(cold) + "ms");
await v.bringToFront();          // an unfocused headless page throttles rAF; the budget is for a watched set
await v.waitForTimeout(200);
await v.evaluate(() => window.zap());
await v.waitForFunction(() => window.state.zapMs != null, null, { timeout: 5000 });
const zapMs = await v.evaluate(() => window.state.zapMs);
ok(zapMs < 120, "4. zap static within 120ms of input", Math.round(zapMs) + "ms");
const slack = await v.evaluate(() => window.state.readySlack);
ok(slack.length >= 2 && slack.every((s) => s > 0), "4. every clip assembled BEFORE its air time (prefetch slack positive)",
  JSON.stringify(slack.map((s) => Math.round(s))));
const tSend = Date.now();
await v.evaluate(() => window.sendChat("a couch that reviews couches"));
await gen.waitForFunction(() => window.state.chat.some((c) => c.text.includes("couch")), null, { timeout: 5000 }).catch(() => {});
const ackMs = Date.now() - tSend;
const gotChat = await gen.evaluate(() => window.state.chat.length > 0);
ok(gotChat && ackMs < 1000, "4. viewer transmission acknowledged by the desk under 1s", ackMs + "ms");

// warm reload: the service worker shell paints from disk
await v.waitForTimeout(700);                     // let the SW finish install
await v.reload();
await v.waitForFunction(() => window.state && window.state.paintMs != null, null, { timeout: 10000 });
const warm = await v.evaluate(() => window.state.paintMs);
ok(warm < 400, "4. warm reload first picture under 400ms (service worker shell)", Math.round(warm) + "ms");

await browser.close(); server.close();
console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
