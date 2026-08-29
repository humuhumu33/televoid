#!/usr/bin/env node
// tower.witness.mjs — EVERY SET A TOWER, the pure proof (no network, no browser):
//
//   1. BRAID    — interior(A) ∩ interior(B) is empty at N = 8 / 16 / 32 with
//                 mixed capacities; both trees connected; identical on every peer.
//   2. METER    — a set that measures well is promoted after 2 good windows;
//                 one bad window (hidden tab / stalled store / thin pipe) demotes.
//   3. STORE    — verify on write (a wrong κ is refused), REVERIFY on read
//                 (a rotted file is evicted, never served), LRU by air time.
//   4. STORM    — 1 desk + 10 sets on the braid; 3 sets CRASH mid broadcast
//                 (no byes), one of them an interior tower; the NEXT clip still
//                 reaches every survivor BEFORE its air time (braid redundancy,
//                 pre eviction), and after the eviction beat the healed braid
//                 carries on.
//   5. TX RATIO — the audience IS the network: viewers collectively push ≥ 3×
//                 the bytes the desk pushes.
//
//   node witness/tower.witness.mjs

import { braidOf } from "../src/braid.mjs";
import { makeMeter } from "../src/measure.mjs";
import { openStore, memBackend } from "../src/store.mjs";
import { sha256hex } from "../src/wire.mjs";
import { memLinkPair } from "../vendor/holo-fabric.mjs";
import { createChannel } from "../src/strand.mjs";
import { makeGenerator, makeViewer, roomKeyFromSecret } from "../src/channel.mjs";

