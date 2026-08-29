// holo-fabric.mjs — THE SERVERLESS COMMUNICATION FABRIC (HOLO-COMMS-FABRIC F0: the transport waist).
//
// One lean waist that moves EVERY unit of communication — a chat message, a voice frame, a video SVC-layer,
// a file chunk, a presence beacon — as the SAME thing: an END-TO-END-ENCRYPTED, κ-ADDRESSED OBJECT flowing
// through a mesh of BLIND, VERIFIED peer-relays. No server sees, stores, meters, or can tamper with a byte.
// Proven primitives it packages: K0 (a peer forwards ciphertext by κ WITHOUT the key) + F1 (a fanout-bounded
// tree of such relays reaches everyone at O(k) uplink, not O(n)). This module is what makes those real code.
//
// DESIGN (why it's elegant):
//   · TRANSPORT-AGNOSTIC — a "link" is just { send(ArrayBuffer), onMessage, close }. WebRTC data channel today
//     (proven), WebTransport/QUIC (MoQ-class) tomorrow — the fabric doesn't care.
//   · κ-AGNOSTIC — inject the substrate's BLAKE3 `kappa` in production; a SHA-256 fallback keeps it dependency-
//     free for tests. The blind-relay/dedup/verify logic is hash-agnostic.
//   · TOPOLOGY-EXTERNAL — the fabric only forwards+dedups+verifies+decrypts; WHICH links a peer holds decides
//     the shape (a tree from F1, a swarm for broadcast, a small mesh for a group). Formation lives above.
//   · SECURITY BY CONSTRUCTION — a relay with no key can forward but never read (E2E through relays); a flipped
//     byte fails κ re-derivation and is dropped (verify-on-receipt); a κ is forwarded once (dedup breaks loops).
//
// Wire format per object:  [ ctLen:u32 | κ:32 | iv:12 | ciphertext ]   (κ is over the CIPHERTEXT, so a relay
// verifies integrity WITHOUT the key — the property that lets it stay blind).

const _subtle = (typeof crypto !== "undefined" && crypto.subtle) ? crypto.subtle : null;
const _hex = (u8) => { let s = ""; for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, "0"); return s; };
// default κ = SHA-256 (stand-in). PRODUCTION injects the spine's BLAKE3: makeFabric({ kappa: spine.kappaBytes }).
const _defaultKappa = async (bytes) => new Uint8Array(await _subtle.digest("SHA-256", bytes));

function _frame(k, iv, ct) {
  const out = new Uint8Array(4 + 32 + 12 + ct.length);
  new DataView(out.buffer).setUint32(0, ct.length);
  out.set(k, 4); out.set(iv, 36); out.set(ct, 48);
  return out.buffer;
}
function _unframe(buf) {
  // accept an ArrayBuffer (the wire default) OR a TypedArray (defensive — callers vary)
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8.length < 48) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = dv.getUint32(0); if (48 + n > u8.length) return null;
  return { k: u8.subarray(4, 36), iv: u8.subarray(36, 48), ct: u8.subarray(48, 48 + n) };
}

// key: an AES-GCM CryptoKey if this peer is a PARTICIPANT (may decrypt + originate); null = a BLIND RELAY
// (forwards ciphertext, never reads). onObject(plaintextBytes, { kappa }) fires for a participant on each new object.
export function makeFabric({ key = null, kappa = null, onObject = () => {}, dedupSize = 4096 } = {}) {
  const K = kappa || _defaultKappa;
  const links = new Set();          // { send, onMessage, close }
  const seen = new Map();           // κhex -> ts (dedup LRU — forward each object exactly once, breaks mesh loops)
  let cryptoKey = key, forwarded = 0, decrypted = 0, dropped = 0;

  function mark(kh) {
    if (seen.has(kh)) return false;
    seen.set(kh, 1);
    if (seen.size > dedupSize) { const oldest = seen.keys().next().value; seen.delete(oldest); }
    return true;
  }

  async function ingest(buf, from) {
    const m = _unframe(buf); if (!m) { dropped++; return; }
    const re = await K(m.ct);
    if (_hex(re) !== _hex(m.k)) { dropped++; return; }          // VERIFY-ON-RECEIPT: tampered/forged → drop
    const kh = _hex(m.k);
    if (!mark(kh)) return;                                       // DEDUP: already relayed this object
    for (const L of links) if (L !== from) { try { L.send(buf); forwarded++; } catch {} }   // BLIND forward (no key)
    if (cryptoKey) {                                            // PARTICIPANT: decrypt + surface to the app
      try { const pt = new Uint8Array(await _subtle.decrypt({ name: "AES-GCM", iv: m.iv }, cryptoKey, m.ct)); decrypted++; onObject(pt, { kappa: kh }); } catch { dropped++; }
    }
  }

  return {
    // a link is any duplex byte pipe; the fabric drives onMessage
    addLink(link) { link.onMessage = (buf) => ingest(buf, link); links.add(link); return link; },
    removeLink(link) { links.delete(link); try { link.close && link.close(); } catch {} },
    // originate an object (participant only): E2E-encrypt → κ → push to every neighbor
    async publish(bytes) {
      if (!cryptoKey) throw new Error("holo-fabric: no key — a blind relay cannot publish");
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await _subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, bytes));
      const k = await K(ct); const buf = _frame(k, iv, ct); mark(_hex(k));
      for (const L of links) { try { L.send(buf); forwarded++; } catch {} }
      return _hex(k);
    },
    setKey(k) { cryptoKey = k; },              // join/leave: a peer becomes a participant or a blind relay
    isBlind: () => !cryptoKey,
    linkCount: () => links.size,
    stats: () => ({ links: links.size, seen: seen.size, forwarded, decrypted, dropped, blind: !cryptoKey }),
  };
}

// helper: derive an AES-GCM room key from raw 32 bytes (in prod this is the Megolm session key).
export async function roomKeyFromRaw(raw32) {
  return _subtle.importKey("raw", raw32, "AES-GCM", false, ["encrypt", "decrypt"]);
}

// helper: an in-process link pair (for tests, local loopback, or same-tab fan-out). Returns [a, b] joined pipes.
export function memLinkPair() {
  const a = { send: (buf) => { try { b.onMessage && b.onMessage(buf); } catch {} }, onMessage: null, close() {} };
  const b = { send: (buf) => { try { a.onMessage && a.onMessage(buf); } catch {} }, onMessage: null, close() {} };
  return [a, b];
}
