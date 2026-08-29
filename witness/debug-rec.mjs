// Minimal repro: does canvas.captureStream + MediaRecorder alone survive?
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); }
catch { ({ chromium } = createRequire("C:/Users/pavel/Desktop/HOLOGRAM/holo-os/system/")("playwright")); }

const channel = process.argv[2] || "chromium";
const browser = await chromium.launch(channel === "shell" ? {} : { channel });
const page = await browser.newPage();
page.on("crash", () => console.log("[CRASH]"));
page.on("pageerror", (e) => console.log("[err]", e.message));
await page.setContent(`<canvas id=c width=320 height=180></canvas>`);
const r = await page.evaluate(async () => {
  const c = document.getElementById("c");
  const ctx = c.getContext("2d");
  let f = 0;
  const iv = setInterval(() => { ctx.fillStyle = "#" + ((f * 999) % 4096).toString(16).padStart(3, "0"); ctx.fillRect(0, 0, 320, 180); f++; }, 66);
  const mime = ["video/webm;codecs=vp8", "video/webm"].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
  if (!mime) return { mime: null };
  const stream = c.captureStream(15);
  const sizes = [];
  for (let i = 0; i < 3; i++) {
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 400000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
    await new Promise((res) => { rec.onstop = res; rec.start(); setTimeout(() => rec.stop(), 800); });
    sizes.push(new Blob(chunks).size);
  }
  clearInterval(iv);
  return { mime, sizes };
}).catch((e) => ({ fail: e.message }));
console.log(JSON.stringify(r));
await browser.close();
