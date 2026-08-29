// shot.mjs — one framed screenshot of each end of the set, for humans.
import { startRelay } from "./signal-relay.mjs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); }
catch { ({ chromium } = createRequire("C:/Users/pavel/Desktop/HOLOGRAM/holo-os/system/")("playwright")); }

const server = await startRelay(8998);
const base = "http://127.0.0.1:8998";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const gen = await ctx.newPage();
await gen.goto(`${base}/web/watch.html?role=gen&id=g1&room=shot&secret=s&k=2&clipmode=png`);
await gen.waitForFunction(() => window.state && window.state.pub, null, { timeout: 15000 });
const pub = await gen.evaluate(() => window.state.pub);
const v = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await v.goto(`${base}/web/watch.html?role=viewer&id=v1&room=shot&secret=s&k=2&pub=${pub}`);
await v.waitForFunction(() => window.state.played.length >= 1, null, { timeout: 30000 }).catch(() => {});
await v.waitForTimeout(500);
await v.screenshot({ path: "televoid-viewer.png" });
await gen.screenshot({ path: "televoid-desk.png" });
// and the tuning state (a fresh set, mid static)
const t = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await t.goto(`${base}/web/watch.html?role=viewer&id=v2&room=elsewhere&secret=s&k=2&pub=${pub}`);
await t.waitForTimeout(1200);
await t.screenshot({ path: "televoid-tuning.png" });
console.log("saved televoid-viewer.png televoid-desk.png televoid-tuning.png");
await browser.close(); server.close();
