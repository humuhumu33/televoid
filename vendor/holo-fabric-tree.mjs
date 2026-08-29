// holo-fabric-tree.mjs — THE COORDINATOR-FREE DISTRIBUTION TREE (HOLO-COMMS-FABRIC F1-distributed brain).
//
// The elegant, serverless insight: a bounded-fanout distribution tree needs NO coordinator, NO election, NO
// central authority. The tree is a PURE DETERMINISTIC FUNCTION of the shared membership set. Every peer,
// holding the same set of member ids (gossiped over the sealed signal door), independently computes the
// IDENTICAL tree — so everyone agrees on who their parent and children are without anyone deciding. A join
// or leave just changes the set; each peer recomputes; the tree self-heals by construction (a departed peer's
// children re-attach to their newly-computed parent — no special repair path).
//
// It emits the DIFF (links to add / drop) so it drives holo-fabric.mjs's addLink/removeLink directly:
//     brain = makeTree({ k: 4, self: myId });
//     brain.onLink = ({ add, drop }) => { for (const id of add) fabric.addLink(linkTo(id)); for (const id of drop) fabric.removeLink(linkOf(id)); };
//     brain.setMembers(idsFromSignalDoor);   // call whenever the roster changes
//
// STABILITY: positions are assigned by RENDEZVOUS-HASHING each id against its slot (not raw sort order), so a
// leave perturbs only O(1) neighbours instead of reshuffling the whole tree — the standard consistent-hashing
// property, applied to tree slots. Deterministic (same members ⇒ same tree on every peer) and low-churn.

// FNV-1a 32-bit — tiny, stable, dependency-free. Rendezvous score = hash(id | slot); highest score wins the slot.
function _fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0; } return h >>> 0; }
function _score(id, slot) { return _fnv(id + "|" + slot); }

// Assign the N members to slots 0..N-1 by rendezvous hashing (each slot taken by its highest-scoring remaining
// member). Deterministic on every peer; a member's slot rarely changes when others come/go (consistent-hashing).
function _assign(members) {
  const remaining = new Set(members);
  const slotOf = new Map();          // id -> slot
  for (let slot = 0; slot < members.length; slot++) {
    let best = null, bestScore = -1;
    for (const id of remaining) { const s = _score(id, slot); if (s > bestScore) { bestScore = s; best = id; } }
    slotOf.set(best, slot); remaining.delete(best);
  }
  const bySlot = new Array(members.length);
  for (const [id, slot] of slotOf) bySlot[slot] = id;
  return { slotOf, bySlot };
}

export function makeTree({ k = 4, self } = {}) {
  if (!self) throw new Error("holo-fabric-tree: `self` id required");
  if (k < 1) k = 1;
  let linked = new Set();            // ids we currently hold a link to (parent + children)
  let last = { parent: null, children: [], role: "root", depth: 0, size: 0 };
  const api = {
    onLink: () => {},                // ({ add:[ids], drop:[ids] }) — the diff to apply to the fabric's links

    // recompute the whole tree from the shared membership; emit the link diff for THIS peer.
    setMembers(ids) {
      const members = [...new Set(ids)].filter(Boolean);
      if (!members.includes(self)) members.push(self);        // we are always in our own view
      if (members.length === 0) return last;
      const { slotOf, bySlot } = _assign(members);
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
    // uplink cost = number of children we forward to (BOUNDED by k, independent of N — the whole point)
    fanout: () => last.children.length,
  };
  return api;
}

// pure helper (used by the witness + any peer to reason about the global tree from a membership set):
// returns { bySlot, parentOf(id), childrenOf(id), depthOf(id), maxFanout, connected }.
export function treeOf(members, k = 4) {
  const ms = [...new Set(members)].filter(Boolean);
  const { slotOf, bySlot } = _assign(ms);
  const slot = (id) => slotOf.get(id);
  const parentOf = (id) => { const s = slot(id); return s === 0 ? null : bySlot[Math.floor((s - 1) / k)]; };
  const childrenOf = (id) => { const s = slot(id); const c = []; for (let j = 1; j <= k; j++) { const cs = k * s + j; if (cs < ms.length) c.push(bySlot[cs]); } return c; };
  const depthOf = (id) => { let d = 0; for (let s = slot(id); s > 0; s = Math.floor((s - 1) / k)) d++; return d; };
  let maxFanout = 0; for (const id of ms) maxFanout = Math.max(maxFanout, childrenOf(id).length);
  // connectivity: walk from root; every member reachable
  const seen = new Set(); const stack = ms.length ? [bySlot[0]] : [];
  while (stack.length) { const id = stack.pop(); if (seen.has(id)) continue; seen.add(id); for (const c of childrenOf(id)) stack.push(c); }
  return { bySlot, parentOf, childrenOf, depthOf, maxFanout, connected: seen.size === ms.length, size: ms.length };
}