let pass = 0, fail = 0;
const ok = (c, m, d = "") => { console.log((c ? "  ok  " : "  XX  ") + m + (d ? " — " + d : "")); if (c) pass++; else fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const K = 2;

// ── 1 · the braid property ───────────────────────────────────────────────────
for (const N of [8, 16, 32]) {
  const members = [{ id: "gen", cap: "relay" }];
  for (let i = 1; i < N; i++) members.push({ id: "s" + i, cap: i % 3 === 0 ? "leaf" : "relay" });
  const { A, B, interiorA, interiorB } = braidOf(members, K);
  const cross = [...interiorA].filter((id) => interiorB.has(id));
  ok(A.connected && B.connected && cross.length === 0,
    `1. braid at N=${N}: both trees connected, interior(A) ∩ interior(B) = ∅`,
    `iA=${interiorA.size} iB=${interiorB.size} cross=${cross.length}`);
}

// ── 2 · the meter ────────────────────────────────────────────────────────────
{
  let t = 0; const clock = () => t;
  const m = makeMeter({ now: clock, windowMs: 1000, minRate: 4000, promoteAfter: 2 });
  const feed = (bytes) => { m.onBytes(bytes); t += 1001; m.cap(); };
  ok(m.cap() === "leaf", "2. a set is born a leaf");
  feed(8000); feed(8000);
  ok(m.cap() === "relay", "2. two good windows promote it to a tower (no UI, no toggle)");
  m.setVisible(false); t += 1001;
  ok(m.cap() === "leaf", "2. one bad window (backgrounded) demotes it immediately");
  m.setVisible(true); feed(8000); feed(8000);
  ok(m.cap() === "relay", "2. recovery re earns towerhood the same silent way");
}

// ── 3 · the store discipline ─────────────────────────────────────────────────
{
  const be = memBackend();
  const st = await openStore({ backend: be, maxBytes: 250_000 });
  const bytes = new Uint8Array(100_000).map((_, i) => i & 0xff);
  const kappa = await sha256hex(bytes);
  ok(await st.put("seg", kappa, 1000, bytes), "3. verified bytes are stored");
  ok(!(await st.put("seg", "0".repeat(64), 1000, bytes)), "3. bytes that do not rederive to κ are REFUSED at the door");
  const files = await be.list();
  await be.write(files[0].name, new Uint8Array(100_000));            // rot the file behind the store's back
  ok((await st.get(kappa)) === null && !st.has(kappa), "3. a rotted file is evicted on read, never served");
  for (let i = 0; i < 4; i++) { const b = new Uint8Array(100_000).map((_, j) => (j + i) & 0xff); await st.put("seg", await sha256hex(b), 2000 + i, b); }
  const left = (await be.list()).length;
  ok(left <= 2 && st.stats().bytes <= 250_000, "3. LRU by air time keeps the store under budget", JSON.stringify(st.stats()));
}

// ── 4+5 · the storm and the ratio ────────────────────────────────────────────
{
  const roomKey = await roomKeyFromSecret("tower-witness");
  const channel = await createChannel();
  const members = [{ id: "gen", cap: "relay" }];
  for (let i = 1; i <= 10; i++) members.push({ id: "s" + i, cap: i % 3 === 0 ? "leaf" : "relay" });

  const nodes = new Map();          // id → { engine, links: Map(peer → link), tx }
  const played = new Map();         // id → [{seq, slack}]
  const gen = makeGenerator({ roomKey, channel, self: "gen", lagMs: 300 });
  nodes.set("gen", { engine: gen, links: new Map(), tx: 0 });
  for (const m of members) if (m.id !== "gen") {
    const v = makeViewer({ roomKey, alg: channel.alg, publicJwk: channel.publicJwk, self: m.id,
      onClip: ({ meta, readyAt }) => (played.get(m.id) || played.set(m.id, []).get(m.id)).push({ seq: meta.seq, slack: meta.startAt - readyAt }) });
    nodes.set(m.id, { engine: v, links: new Map(), tx: 0 });
  }
  const connect = (a, b) => {
    const A = nodes.get(a), B = nodes.get(b);
    if (!A || !B || A.links.has(b)) return;
    const [la, lb] = memLinkPair();
    const sa = la.send, sb = lb.send;
    la.send = (buf) => { A.tx += buf.byteLength || 0; sa(buf); };
    lb.send = (buf) => { B.tx += buf.byteLength || 0; sb(buf); };
    A.engine.fabric.addLink(la); B.engine.fabric.addLink(lb);
    A.links.set(b, la); B.links.set(a, lb);
  };
  const disconnect = (a, b) => {
    const A = nodes.get(a), B = nodes.get(b);
    if (A && A.links.has(b)) { A.engine.fabric.removeLink(A.links.get(b)); A.links.delete(b); }
    if (B && B.links.has(a)) { B.engine.fabric.removeLink(B.links.get(a)); B.links.delete(a); }
  };
  const syncBraid = (ms) => {
    const { A, B } = braidOf(ms, K);
    const want = new Set();
    for (const m of ms) for (const T of [A, B]) { const p = T.parentOf(m.id); if (p) want.add([m.id, p].sort().join("|")); }
    for (const [id, n] of nodes) for (const peer of [...n.links.keys()])
      if (!want.has([id, peer].sort().join("|"))) disconnect(id, peer);
    for (const e of want) { const [a, b] = e.split("|"); if (nodes.has(a) && nodes.has(b)) connect(a, b); }
  };
  syncBraid(members);

  const clip = (n) => new Uint8Array(150_000).map((_, i) => (i * 31 + n * 7) & 0xff);
  await gen.publishClip(clip(0), { title: "cold open", durMs: 1000 });
  await gen.publishClip(clip(1), { title: "steady state", durMs: 1000 });
  await sleep(700);
  ok(members.slice(1).every((m) => (played.get(m.id) || []).length === 2), "4. steady state: all 10 sets play on the braid");

  // THE STORM: one interior tower + two leaves CRASH (links die, no bye, no
  // recompute yet). Leaf victims chosen OUTSIDE interior(B), so the storm
  // tests redundancy, not a double failure the braid never promised to survive.
  const { interiorA, interiorB } = braidOf(members, K);
  const towerVictim = [...interiorA].find((id) => id !== "gen" && !interiorB.has(id));
  const leafVictims = members.filter((m) => m.cap === "leaf" && !interiorB.has(m.id)).slice(0, 2).map((m) => m.id);
  const victims = [towerVictim, ...leafVictims];
  for (const v of victims) { for (const peer of [...nodes.get(v).links.keys()]) disconnect(v, peer); nodes.get(v).engine.close && nodes.get(v).engine.close(); nodes.delete(v); }
  const survivors = members.filter((m) => !victims.includes(m.id));

  await gen.publishClip(clip(2), { title: "through the storm", durMs: 1000 });
  await sleep(700);
  const storm = survivors.filter((m) => m.id !== "gen").map((m) => (played.get(m.id) || []).find((p) => p.seq === 2));
  ok(storm.every((p) => p && p.slack > 0),
    `4. STORM: tower ${towerVictim} + 2 leaves crash, NO recompute yet — every survivor still plays clip 2 BEFORE air time`,
    "slack=" + storm.map((p) => p && Math.round(p.slack)));

  // the eviction beat: survivors recompute without the dead; the braid heals
  syncBraid(survivors);
  await gen.publishClip(clip(3), { title: "healed", durMs: 1000 });
  await sleep(700);
  ok(survivors.filter((m) => m.id !== "gen").every((m) => (played.get(m.id) || []).some((p) => p.seq === 3)),
    "4. after the eviction beat the healed braid carries clip 3 to everyone");

  const deskTx = nodes.get("gen").tx;
  const viewerTx = [...nodes.entries()].filter(([id]) => id !== "gen").reduce((n, [, x]) => n + x.tx, 0);
  ok(viewerTx >= 3 * deskTx, "5. the audience IS the network: viewers pushed ≥ 3× the desk's bytes",
    `desk=${deskTx} viewers=${viewerTx} ratio=${(viewerTx / deskTx).toFixed(1)}×`);
}

console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
