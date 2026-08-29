#!/usr/bin/env node
// channel.witness.mjs — the PURE witness: the whole Infinite Channel invariant
// with zero network, zero browser, zero mocks of the product path.
//
//   1 generator + 3 viewers on a k-bounded distribution tree (vendor holo-fabric
//   + treeOf — the REAL modules), synthetic clip bytes standing in for Minimax
//   clips (the transport is what's on trial, not the codec).
//
// Proves:
//   A. SHARED CLOCK  — every viewer plays the SAME clip (same κ) at the SAME
//                      scheduled startAt, not on arrival.
//   B. O(k) UPLINK   — the generator holds ≤ k+1 links no matter the audience.
//   C. VERIFIED BYTES— a relay-corrupted object is DROPPED (fabric κ re-derive);
//                      a manifest signed by the WRONG key is REFUSED (strand).
//   D. PEERS ONLY    — a viewer killed and rejoined resyncs from PEERS (its tree
//                      links exclude the generator) and plays the next clip.
//
//   node witness/channel.witness.mjs

import { makeFabric, memLinkPair, roomKeyFromRaw } from "../vendor/holo-fabric.mjs";
import { treeOf } from "../vendor/holo-fabric-tree.mjs";
import { createChannel } from "../src/strand.mjs";
import { makeGenerator, makeViewer, roomKeyFromSecret } from "../src/channel.mjs";
import { pack, sha256hex } from "../src/wire.mjs";

