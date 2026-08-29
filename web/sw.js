// sw.js — the set remembers itself. Cache first for the shell, so a returning
// viewer paints from disk before the network says a word (the instant reload
// discipline of hologram-os, applied at TELEVOID scale). Clips never touch
// this cache — they are κ verified in the page and live in the reel.
const CACHE = "televoid4";   // BUMP THIS on every shell change — cache first means stale otherwise
const SHELL = ["./watch.html", "./link.mjs", "./strings.mjs", "./broker-door.mjs",
  "../src/channel.mjs", "../src/strand.mjs", "../src/wire.mjs", "../src/capacity-tree.mjs",
  "../src/braid.mjs", "../src/measure.mjs", "../src/store.mjs",
  "../vendor/holo-fabric.mjs", "../vendor/holo-fabric-tree.mjs"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || u.pathname.includes("/signal")) return;   // signals stay live
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit ||
    fetch(e.request).then((res) => { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)).catch(() => {}); return res; })));
});
