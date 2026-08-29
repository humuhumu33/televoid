// broker-door.mjs — the SERVERLESS signal door: membership + SDP gossip over a
// free public MQTT-over-WebSocket broker, content-blind.
//
// The production rendezvous pattern of Hologram Meet (hologram-apps
// apps/stream/holo-broker-sync.mjs — the MQTT 3.1.1 codec below derives from
// it, MIT): the broker routes opaque sealed frames on an UNGUESSABLE topic
// derived from the invite secret. It sees ciphertext on a random-looking topic
// — never a member id, an SDP, or the channel key. Any broker works; several
// can be raced; none is ours. (The tighter rung — sealed Nostr dead-drops at a
// κ-derived coordinate, hologram-os holo-rendezvous.mjs — swaps in behind the
// same {post, close} interface.)
//
//   const door = makeBrokerDoor({ secret });
//   const sig = await door(room, self, onMsg);   // sig.post({kind,...}) / sig.close()

const te = new TextEncoder();
const td = new TextDecoder();
const DEFAULT_BROKERS = ["wss://broker.emqx.io:8084/mqtt", "wss://broker.hivemq.com:8884/mqtt"];

// ── MQTT 3.1.1 binary codec (pure; derived from holo-broker-sync.mjs) ────────
function concatU8(arrs) { let n = 0; for (const a of arrs) n += a.length; const o = new Uint8Array(n); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; }
function remLen(n) { const out = []; do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 0x80; out.push(b); } while (n > 0); return new Uint8Array(out); }
function mqttStr(s) { const b = te.encode(s); return concatU8([new Uint8Array([(b.length >> 8) & 0xff, b.length & 0xff]), b]); }
function packet(type, flags, body) { return concatU8([new Uint8Array([(type << 4) | flags]), remLen(body.length), body]); }
const encodeConnect = (clientId) => packet(1, 0, concatU8([mqttStr("MQTT"), new Uint8Array([0x04, 0x02, 0x00, 0x3c]), mqttStr(clientId)]));
const encodeSubscribe = (pid, topic) => packet(8, 2, concatU8([new Uint8Array([(pid >> 8) & 0xff, pid & 0xff]), mqttStr(topic), new Uint8Array([0x00])]));
const encodePublish = (topic, payload) => packet(3, 0, concatU8([mqttStr(topic), payload]));
const encodePing = () => packet(12, 0, new Uint8Array(0));
function parsePackets(buf) {
  const packets = []; let off = 0;
  for (;;) {
    if (buf.length - off < 2) break;
    let mult = 1, val = 0, i = off + 1, b;
    do { if (i >= buf.length) return { packets, rest: buf.subarray(off) }; b = buf[i]; val += (b & 0x7f) * mult; mult *= 128; i++; } while (b & 0x80);
    const total = i + val; if (buf.length < total) break;
    packets.push({ type: buf[off] >> 4, body: buf.subarray(i, total) });
    off = total;
  }
  return { packets, rest: buf.subarray(off) };
}
function parsePublish(body) {
  const tl = (body[0] << 8) | body[1];
  return { topic: td.decode(body.subarray(2, 2 + tl)), payload: body.subarray(2 + tl) };
}

// ── seal — AES-GCM under HKDF(secret, "door"); topic — derived, unguessable ──
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
async function doorKey(secret) {
  const ikm = await crypto.subtle.importKey("raw", te.encode(String(secret)), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: te.encode("infinite-channel/v1"), info: te.encode("door") },
    ikm, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function doorTopic(secret, room) {
  const d = await crypto.subtle.digest("SHA-256", te.encode(secret + "|" + room + "|topic"));
  return "ic/" + hex(new Uint8Array(d)).slice(0, 32);
}

export function makeBrokerDoor({ secret, brokers = DEFAULT_BROKERS } = {}) {
  return async function open(room, self, onMsg) {
    const key = await doorKey(secret);
    const topic = await doorTopic(secret, room);
    const seen = new Set();          // nonce dedup across raced brokers
    const socks = [];
    let closed = false;

    async function deliver(payload) {
      let msg;
      try {
        const iv = payload.subarray(0, 12);
        const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, payload.subarray(12));
        msg = JSON.parse(td.decode(new Uint8Array(pt)));
      } catch { return; }             // not sealed by an invite holder → ignore
      if (!msg || msg.from === self || seen.has(msg.n)) return;
      seen.add(msg.n); if (seen.size > 2048) seen.delete(seen.values().next().value);
      try { onMsg(msg); } catch {}
    }

    function dial(url) {
      let ws;
      try { ws = new WebSocket(url, "mqtt"); } catch { return; }
      ws.binaryType = "arraybuffer";
      let buf = new Uint8Array(0);
      const st = { ws, ready: false, ping: null };
      ws.onopen = () => ws.send(encodeConnect(self + "-" + Math.random().toString(36).slice(2, 8)));
      ws.onmessage = (e) => {
        buf = concatU8([buf, new Uint8Array(e.data)]);
        const { packets, rest } = parsePackets(buf); buf = rest;
        for (const p of packets) {
          if (p.type === 2) { ws.send(encodeSubscribe(1, topic)); st.ready = true; st.ping = setInterval(() => { try { ws.send(encodePing()); } catch {} }, 25_000); }
          else if (p.type === 3) deliver(parsePublish(p.body).payload);
        }
      };
      ws.onclose = ws.onerror = () => { if (st.ping) clearInterval(st.ping); if (!closed) setTimeout(() => !closed && dial(url), 3000); };
      socks.push(st);
    }
    for (const url of brokers) dial(url);

    return {
      post: async (m) => {
        const body = te.encode(JSON.stringify({ ...m, from: self, n: Math.random().toString(36).slice(2, 12) }));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, body));
        const frame = encodePublish(topic, concatU8([iv, ct]));
        for (const s of socks) if (s.ready && s.ws.readyState === 1) { try { s.ws.send(frame); } catch {} }
      },
      close: () => { closed = true; for (const s of socks) { if (s.ping) clearInterval(s.ping); try { s.ws.close(); } catch {} } },
    };
  };
}
