// shot-landing.mjs — frames of the front of the set: off, and mid power on.
import { startRelay } from "./signal-relay.mjs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); }
catch { ({ chromium } = createRequire("C:/Users/pavel/Desktop/HOLOGRAM/holo-os/system/")("playwright")); }

const server = await startRelay(9041);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 810 } })).newPage();
await page.goto("http://127.0.0.1:9041/index.html");
await page.waitForTimeout(600);
await page.screenshot({ path: "televoid-landing-off.png" });
await page.click("#power");
await page.waitForTimeout(400);
await page.screenshot({ path: "televoid-landing-on.png" });
console.log("saved televoid-landing-off.png televoid-landing-on.png");
await browser.close(); server.close();
