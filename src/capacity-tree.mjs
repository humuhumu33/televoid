// capacity-tree.mjs — the ONE net-new mesh piece: the coordinator-free tree,
// made CAPACITY-AWARE. Same laws as vendor/holo-fabric-tree.mjs (a pure
// deterministic function of the shared membership — every peer computes the
// identical tree, no election, no repair path), plus one new input: each
// member's capacity class.
//
//   relay — can afford k downstream copies of the stream (desktop on wifi)
//   leaf  — cannot (phone on cellular, metered uplink): must sit where it has
//           no children, so it RECEIVES without ever being asked to forward
//
// The rule, deterministic on every peer: slots are filled in order; an
// INTERNAL slot (one that has children at this N) draws from the RELAYS by
// rendezvous score, and only falls back to leaf-class peers when relays run
// out (honest degradation — a leaf-heavy swarm still forms ONE connected
// tree, it just asks some leaves to help). Leaf slots draw from everyone
// remaining. Same FNV-1a rendezvous scoring as upstream, so churn still
// perturbs O(1) neighbours within each class.

function _fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0; } return h >>> 0; }
const _score = (id, slot, salt) => _fnv((salt || "") + id + "|" + slot);

// number of slots that have at least one child when N members sit in a k-ary
// heap layout: slot s has children iff k*s+1 <= N-1.
const internalSlots = (N, k) => (N <= 1 ? 0 : Math.ceil((N - 1) / k));

// members: [{ id, cap }] with cap "relay" | "leaf" | "reserve" | "pin"
// (unknown → relay). Internal slots degrade down the tiers in order:
// relay → leaf → reserve → pin. "reserve" is a set that CAN forward but is
// already carrying fanout elsewhere (the braid marks tree A's towers as
// reserve for tree B); "pin" is a HARD leaf (a set that must never be asked
// to forward), touched only when literally nothing else exists.
// `salt` perturbs the rendezvous scores — the braid uses it so a second tree
// over the same members lands differently. Default "" keeps every historical
// placement byte identical.
// → { slotOf: Map(id→slot), bySlot: [id] } — deterministic in (ids, caps, salt).
export function assignByCapacity(members, k, salt = "") {
  const N = members.length;
  const I = internalSlots(N, k);
  const TIER = { relay: 0, leaf: 1, reserve: 2, pin: 3 };
  const tiers = [new Set(), new Set(), new Set(), new Set()];
  for (const m of members) tiers[TIER[m.cap] ?? 0].add(m.id);
  const slotOf = new Map();
  const bySlot = new Array(N);
  for (let slot = 0; slot < N; slot++) {
    const pool = slot < I
      ? (tiers.find((t) => t.size) || tiers[0])
      : new Set(tiers.flatMap((t) => [...t]));
    let best = null, bestScore = -1;
    for (const id of pool) { const s = _score(id, slot, salt); if (s > bestScore) { bestScore = s; best = id; } }
    slotOf.set(best, slot); bySlot[slot] = best;
    for (const t of tiers) t.delete(best);
  }
  return { slotOf, bySlot };
}

// Same surface as vendor makeTree, but setMembers takes [{id, cap}].
export function makeCapacityTree({ k = 4, self, salt = "" } = {}) {
  if (!self) throw new Error("capacity-tree: `self` id required");
  if (k < 1) k = 1;
  let linked = new Set();
  let last = { parent: null, children: [], role: "root", depth: 0, size: 0 };
  const api = {
    onLink: () => {},
    setMembers(list) {
      const seen = new Map();
      for (const m of list) if (m && m.id) seen.set(m.id, ["leaf","pin","reserve"].includes(m.cap) ? m.cap : "relay");
      if (!seen.has(self)) seen.set(self, "relay");
      const members = [...seen].map(([id, cap]) => ({ id, cap }));
      if (!members.length) return last;
      const { slotOf, bySlot } = assignByCapacity(members, k, salt);
      const mySlot = slotOf.get(self);
      const parentSlot = mySlot === 0 ? -1 : Math.floor((mySlot - 1) / k);
      const parent = parentSlot < 0 ? null : bySlot[parentSlot];
      const children = [];
      for (let j = 1; j <= k; j++) { const cs = k * mySlot + j; if (cs < members.length) children.push(bySlot[cs]); }
      const role = mySlot === 0 ? "root" : (children.length ? "internal" : "leaf");
      let depth = 0; for (let s = mySlot; s > 0; s = Math.floor((s - 1) / k)) depth++;
      const want = new Set([parent, ...children].filter(Boolean));
      const add = [...want].filter((id) => !linked.has(id));
      const drop = [...linked].filter((id) => !want.has(id));
      linked = want;
      last = { parent, children, role, depth, size: members.length, slot: mySlot };
      if (add.length || drop.length) { try { api.onLink({ add, drop }); } catch {} }
      return last;
    },
    view: () => last,
    fanout: () => last.children.length,
  };
  return api;
}

// pure helper for witnesses / placement checks (mirror of upstream treeOf).
export function capacityTreeOf(members, k = 4, salt = "") {
  const ms = [];
  const seen = new Set();
  for (const m of members) if (m && m.id && !seen.has(m.id)) { seen.add(m.id); ms.push({ id: m.id, cap: ["leaf","pin","reserve"].includes(m.cap) ? m.cap : "relay" }); }
  const { slotOf, bySlot } = assignByCapacity(ms, k, salt);
  const slot = (id) => slotOf.get(id);
  const parentOf = (id) => { const s = slot(id); return s === 0 ? null : bySlot[Math.floor((s - 1) / k)]; };
  const childrenOf = (id) => { const s = slot(id); const c = []; for (let j = 1; j <= k; j++) { const cs = k * s + j; if (cs < ms.length) c.push(bySlot[cs]); } return c; };
  const seen2 = new Set(); const stack = ms.length ? [bySlot[0]] : [];
  while (stack.length) { const id = stack.pop(); if (seen2.has(id)) continue; seen2.add(id); for (const c of childrenOf(id)) stack.push(c); }
  return { bySlot, parentOf, childrenOf, connected: seen2.size === ms.length, size: ms.length, internal: internalSlots(ms.length, k) };
}
