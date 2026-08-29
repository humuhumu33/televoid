// store.mjs — WATCHING IS SEEDING: the set's κ store.
//
// Every clip a set plays is already verified against its signed manifest;
// this module makes that verification DURABLE and SERVABLE. Discipline
// mirrored from the hologram substrate's hologram-store (the browser OPFS
// backend behind a wasm js api): κ addressed, VERIFY ON WRITE and REVERIFY
// ON READ — a store never launders a byte it cannot rederive. The wasm
// itself was evaluated and declined for now: the substrate's browser peer
// weighs megabytes (holowhat's holospaces_web_bg.wasm is 2.9 MB) against
// this page's no build, small shell budget; the DISCIPLINE is the lift.
//
// Two backends behind one κ interface:
//   opfsBackend() — the real thing (browser Origin Private File System;
//                   quota needs no permission prompt, files named by κ).
//   memBackend()  — the pure twin for Node witnesses and as the silent
//                   fallback where OPFS is unavailable (private windows).
//
// Budget: LRU by AIR TIME, default 200 MB, evicts oldest broadcasts first.
// Nothing here ever prompts, blocks the clock, or grows without bound.

import { sha256hex } from "./wire.mjs";

export function memBackend() {
  const files = new Map();   // name → Uint8Array
  return {
    async write(name, bytes) { files.set(name, bytes); },
    async read(name) { return files.get(name) || null; },
    async remove(name) { files.delete(name); },
    async list() { return [...files.entries()].map(([name, b]) => ({ name, size: b.length })); },
  };
}

export function opfsBackend(dirName = "televoid") {
  let dirP = null;
  const dir = () => (dirP ||= navigator.storage.getDirectory().then((r) => r.getDirectoryHandle(dirName, { create: true })));
  return {
    async write(name, bytes) {
      const h = await (await dir()).getFileHandle(name, { create: true });
      const w = await h.createWritable(); await w.write(bytes); await w.close();
    },
    async read(name) {
      try { const h = await (await dir()).getFileHandle(name); return new Uint8Array(await (await h.getFile()).arrayBuffer()); }
      catch { return null; }
    },
    async remove(name) { try { await (await dir()).removeEntry(name); } catch {} },
    async list() {
      const out = [];
      try { for await (const [name, h] of (await dir()).entries()) { try { out.push({ name, size: (await h.getFile()).size }); } catch {} } } catch {}
      return out;
    },
  };
}

// name = `${kind}-${airAt padded}-${kappa}` — LRU by air time is a name sort.
const nameOf = (kind, airAt, kappa) => `${kind}-${String(airAt).padStart(14, "0")}-${kappa}`;

export async function openStore({ backend = null, maxBytes = 200 * 1024 * 1024 } = {}) {
  const be = backend || (typeof navigator !== "undefined" && navigator.storage?.getDirectory ? opfsBackend() : memBackend());
  const idx = new Map();     // kappa → { name, size, airAt, kind }
  let total = 0;
  for (const { name, size } of await be.list()) {
    const m = name.match(/^(seg|man)-(\d{14})-([0-9a-f]{64})$/);
    if (m) { idx.set(m[3], { name, size, airAt: +m[2], kind: m[1] }); total += size; }
  }
  async function evict() {
    while (total > maxBytes && idx.size) {
      let oldest = null;
      for (const e of idx.values()) if (!oldest || e.airAt < oldest.airAt) oldest = e;
      await be.remove(oldest.name);
      for (const [k2, e] of idx) if (e === oldest) idx.delete(k2);
      total -= oldest.size;
    }
  }
  return {
    // put: refuses bytes that do not rederive to κ — a store never launders.
    async put(kind, kappa, airAt, bytes) {
      if (idx.has(kappa)) return true;
      if ((await sha256hex(bytes)) !== kappa) return false;
      const name = nameOf(kind, airAt, kappa);
      await be.write(name, bytes);
      idx.set(kappa, { name, size: bytes.length, airAt, kind });
      total += bytes.length;
      await evict();
      return true;
    },
    // get: REVERIFIES on read; a rotted or tampered file is evicted, not served.
    async get(kappa) {
      const e = idx.get(kappa); if (!e) return null;
      const bytes = await be.read(e.name);
      if (!bytes || (await sha256hex(bytes)) !== kappa) {
        if (e) { await be.remove(e.name); idx.delete(kappa); total -= e.size; }
        return null;
      }
      return bytes;
    },
    has: (kappa) => idx.has(kappa),
    // newest first — the tail a joining set asks for.
    manifests(n = 16) {
      return [...idx.entries()].filter(([, e]) => e.kind === "man").sort((a, b) => b[1].airAt - a[1].airAt)
        .slice(0, n).map(([kappa, e]) => ({ kappa, ...e }));
    },
    stats: () => ({ items: idx.size, bytes: total }),
  };
}
