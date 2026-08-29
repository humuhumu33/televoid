// channel.mjs — the Infinite Channel engines: GENERATOR and VIEWER over the κ-fabric.
//
// One waist, three object kinds, all the same sealed κ-object on the fabric:
//   man  — a SIGNED strand entry naming one clip: ordered segment κs + startAt (the shared clock)
//   seg  — one clip segment (≤ segSize bytes, so it fits a data-channel message)
//   chat — a viewer's prompt/word (the input rail of the product)
//
// The generator's uplink is O(k) — it hands each object to its tree links once;
// blind relays fan it out. A viewer plays a clip only when (a) its manifest
// entry verified against the CHANNEL's public key, (b) every segment re-derived
// to the κ the signed manifest lists, and (c) the shared clock says now.

import { makeFabric } from "../vendor/holo-fabric.mjs";
import { pack, unpack, sha256hex } from "./wire.mjs";
import { makeStrand, makeVerifier } from "./strand.mjs";

const te = new TextEncoder();
const td = new TextDecoder();

// AES-GCM room key from the channel invite secret (#k=… in the link) — the same
// HKDF pattern as hologram-os holo-rtc.js deriveRoom.
export async function roomKeyFromSecret(secret) {
  const ikm = await crypto.subtle.importKey("raw", te.encode(String(secret)), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: te.encode("infinite-channel/v1"), info: te.encode("room-key") },
    ikm, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

function segment(bytes, segSize) {
  const out = [];
  for (let o = 0; o < bytes.length; o += segSize) out.push(bytes.subarray(o, Math.min(o + segSize, bytes.length)));
  return out.length ? out : [new Uint8Array(0)];
}

// ── GENERATOR (the creator device) ───────────────────────────────────────────
export function makeGenerator({ roomKey, channel, self = "gen", segSize = 60_000, lagMs = 3000, now = Date.now, onChat = () => {} } = {}) {
  const strand = makeStrand({ channel });
  const fabric = makeFabric({ key: roomKey, onObject: (pt) => handle(pt) });
  function handle(pt) {
    const m = unpack(pt);
    if (m && m.hdr.t === "chat") { try { onChat({ from: m.hdr.from, text: td.decode(m.body) }); } catch {} }
  }
  return {
    self, fabric,
    // clipBytes → segments → signed manifest → everything onto the fabric once.
    async publishClip(clipBytes, { title = "", durMs = 0, startAt = null } = {}) {
      const segs = segment(clipBytes, segSize);
      const segKappas = [];
      for (const s of segs) segKappas.push(await sha256hex(s));
      const entry = await strand.append({ t: "clip", title, durMs, bytes: clipBytes.length, startAt: startAt ?? now() + lagMs, segs: segKappas });
      await fabric.publish(pack({ t: "man" }, te.encode(JSON.stringify(entry))));
      for (let i = 0; i < segs.length; i++) await fabric.publish(pack({ t: "seg", seq: entry.body.seq, i }, segs[i]));
      return entry;
    },
    stats: () => fabric.stats(),
  };
}

// ── VIEWER (every watcher — and, automatically, a relay for its tree children) ─
export function makeViewer({ roomKey, alg, publicJwk, self = "viewer", onClip = () => {}, onChat = () => {}, now = Date.now } = {}) {
  const verifier = makeVerifier({ alg, publicJwk });
  const pending = new Map();   // seq → { entry, segs: Map(i → {bytes, h}), played }
  const timers = new Set();
  let closed = false;

  const slot = (seq) => { let s = pending.get(seq); if (!s) { s = { entry: null, segs: new Map(), played: false }; pending.set(seq, s); } return s; };

  async function maybePlay(seq) {
    const s = pending.get(seq);
    if (!s || !s.entry || s.played) return;
    const want = s.entry.body.segs;
    for (let i = 0; i < want.length; i++) { const g = s.segs.get(i); if (!g || g.h !== want[i]) return; }
    s.played = true;
    const total = want.reduce((n, _, i) => n + s.segs.get(i).bytes.length, 0);
    const bytes = new Uint8Array(total);
    let o = 0;
    for (let i = 0; i < want.length; i++) { bytes.set(s.segs.get(i).bytes, o); o += s.segs.get(i).bytes.length; }
    const fire = () => { if (!closed) onClip({ bytes, meta: s.entry.body, kappa: s.entry.kappa }); pending.delete(seq); };
    const delay = Math.max(0, s.entry.body.startAt - now());   // the shared clock
    const t = setTimeout(() => { timers.delete(t); fire(); }, delay);
    timers.add(t);
  }

  async function handle(pt) {
    const m = unpack(pt);
    if (!m) return;
    if (m.hdr.t === "man") {
      let entry; try { entry = JSON.parse(td.decode(m.body)); } catch { return; }
      const v = await verifier.verify(entry);
      if (!v.ok) return;                                     // forged / re-signed / out-of-chain → refused
      entry.kappa = v.kappa;
      const s = slot(entry.body.seq);
      s.entry = entry;
      await maybePlay(entry.body.seq);
    } else if (m.hdr.t === "seg") {
      const s = slot(m.hdr.seq);
      const bytes = new Uint8Array(m.body);                  // copy out of the frame view
      s.segs.set(m.hdr.i, { bytes, h: await sha256hex(bytes) });
      await maybePlay(m.hdr.seq);
    } else if (m.hdr.t === "chat") {
      try { onChat({ from: m.hdr.from, text: td.decode(m.body) }); } catch {}
    }
  }

  const fabric = makeFabric({ key: roomKey, onObject: (pt) => handle(pt) });
  return {
    self, fabric,
    async sendChat(text) { await fabric.publish(pack({ t: "chat", from: self }, te.encode(String(text)))); },
    stats: () => fabric.stats(),
    close() { closed = true; for (const t of timers) clearTimeout(t); timers.clear(); },
  };
}
