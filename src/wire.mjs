// wire.mjs — the one payload framing for every object on the channel fabric.
//
// A fabric object is opaque encrypted bytes; INSIDE it, every unit of the channel
// (a manifest entry, a clip segment, a chat word) is the same shape:
//   [ hdrLen:u16 | hdr JSON (utf-8) | body bytes ]
// The header travels encrypted with the rest — blind relays route only by κ.
// Same idiom as hologram-apps' holo-fabric-call.mjs pack/unpack.

const te = new TextEncoder();
const td = new TextDecoder();

export function pack(hdr, body = new Uint8Array(0)) {
  const h = te.encode(JSON.stringify(hdr));
  if (h.length > 0xffff) throw new Error("wire: header too large");
  const out = new Uint8Array(2 + h.length + body.length);
  new DataView(out.buffer).setUint16(0, h.length);
  out.set(h, 2);
  out.set(body, 2 + h.length);
  return out;
}

export function unpack(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length < 2) return null;
  const n = new DataView(u8.buffer, u8.byteOffset, 2).getUint16(0);
  if (2 + n > u8.length) return null;
  try {
    return { hdr: JSON.parse(td.decode(u8.subarray(2, 2 + n))), body: u8.subarray(2 + n) };
  } catch {
    return null;
  }
}

// sha256 hex — the plaintext-level κ used to bind segments to a SIGNED manifest.
// (The fabric already κ-verifies ciphertext per object; this closes the stronger
// hole: a peer WITH the room key forging content — only manifest-listed κs play.)
export async function sha256hex(u8) {
  const d = await crypto.subtle.digest("SHA-256", u8 instanceof Uint8Array ? u8 : new Uint8Array(u8));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