let pass = 0, fail = 0;
const ok = (c, m, d = "") => { console.log((c ? "  ok  " : "  XX  ") + m + (d ? " — " + d : "")); if (c) pass++; else fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── a tiny in-process network: nodes, links, and a tree-shaped edge set ──────
const K = 2;
const nodes = new Map();          // id → { fabric, links: Map(peerId → link) }
function register(id, fabric) { nodes.set(id, { fabric, links: new Map() }); }
function connect(a, b) {
  const A = nodes.get(a), B = nodes.get(b);
  if (!A || !B || A.links.has(b)) return;
  const [la, lb] = memLinkPair();
  A.fabric.addLink(la); B.fabric.addLink(lb);
  A.links.set(b, la); B.links.set(a, lb);
}
function disconnect(a, b) {
  const A = nodes.get(a), B = nodes.get(b);
  if (A && A.links.has(b)) { A.fabric.removeLink(A.links.get(b)); A.links.delete(b); }
  if (B && B.links.has(a)) { B.fabric.removeLink(B.links.get(a)); B.links.delete(a); }
}
// make the live link set equal the tree of `members` (what the gossiped
// membership + makeTree does per-peer in the browser; here the witness is god).
function syncTree(members) {
  const T = treeOf(members, K);
  const want = new Set();
  for (const id of members) { const p = T.parentOf(id); if (p) want.add([id, p].sort().join("|")); }
  for (const [id, n] of nodes) for (const peer of [...n.links.keys()]) {
    if (!want.has([id, peer].sort().join("|"))) disconnect(id, peer);
  }
  for (const e of want) { const [a, b] = e.split("|"); if (nodes.has(a) && nodes.has(b)) connect(a, b); }
  return T;
}

const secret = "witness-invite-secret";
const roomKey = await roomKeyFromSecret(secret);
const channel = await createChannel();
const LAG = 300;

// ── cast: generator + three viewers ──────────────────────────────────────────
const played = new Map();         // viewerId → [{kappa, at, startAt, bytesκ}]
function watch(id) {
  const v = makeViewer({
    roomKey, alg: channel.alg, publicJwk: channel.publicJwk, self: id,
    onClip: async ({ bytes, meta, kappa }) => {
      (played.get(id) || played.set(id, []).get(id)).push({ kappa, at: Date.now(), startAt: meta.startAt, bytesK: await sha256hex(bytes), seq: meta.seq });
    },
  });
  register(id, v.fabric);
  return v;
}
const gen = makeGenerator({ roomKey, channel, self: "gen", lagMs: LAG, onChat: (m) => chatSeen.push(m) });
register("gen", gen.fabric);
const chatSeen = [];
const v1 = watch("viewer-1"), v2 = watch("viewer-2"), v3 = watch("viewer-3");
let members = ["gen", "viewer-1", "viewer-2", "viewer-3"];
syncTree(members);

// ── A + B: two clips down the tree, played on the shared clock ───────────────
const clip = (n) => { const b = new Uint8Array(150_000); for (let i = 0; i < b.length; i++) b[i] = (i * 31 + n * 7) & 0xff; return b; };
const e0 = await gen.publishClip(clip(0), { title: "cold open", durMs: 5000 });
const e1 = await gen.publishClip(clip(1), { title: "scene two", durMs: 5000 });
await v1.sendChat("more couch, more cable");
await sleep(LAG + 500);

const allPlayedBoth = ["viewer-1", "viewer-2", "viewer-3"].every((id) => (played.get(id) || []).length === 2);
ok(allPlayedBoth, "A. every viewer played both clips", JSON.stringify([...played].map(([k, v]) => [k, v.length])));
const sameKappa = ["viewer-1", "viewer-2", "viewer-3"].every((id) => {
  const p = played.get(id) || [];
  return p[0] && p[0].kappa === (played.get("viewer-1") || [])[0].kappa && p[0].bytesK === (played.get("viewer-1") || [])[0].bytesK;
});
ok(sameKappa, "A. all viewers played the SAME clip 0 (manifest κ + assembled bytes κ identical)");
const onClock = [...played.values()].flat().every((p) => Math.abs(p.at - p.startAt) < 250);
ok(onClock, "A. clips fired on the SHARED CLOCK (|played − startAt| < 250ms), not on arrival",
  JSON.stringify([...played.values()].flat().map((p) => p.at - p.startAt)));
ok(gen.fabric.linkCount() <= K + 1, "B. generator uplink is bounded — links ≤ k+1 regardless of audience", "links=" + gen.fabric.linkCount());
ok(chatSeen.length === 1 && chatSeen[0].text.includes("couch"), "chat rides the same fabric (viewer prompt reached the generator)", JSON.stringify(chatSeen));

// ── C1: a corrupted object is dropped by κ re-derivation (blind-relay safety) ─
{
  const key = await roomKeyFromRaw(crypto.getRandomValues(new Uint8Array(32)));
  let got = 0;
  const rx = makeFabric({ key, onObject: () => got++ });
  const tx = makeFabric({ key });
  const [la, lb] = memLinkPair();
  const corrupting = { send: (buf) => { const u = new Uint8Array(buf.slice(0)); u[60] ^= 0xff; la.send(u.buffer); }, onMessage: null, close() {} };
  tx.addLink(corrupting); rx.addLink(lb);
  await tx.publish(pack({ t: "seg", seq: 0, i: 0 }, new Uint8Array(1000)));
  await sleep(50);
  ok(got === 0 && rx.stats().dropped >= 1, "C. a flipped byte anywhere is DROPPED on κ re-derivation", JSON.stringify(rx.stats()));
}

// ── C2: a manifest signed by the WRONG key is refused (room key ≠ authorship) ─
{
  const evil = await createChannel();                       // holds the ROOM key, not the CHANNEL key
  const evilGen = makeGenerator({ roomKey, channel: evil, self: "evil", lagMs: 0 });
  register("evil", evilGen.fabric);
  members = [...members, "evil"]; syncTree(members);
  const before = [...played.values()].flat().length;
  await evilGen.publishClip(clip(9), { title: "forged", durMs: 1000 });
  await sleep(300);
  const after = [...played.values()].flat().length;
  ok(after === before, "C. a clip signed by a NON-channel key never plays on any viewer", `played ${before}→${after}`);
  members = members.filter((m) => m !== "evil"); syncTree(members);
}

// ── D: kill viewer-3; rejoin under a PEER; next clip arrives peers-only ──────
disconnect("viewer-3", ...[]); // (links are torn by syncTree below)
v3.close(); nodes.delete("viewer-3");
members = members.filter((m) => m !== "viewer-3"); syncTree(members);

// choose a rejoin id whose tree parent is a VIEWER (deterministic rendezvous
// hashing lets any peer verify placement up front — same computation everywhere)
let rid = null;
for (let i = 0; i < 500 && !rid; i++) {
  const cand = "viewer-re" + i;
  const T = treeOf([...members, cand], K);
  if (T.parentOf(cand) && T.parentOf(cand) !== "gen" && !T.childrenOf(cand).includes("gen")) rid = cand;
}
const v3b = watch(rid);
members = [...members, rid]; syncTree(members);
const linkedTo = [...nodes.get(rid).links.keys()];
const e2 = await gen.publishClip(clip(2), { title: "after the storm", durMs: 5000 });
await sleep(LAG + 500);
const p3b = played.get(rid) || [];
ok(p3b.length === 1 && p3b[0].seq === 2, "D. rejoined viewer plays the NEXT clip (anchored mid-chain, seq 2)", JSON.stringify(p3b.map((p) => p.seq)));
ok(!linkedTo.includes("gen"), "D. rejoined viewer's links are PEERS ONLY (no generator edge)", "links=" + linkedTo.join(","));
const othersGot2 = ["viewer-1", "viewer-2"].every((id) => (played.get(id) || []).some((p) => p.seq === 2));
ok(othersGot2, "D. surviving viewers also played clip 2 (tree healed around the churn)");

console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
