// link.mjs — membership, the BRAID, and the two wires per neighbor.
//
// Each peer edge is one RTCPeerConnection carrying TWO labeled channels:
//   "chan" — the fabric wire (live objects, flood + κ dedup, blind relays)
//   "hist" — the direct want/serve wire (a peer's κ store answers by hash;
//            the holo-mesh-blocks shape: want → block|dont, every block
//            rederived by the asker before it counts)
//
// Membership is a HEARTBEAT, not a one shot hello: every beat carries the
// set's CURRENT capacity (measured by src/measure.mjs, or pinned), and a
// member silent for 2.5 beats is evicted everywhere — a crashed tab stops
// being load bearing within two beats, no bye required. Topology is the
// braid (src/braid.mjs): links = union of two capacity trees, so one death
// never stalls the stream. All of it stays a pure deterministic function of
// the gossiped (id, cap) set — no coordinator anywhere.

import { makeBraid } from "../src/braid.mjs";
import { pack, unpack, sha256hex } from "../src/wire.mjs";

async function openSignal(base, room, self, onMsg) {
  const es = new EventSource(`${base}/signal?room=${encodeURIComponent(room)}&peer=${encodeURIComponent(self)}`);
  es.onmessage = (e) => { try { onMsg(JSON.parse(e.data)); } catch {} };
  // SUBSCRIBE BEFORE SPEAKING: a peer that says hello before its own stream is
  // registered can miss the instant SDP reply (a real, once observed race).
  await new Promise((res) => { es.onopen = res; setTimeout(res, 2000); });
  return {
    post: (msg) => fetch(`${base}/signal?room=${encodeURIComponent(room)}&peer=${encodeURIComponent(self)}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(msg) }).catch(() => {}),
    close: () => { try { es.close(); } catch {} },
  };
}

const td = new TextDecoder();
const te = new TextEncoder();

export async function joinTree({ base, room, self, k = 2, cap = null, meter = null, fabric, ice = [], door = null,
                                 history = null, beatMs = 1200, onTx = () => {} } = {}) {
  const tree = makeBraid({ k, self });
  // cap: "leaf" → pinned pin (never forwards) · "relay" → pinned relay ·
  // "reserve" → carries only as a last resort (the DESK pins this: a source
  // that sits as a leaf in BOTH trees, so the audience carries all fanout) ·
  // null → AUTOMATIC (the meter speaks; every set starts a leaf and earns it)
  const myCap = () => (cap === "leaf" ? "pin" : cap === "relay" || cap === "reserve" ? cap : meter ? meter.cap() : "leaf");
  const members = new Map([[self, { cap: myCap(), seen: Infinity }]]);
  const peers = new Map();          // peerId → { pc, dc, hist, link, makingOffer }
  let left = false, tx = 0;

  const sig = door ? await door(room, self, onSignal) : await openSignal(base, room, self, onSignal);
  const recompute = () => tree.setMembers([...members].map(([id, m]) => ({ id, cap: m.cap })));

  // ── the heartbeat: capacity gossip + ghost eviction ─────────────────────────
  const beat = () => {
    if (left) return;
    sig.post({ kind: "hello", cap: myCap() });
    const cut = Date.now() - beatMs * 2.5;
    let changed = false;
    for (const [id, m] of members) if (id !== self && m.seen < cut) { members.delete(id); closeLink(id); changed = true; }
    const mine = members.get(self);
    if (mine.cap !== myCap()) { mine.cap = myCap(); changed = true; }
    if (changed) recompute();
    // sweep answered links the braid does not want: a peer that dialed us under
    // a transient membership view leaves a pc behind; views converge within a
    // beat, so anything still unwanted here is closed.
    const want = tree.wanted();
    for (const id of [...peers.keys()]) if (!want.has(id)) closeLink(id);
  };
  const beatIv = setInterval(beat, beatMs);
  beat();

  tree.onLink = ({ add, drop }) => {
    for (const id of add) if (id !== self && !peers.has(id)) openLink(id);
    for (const id of drop) closeLink(id);
  };

  async function onSignal(m) {
    if (left || !m || m.from === self) return;
    if (m.kind === "hello") {
      const known = members.get(m.from);
      const capIn = ["leaf", "pin", "reserve"].includes(m.cap) ? m.cap : "relay";
      if (!known) { members.set(m.from, { cap: capIn, seen: Date.now() }); sig.post({ kind: "hello", cap: myCap() }); recompute(); }
      else { known.seen = Date.now(); if (known.cap !== capIn) { known.cap = capIn; recompute(); } }
    }
    else if (m.kind === "bye") { members.delete(m.from); recompute(); closeLink(m.from); }
    else if (m.kind === "sdp" && m.to === self) {
      if (!members.has(m.from)) { members.set(m.from, { cap: "relay", seen: Date.now() }); recompute(); }
      await onSdp(m.from, m.data);
    }
    else if (m.kind === "ice" && m.to === self) { const p = peers.get(m.from); if (p) { try { await p.pc.addIceCandidate(m.data); } catch {} } }
  }

  // ── one pc per neighbor, two channels per pc ────────────────────────────────
  function newPc(peerId) {
    const pc = new RTCPeerConnection({ iceServers: ice });
    const st = { pc, dc: null, hist: null, link: null, makingOffer: false };
    pc.onicecandidate = ({ candidate }) => { if (candidate) sig.post({ to: peerId, kind: "ice", data: candidate }); };
    pc.onnegotiationneeded = async () => {
      try { st.makingOffer = true; await pc.setLocalDescription(); sig.post({ to: peerId, kind: "sdp", data: pc.localDescription }); }
      catch {} finally { st.makingOffer = false; }
    };
    peers.set(peerId, st);
    return st;
  }
  function wireChan(st, dc) {
    dc.binaryType = "arraybuffer";
    const link = { send: (buf) => { try { if (dc.readyState === "open") { dc.send(buf); tx += buf.byteLength || 0; onTx(buf.byteLength || 0); } } catch {} },
                   onMessage: null, close: () => { try { st.pc.close(); } catch {} } };
    st.dc = dc; st.link = link;
    dc.onopen = () => fabric.addLink(link);
    dc.onmessage = (e) => { if (meter) meter.onBytes(e.data.byteLength || 0); link.onMessage && link.onMessage(e.data); };
  }
  function wireHist(st, peerId, dc) {
    dc.binaryType = "arraybuffer";
    st.hist = { dc, peerId, pending: new Map() };   // reqId → resolve
    dc.onmessage = (e) => onHist(st.hist, new Uint8Array(e.data));
  }
  const histSend = (h, hdr, body) => { try { if (h.dc.readyState === "open") { const f = pack(hdr, body); h.dc.send(f); tx += f.byteLength; onTx(f.byteLength); } } catch {} };

  async function onHist(h, bytes) {
    const m = unpack(bytes); if (!m) return;
    if (m.hdr.t === "want") {                        // a peer wants a block we may hold → serve or decline
      const b = history && history.serveBlock ? await history.serveBlock(m.hdr.k) : null;
      histSend(h, b ? { t: "block", k: m.hdr.k, r: m.hdr.r } : { t: "dont", k: m.hdr.k, r: m.hdr.r }, b || undefined);
    } else if (m.hdr.t === "tail") {                 // a joining peer wants our newest manifests
      const entries = history && history.tailEntries ? await history.tailEntries(m.hdr.n) : [];
      histSend(h, { t: "tailv", r: m.hdr.r }, te.encode(JSON.stringify(entries)));
    } else if (m.hdr.t === "block" || m.hdr.t === "dont" || m.hdr.t === "tailv") {
      const res = h.pending.get(m.hdr.r);
      if (res) { h.pending.delete(m.hdr.r); res(m); }
    }
  }
  function openLink(peerId) {
    const st = newPc(peerId);
    if (self < peerId) {
      wireChan(st, st.pc.createDataChannel("chan", { ordered: true }));
      wireHist(st, peerId, st.pc.createDataChannel("hist", { ordered: true }));
      let tries = 0;
      const iv = setInterval(() => {
        if (left || !peers.has(peerId) || (st.dc && st.dc.readyState === "open") || ++tries > 5) return clearInterval(iv);
        try { st.pc.restartIce(); } catch {}
      }, 3000);
    } else st.pc.ondatachannel = (e) => (e.channel.label === "hist" ? wireHist(st, peerId, e.channel) : wireChan(st, e.channel));
  }
  async function onSdp(peerId, desc) {
    let st = peers.get(peerId);
    if (!st) { st = newPc(peerId); st.pc.ondatachannel = (e) => (e.channel.label === "hist" ? wireHist(st, peerId, e.channel) : wireChan(st, e.channel)); }
    const polite = self < peerId;
    const collision = desc.type === "offer" && (st.makingOffer || st.pc.signalingState !== "stable");
    if (!polite && collision) return;
    try {
      await st.pc.setRemoteDescription(desc);
      if (desc.type === "offer") { await st.pc.setLocalDescription(); sig.post({ to: peerId, kind: "sdp", data: st.pc.localDescription }); }
    } catch {}
  }
  function closeLink(peerId) {
    const st = peers.get(peerId); if (!st) return;
    try { st.link && fabric.removeLink(st.link); } catch {}
    try { st.pc.close(); } catch {}
    peers.delete(peerId);
  }

  // ── the asker's side: fetch by κ from ANY neighbor, believe only rederivation ─
  let reqSeq = 0;
  const openHists = () => [...peers.values()].filter((p) => p.hist && p.hist.dc.readyState === "open").map((p) => p.hist);
  async function wantBlock(kappa, { timeoutMs = 4000, onSource = null, onReject = null } = {}) {
    for (const h of openHists()) {
      const r = "r" + reqSeq++;
      const reply = await new Promise((res) => {
        h.pending.set(r, res);
        histSend(h, { t: "want", k: kappa, r });
        setTimeout(() => { h.pending.delete(r); res(null); }, timeoutMs);
      });
      if (reply && reply.hdr.t === "block") {
        const bytes = new Uint8Array(reply.body);
        if ((await sha256hex(bytes)) === kappa) { onSource && onSource(h.peerId, bytes.length); return bytes; }
        onReject && onReject(h.peerId);           // a lying store is skipped, never trusted
      }
    }
    return null;
  }
  async function wantTail(n = 8, { timeoutMs = 4000 } = {}) {
    for (const h of openHists()) {
      const r = "r" + reqSeq++;
      const reply = await new Promise((res) => {
        h.pending.set(r, res);
        histSend(h, { t: "tail", n, r });
        setTimeout(() => { h.pending.delete(r); res(null); }, timeoutMs);
      });
      if (reply && reply.hdr.t === "tailv") {
        try { const entries = JSON.parse(td.decode(reply.body)); if (Array.isArray(entries) && entries.length) return entries; } catch {}
      }
    }
    return [];
  }

  return {
    self,
    linkCount: () => [...peers.values()].filter((p) => p.dc && p.dc.readyState === "open").length,
    peers: () => [...peers.keys()],
    members: () => [...members.keys()],
    view: () => tree.view(),
    capNow: () => myCap(),
    txBytes: () => tx,
    wantBlock, wantTail,
    leave() { left = true; clearInterval(beatIv); sig.post({ kind: "bye" }); sig.close(); for (const id of [...peers.keys()]) closeLink(id); },
  };
}
