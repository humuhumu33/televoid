#!/usr/bin/env node
// director-fal.mjs — the REAL clip source: Minimax H3 Max via fal.ai's queue API.
//
// The generation side of the Infinite Channel. Scales with minutes generated,
// never with viewers — the one honest centralized dependency (stated, not
// hidden), swappable for any model with the same three-call shape.
//
//   FAL_KEY=... node director/director-fal.mjs "a weary alien interviews a houseplant"
//   FAL_KEY=... node director/director-fal.mjs --model fal-ai/minimax/h3-max/text-to-video "prompt"
//
// Measured (fal free playground, 2026-08-29): a 5.18 s 1344×768 clip in ~3–4 s
// wall — faster than realtime on ONE request, unbounded with parallel requests.
// Endpoint id VERIFIED against the queue API 2026-08-29: this id (and the
// shorter `fal-ai/minimax/h3-max`) routes to a real application; a wrong id
// returns "Application not found" instead.
//
// Wiring into the channel (the generator page / a Node generator):
//   const bytes = await generateClip({ prompt, key: process.env.FAL_KEY });
//   await gen.publishClip(bytes, { title: prompt, durMs: 5000 });

import { writeFileSync, mkdirSync } from "node:fs";

const DEFAULT_MODEL = "fal-ai/minimax/h3-max/text-to-video";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function generateClip({ prompt, key, model = DEFAULT_MODEL, input = {} } = {}) {
  if (!key) throw new Error("FAL_KEY required");
  const H = { authorization: "Key " + key, "content-type": "application/json" };
  const sub = await fetch(`https://queue.fal.run/${model}`, { method: "POST", headers: H, body: JSON.stringify({ prompt, ...input }) });
  if (!sub.ok) throw new Error(`submit ${sub.status}: ${await sub.text()}`);
  const q = await sub.json();
  for (;;) {
    const st = await (await fetch(q.status_url, { headers: H })).json();
    if (st.status === "COMPLETED") break;
    if (st.status === "FAILED" || st.error) throw new Error("generation failed: " + JSON.stringify(st));
    await sleep(500);
  }
  const out = await (await fetch(q.response_url, { headers: H })).json();
  const url = out.video?.url || out.videos?.[0]?.url || out.url;
  if (!url) throw new Error("no video url in response: " + JSON.stringify(out).slice(0, 400));
  return new Uint8Array(await (await fetch(url)).arrayBuffer());
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("director-fal.mjs")) {
  const args = process.argv.slice(2);
  const mi = args.indexOf("--model");
  const model = mi >= 0 ? args.splice(mi, 2)[1] : DEFAULT_MODEL;
  const prompt = args.join(" ").trim();
  if (!prompt) { console.error("usage: FAL_KEY=... node director/director-fal.mjs [--model id] \"prompt\""); process.exit(2); }
  const t0 = Date.now();
  const bytes = await generateClip({ prompt, key: process.env.FAL_KEY, model });
  mkdirSync("clips", { recursive: true });
  const file = `clips/clip-${Date.now()}.mp4`;
  writeFileSync(file, bytes);
  const d = await crypto.subtle.digest("SHA-256", bytes);
  const kappa = Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
  console.log(`${file}  ${bytes.length} bytes  ${((Date.now() - t0) / 1000).toFixed(1)}s  sha256:${kappa}`);
}
