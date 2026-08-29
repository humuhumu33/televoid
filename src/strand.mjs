// strand.mjs — THE CHANNEL IS A SIGNED STRAND OF CLIP κs.
//
// A channel's identity is a signing keypair — not an account, not a server. Each
// manifest entry names one clip (its ordered segment κs, duration, start time),
// links to the previous entry by κ (hash-chain), and is signed by the channel
// key. A viewer holding only the channel's PUBLIC key verifies authorship and
// order; a forged or resigned entry is refused before anything is scheduled.
//
// Same shape as hologram-os holo-strand.mjs (append-only, content-linked, signed
// entries), reduced to the one kind a live channel needs. Isomorphic: WebCrypto
// only (browser + Node ≥ 20). Ed25519 preferred; ECDSA P-256 fallback where
// Ed25519 WebCrypto is absent (the entry records which — `alg`).

import { sha256hex } from "./wire.mjs";

const te = new TextEncoder();
const subtle = crypto.subtle;

const ALGS = {
  ed25519: { gen: { name: "Ed25519" }, sig: { name: "Ed25519" } },
  p256: { gen: { name: "ECDSA", namedCurve: "P-256" }, sig: { name: "ECDSA", hash: "SHA-256" } },
};

async function pickAlg() {
  try {
    await subtle.generateKey(ALGS.ed25519.gen, false, ["sign", "verify"]);
    return "ed25519";
  } catch {
    return "p256";
  }
}

const b64 = {
  enc: (u8) => btoa(String.fromCharCode(...u8)),
  dec: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};

// canonical bytes of an entry body: stable key order, no whitespace.
function canonical(body) {
  const ordered = {};
  for (const k of Object.keys(body).sort()) ordered[k] = body[k];
  return te.encode(JSON.stringify(ordered));
}

// ── channel identity ─────────────────────────────────────────────────────────
export async function createChannel() {
  const alg = await pickAlg();
  const kp = await subtle.generateKey(ALGS[alg].gen, true, ["sign", "verify"]);
  const publicJwk = await subtle.exportKey("jwk", kp.publicKey);
  return { alg, publicJwk, privateKey: kp.privateKey };
}

export async function importChannelPublic(alg, publicJwk) {
  return subtle.importKey("jwk", publicJwk, ALGS[alg].gen, true, ["verify"]);
}

// ── the strand writer (creator side) ─────────────────────────────────────────
// makeStrand({ channel }) → { append(bodyFields) → entry, head() }
export function makeStrand({ channel }) {
  let prev = null; // κ of the previous entry body
  let seq = 0;
  return {
    async append(fields) {
      const body = { ...fields, seq: seq++, prev, alg: channel.alg };
      const bytes = canonical(body);
      const kappa = await sha256hex(bytes);
      const sig = new Uint8Array(await subtle.sign(ALGS[channel.alg].sig, channel.privateKey, bytes));
      prev = kappa;
      return { body, kappa, sig: b64.enc(sig) };
    },
    head: () => prev,
  };
}

// ── stateless single entry check (history fetched from peers) ────────────────
// The live verifier below is CHAINED (anchors, then demands seq+1 links). A
// history entry served from a peer's store is checked alone: authorship by
// signature, identity by κ. Order comes from the signed seq field; without
// the channel key no false history can exist, so per entry signature + the
// manifest's own segment κs are sufficient for replay.
export async function verifyEntrySig({ alg, publicJwk }, entry) {
  if (!entry || !entry.body || !entry.sig || entry.body.alg !== alg) return { ok: false };
  const pub = await importChannelPublic(alg, publicJwk);
  const bytes = canonical(entry.body);
  let good = false;
  try { good = await subtle.verify(ALGS[alg].sig, pub, b64.dec(entry.sig), bytes); } catch {}
  if (!good) return { ok: false };
  return { ok: true, kappa: await sha256hex(bytes) };
}

// ── the strand verifier (viewer side) ────────────────────────────────────────
// makeVerifier({ alg, publicJwk }) → { verify(entry) → {ok, kappa, why?} }
// Chain rule: the first VALID entry seen anchors the chain (a live viewer joins
// mid-stream); after that, each entry must link prev → last accepted κ and
// carry seq = last.seq + 1. Signature is checked on every entry.
export function makeVerifier({ alg, publicJwk }) {
  let pub = null;
  let last = null; // { kappa, seq }
  return {
    async verify(entry) {
      if (!entry || !entry.body || !entry.sig) return { ok: false, why: "shape" };
      if (entry.body.alg !== alg) return { ok: false, why: "alg" };
      if (!pub) pub = await importChannelPublic(alg, publicJwk);
      const bytes = canonical(entry.body);
      let good = false;
      try {
        good = await subtle.verify(ALGS[alg].sig, pub, b64.dec(entry.sig), bytes);
      } catch {}
      if (!good) return { ok: false, why: "signature" };
      const kappa = await sha256hex(bytes);
      if (last) {
        if (entry.body.prev !== last.kappa || entry.body.seq !== last.seq + 1)
          return { ok: false, why: "chain" };
      }
      last = { kappa, seq: entry.body.seq };
      return { ok: true, kappa };
    },
    last: () => last,
  };
}
