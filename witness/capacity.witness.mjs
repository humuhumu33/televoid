#!/usr/bin/env node
// capacity.witness.mjs — the capacity-aware tree: weak peers sit at the leaves.
//
// Proves:
//   1. PLACEMENT   — with enough relays, NO leaf-class peer ever has children.
//   2. DEGRADATION — with too few relays the tree still forms, connected, and
//                    the relays that do exist take the topmost internal slots.
//   3. DETERMINISM — shuffled membership yields the identical tree (every peer
//                    computes the same placement — the coordinator-free law).
//   4. STABILITY   — leaf churn does not move the internal (relay) layer.
//   5. LIVE FLOW   — the full channel over a capacity tree: every viewer plays,
//                    and every leaf-class viewer FORWARDED ZERO objects.
//
//   node witness/capacity.witness.mjs

import { capacityTreeOf } from "../src/capacity-tree.mjs";
import { memLinkPair } from "../vendor/holo-fabric.mjs";
import { createChannel } from "../src/strand.mjs";
import { makeGenerator, makeViewer, roomKeyFromSecret } from "../src/channel.mjs";

let pass = 0, fail = 0;
const ok = (c, m, d = "") => { console.log((c ? "  ok  " : "  XX  ") + m + (d ? " — " + d : "")); if (c) pass++; else fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const K = 2;
const mk = (n, cap, pfx) => Array.from({ length: n }, (_, i) => ({ id: `${pfx}${i}`, cap }));

// 1 · enough relays → leaves have no children
{
  const members = [{ id: "gen", cap: "relay" }, ...mk(4, "relay", "r"), ...mk(6, "leaf", "l")]; // N=11, I=5, relays=5
  const T = capacityTreeOf(members, K);
  const leafKids = members.filter((m) => m.cap === "leaf").map((m) => T.childrenOf(m.id).length);
  ok(T.connected && leafKids.every((n) => n === 0), "1. enough relays: every leaf-class peer has ZERO children", `internal=${T.internal} kids=${leafKids}`);
}
// 2 · too few relays → still one connected tree; relays hold the top slots
{
  const members = [...mk(2, "relay", "r"), ...mk(8, "leaf", "l")]; // N=10, I=5 > relays=2
  const T = capacityTreeOf(members, K);
  const relaySlots = [T.bySlot.indexOf("r0"), T.bySlot.indexOf("r1")].sort((a, b) => a - b);
  ok(T.connected, "2. leaf-heavy swarm still forms ONE connected tree (honest degradation)");
  ok(relaySlots[0] === 0 && relaySlots[1] === 1, "2. the relays that exist take the TOPMOST internal slots", "slots=" + relaySlots);
}
// 3 · determinism under shuffle
{
  const members = [{ id: "gen", cap: "relay" }, ...mk(4, "relay", "r"), ...mk(6, "leaf", "l")];
  const shuffled = [...members].reverse().sort(() => 0.37);
  ok(JSON.stringify(capacityTreeOf(members, K).bySlot) === JSON.stringify(capacityTreeOf(shuffled, K).bySlot),
    "3. shuffled membership → the IDENTICAL tree on every peer");
}
// 4 · leaf churn leaves the relay layer untouched
{
  const members = [{ id: "gen", cap: "relay" }, ...mk(4, "relay", "r"), ...mk(6, "leaf", "l")];
  const before = capacityTreeOf(members, K);
  const after = capacityTreeOf(members.filter((m) => m.id !== "l3"), K);
  ok(JSON.stringify(before.bySlot.slice(0, before.internal)) === JSON.stringify(after.bySlot.slice(0, after.internal)),
    "4. a leaf leaving does not reshuffle the internal (relay) layer", JSON.stringify(after.bySlot.slice(0, after.internal)));
}

// 5 · the full channel over a capacity tree; leaves forward NOTHING
{
  const roomKey = await roomKeyFromSecret("cap-witness");
  const channel = await createChannel();
  const nodes = new Map();
  const connectPair = (a, b) => { const [la, lb] = memLinkPair(); nodes.get(a).fabric.addLink(la); nodes.get(b).fabric.addLink(lb); };
  const played = new Map();
  const gen = makeGenerator({ roomKey, channel, self: "gen", lagMs: 200 });
  nodes.set("gen", gen);
  const roster = [{ id: "gen", cap: "relay" }, ...mk(2, "relay", "rv"), ...mk(3, "leaf", "lv")];
  for (const m of roster) if (m.id !== "gen") {
    const v = makeViewer({ roomKey, alg: channel.alg, publicJwk: channel.publicJwk, self: m.id,
      onClip: ({ meta }) => (played.get(m.id) || played.set(m.id, []).get(m.id)).push(meta.seq) });
    nodes.set(m.id, v);
  }
  const T = capacityTreeOf(roster, K);
  for (const m of roster) { const p = T.parentOf(m.id); if (p) connectPair(m.id, p); }
  const clip = new Uint8Array(120_000).map((_, i) => i & 0xff);
  await gen.publishClip(clip, { title: "capacity", durMs: 1000 });
  await sleep(600);
  const everyone = roster.filter((m) => m.id !== "gen").every((m) => (played.get(m.id) || []).includes(0));
  ok(everyone, "5. every viewer (relay AND leaf) played the clip over the capacity tree",
    JSON.stringify([...played].map(([k, v]) => [k, v.length])));
  const leafFwd = roster.filter((m) => m.cap === "leaf").map((m) => nodes.get(m.id).stats().forwarded);
  ok(leafFwd.every((n) => n === 0), "5. leaf-class viewers FORWARDED ZERO objects (no uplink burden)", "forwarded=" + leafFwd);
  const relayFwd = roster.filter((m) => m.cap === "relay" && m.id !== "gen").map((m) => nodes.get(m.id).stats().forwarded);
  ok(relayFwd.some((n) => n > 0), "5. relay-class viewers carried the fan-out instead", "forwarded=" + relayFwd);
}

console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
