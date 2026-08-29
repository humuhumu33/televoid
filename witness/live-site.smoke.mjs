// live-site.smoke.mjs — the deployed page, end to end: open the REAL
// https://humuhumu33.github.io/televoid/ landing, press power, get a desk on
// the SERVERLESS door, beam the channel link, and have a second browser tune
// in and play. Nothing local is involved except the two browsers.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); }
catch { ({ chromium } = createRequire("C:/Users/pavel/Desktop/HOLOGRAM/holo-os/system/")("playwright")); }

let pass = 0, fail = 0;
const ok = (c, m, d = "") => { console.log((c ? "  ok  " : "  XX  ") + m + (d ? " — " + d : "")); if (c) pass++; else fail++; };

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const land = await (await browser.newContext()).newPage();
await land.goto("https://humuhumu33.github.io/televoid/");
ok((await land.title()) === "TELEVOID", "the landing is live and named");
await land.click("#power");
await land.waitForFunction(() => window.state && window.state.pub, null, { timeout: 30000 });
const url = new URL(land.url());
ok(url.pathname.endsWith("/web/watch.html") && url.searchParams.get("role") === "gen", "power button minted a fresh desk", url.search.slice(0, 40) + "…");
// headless builds crash on MediaRecorder (witness/debug-rec.mjs) — pin stills
// for the smoke run; a human browser takes the webm path on this same URL.
url.searchParams.set("clipmode", "png");
await land.goto(url.toString());
await land.waitForFunction(() => window.state && window.state.pub, null, { timeout: 30000 });
await land.waitForFunction(() => window.state.published.length >= 2, null, { timeout: 40000 }).catch(() => {});
const g = await land.evaluate(() => ({ pub: window.state.pub, published: window.state.published.length, mode: window.state.mode }));
ok(g.published >= 2, "the desk broadcasts from the live page (serverless door, no relay anywhere)", `published=${g.published} mode=${g.mode}`);

const share = await land.evaluate(() => {
  const u = new URL(location.href);
  u.searchParams.set("role", "viewer");
  for (const p of ["id", "clipmode", "cap", "model"]) u.searchParams.delete(p);
  u.searchParams.set("pub", window.state.pub);
  return u.toString();
});
const set = await (await browser.newContext()).newPage();
set.on("pageerror", (e) => console.log("[set err]", e.message));
set.on("console", (m) => { if (m.type() === "error") console.log("[set con]", m.text().slice(0, 160)); });
set.on("crash", () => console.log("[set CRASH]"));
await set.goto(share);
await set.waitForFunction(() => window.state && (window.state.played.length >= 1 || window.state.historyCount >= 1), null, { timeout: 60000 }).catch(() => {});
const v = await set.evaluate(() => ({ played: window.state.played.length, hist: window.state.historyCount, links: window.state.links }));
ok(v.played >= 1 || v.hist >= 1, "a beamed link tunes a second browser into the live channel", JSON.stringify(v));

await browser.close();
console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
