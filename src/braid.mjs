// braid.mjs — TWO trees, ONE stream, NO single point of stall.
//
// Tree A is the capacity tree as it stands. Tree B is the same deterministic
// function over the same members with (1) a rotated rendezvous salt and (2)
// the classes SWAPPED for placement: a set internal in A is treated as a leaf
// class in B, and A's leaves compete for B's internal slots — so the interior
// of B is drawn from the exterior of A wherever the audience allows it, and
// no honest set carries fanout in both trees. Pinned sets (measured weak /
// witness pinned) stay "pin" in BOTH — never asked to forward anywhere.
//
// A peer's LINKS are the union of its A edges and B edges. The fabric floods
// over that union with per κ dedup, so every object crosses each edge at most
// once and a dead tower in one tree costs nobody the stream — the other
// tree's edges still connect the survivors. The price is bounded duplicate
// traffic (each object crosses ≈ 2(N−1) edges instead of N−1); the striping
// alternative (segment parity per tree) was DELETED from this design: it
// halves steady state traffic but needs two fabrics, engine surgery, and a
// repair protocol for the missing half on every death — flood over the braid
// union buys the same resilience with zero new failure modes.
//
// Deterministic in (ids, caps): every peer computes the identical braid.

import { capacityTreeOf, makeCapacityTree } from "./capacity-tree.mjs";

const SALT_B = "braid/B/";

function swapClasses(members, A) {
  return members.map((m) => {
    if (m.cap === "pin" || m.cap === "leaf" || m.cap === "reserve") return { id: m.id, cap: m.cap };
    return { id: m.id, cap: A.childrenOf(m.id).length ? "reserve" : "relay" };  // A towers REST in B
  });
}

// pure view for witnesses + placement checks. Tree B is WIDER than tree A
// (kB ≥ 4): its interior is small enough to draw entirely from A's exterior,
// and the backup path is SHALLOWER — the braid's second wind arrives faster.
export function braidOf(members, k = 2, { kB = Math.max(4, k * 2) } = {}) {
  const A = capacityTreeOf(members, k);
  const B = capacityTreeOf(swapClasses(members, A), kB, SALT_B);
  const interior = (T) => new Set([...T.bySlot].filter((id) => T.childrenOf(id).length));
  return { A, B, interiorA: interior(A), interiorB: interior(B) };
}

// the live brain: same surface as makeCapacityTree, but the link diff spans
// BOTH trees. view() reports the union role.
export function makeBraid({ k = 2, self } = {}) {
  if (!self) throw new Error("braid: `self` id required");
  let linked = new Set();
  let last = { parentA: null, parentB: null, children: [], tower: false, size: 0 };
  const api = {
    onLink: () => {},
    setMembers(list) {
      const seen = new Map();
      for (const m of list) if (m && m.id) seen.set(m.id, ["leaf", "pin", "reserve"].includes(m.cap) ? m.cap : "relay");
      if (!seen.has(self)) seen.set(self, "relay");
      const members = [...seen].map(([id, cap]) => ({ id, cap }));
      const { A, B } = braidOf(members, k);
      const pA = A.parentOf(self), pB = B.parentOf(self);
      const kids = [...new Set([...A.childrenOf(self), ...B.childrenOf(self)])];
      const want = new Set([pA, pB, ...kids].filter((id) => id && id !== self));
      const add = [...want].filter((id) => !linked.has(id));
      const drop = [...linked].filter((id) => !want.has(id));
      linked = want;
      last = { parentA: pA, parentB: pB, children: kids, tower: kids.length > 0, size: members.length };
      if (add.length || drop.length) { try { api.onLink({ add, drop }); } catch {} }
      return last;
    },
    view: () => last,
    wanted: () => new Set(linked),
  };
  return api;
}
