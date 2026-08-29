// link.mjs — membership gossip + the deterministic tree + one RTCDataChannel per
// tree edge, feeding a fabric's addLink/removeLink. The exact idiom of
// hologram-apps holo-fabric-call.mjs (hello gossip, perfect negotiation,
// lower-id-initiates), reduced to the transport concern only.
//
//   const net = await joinTree({ base, room, self, k, fabric, ice });
//   net.linkCount() · net.peers() · net.view() · net.leave()

import { makeCapacityTree } from "../src/capacity-tree.mjs";

function openSignal(base, room, self, onMsg) {
  const es = new EventSource(`${base}/signal?room=${encodeURIComponent(room)}&peer=${encodeURIComponent(self)}`);
  es.onmessage = (e) => { try { onMsg(JSON.parse(e.data)); } catch {} };
  return {
    post: (msg) => fetch(`${base}/signal?room=${encodeURIComponent(room)}&peer=${encodeURIComponent(self)}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(msg) }).catch(() => {}),
    close: () => { try { es.close(); } catch {} },
  };
}

export async function joinTree({ base, room, self, k = 2, cap = "relay", fabric, ice = [], door = null } = {}) {
  const tree = makeCapacityTree({ k, self });
  const members = new Map([[self, cap]]);   // id → capacity class (gossiped in hello)
  const peers = new Map();          // peerId → { pc, dc, link, makingOffer }
  let left = false;

  const sig = door ? await door(room, self, onSignal) : openSignal(base, room, self, onSignal);
  let hn = 0;
  const hello = () => { if (left) return; sig.post({ kind: "hello", cap }); if (++hn < 6) setTimeout(hello, 800); };
  hello();

  tree.onLink = ({ add, drop }) => {
    for (const id of add) if (id !== self && !peers.has(id)) openLink(id);
    for (const id of drop) closeLink(id);
  };
  const recompute = () => tree.setMembers([...members].map(([id, c]) => ({ id, cap: c })));

  async function onSignal(m) {
    if (left || !m || m.from === self) return;
    if (m.kind === "hello") { if (!members.has(m.from)) { members.set(m.from, m.cap === "leaf" ? "leaf" : "relay"); sig.post({ kind: "hello", cap }); recompute(); } }
    else if (m.kind === "bye") { members.delete(m.from); recompute(); closeLink(m.from); }
    else if (m.kind === "sdp" && m.to === self) { if (!members.has(m.from)) members.set(m.from, "relay"); recompute(); await onSdp(m.from, m.data); }
    else if (m.kind === "ice" && m.to === self) { const p = peers.get(m.from); if (p) { try { await p.pc.addIceCandidate(m.data); } catch {} } }
  }

  function newPc(peerId) {
    const pc = new RTCPeerConnection({ iceServers: ice });
    const st = { pc, dc: null, link: null, makingOffer: false };
    pc.onicecandidate = ({ candidate }) => { if (candidate) sig.post({ to: peerId, kind: "ice", data: candidate }); };
    pc.onnegotiationneeded = async () => {
      try { st.makingOffer = true; await pc.setLocalDescription(); sig.post({ to: peerId, kind: "sdp", data: pc.localDescription }); }
      catch {} finally { st.makingOffer = false; }
    };
    peers.set(peerId, st);
    return st;
  }
  function wireDc(st, dc) {
    dc.binaryType = "arraybuffer";
    const link = { send: (buf) => { try { if (dc.readyState === "open") dc.send(buf); } catch {} }, onMessage: null, close: () => { try { st.pc.close(); } catch {} } };
    st.dc = dc; st.link = link;
    dc.onopen = () => fabric.addLink(link);
    dc.onmessage = (e) => { link.onMessage && link.onMessage(e.data); };
  }
  function openLink(peerId) {
    const st = newPc(peerId);
    if (self < peerId) wireDc(st, st.pc.createDataChannel("chan", { ordered: true }));
    else st.pc.ondatachannel = (e) => wireDc(st, e.channel);
  }
  async function onSdp(peerId, desc) {
    let st = peers.get(peerId);
    if (!st) { st = newPc(peerId); st.pc.ondatachannel = (e) => wireDc(st, e.channel); }
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

  return {
    self,
    linkCount: () => [...peers.values()].filter((p) => p.dc && p.dc.readyState === "open").length,
    peers: () => [...peers.keys()],
    members: () => [...members.keys()],
    view: () => tree.view(),
    leave() { left = true; sig.post({ kind: "bye" }); sig.close(); for (const id of [...peers.keys()]) closeLink(id); },
  };
}
