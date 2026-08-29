# TELEVOID

> A TV set that receives broadcasts from realities that don't exist, with no server behind it.

**television from realities that don't exist**

TELEVOID is a television. Viewers type transmissions into the set; a broadcast
desk turns them into video through a model that generates faster than anyone
can watch; every set that tunes in verifies the signal and relays it onward to
the sets behind it. Popularity adds capacity instead of cost. There is no
ingest server, no CDN, no platform, and no kill switch — the channel's entire
identity is a signing key.

## Tune in

```
npm run serve
```

Open the creator URL it prints (the BROADCAST DESK), then the viewer URL on as
many sets as you like. Add `&door=broker` to run the rendezvous over public
brokers instead of the local relay — at that point nothing you operate is in
the loop. Paste a FAL key into the desk's transmitter power field and viewer
transmissions become real Minimax broadcasts; leave it empty and the desk
airs its built in test pattern.

One verb: **ZAP** (the button, the spacebar, or tap the screen) surfs the
realities your set has already received. The red LIVE light means you are on
the shared clock — the same moment every other set is watching.

## Broadcast physics

* **The channel is a signed strand.** Each clip's manifest names its segment
  κs, links to the previous entry, and is signed by the channel key. A set
  holding only the public key refuses forged or resequenced broadcasts before
  anything airs.
* **Every byte is rederived.** A segment plays only if it hashes to exactly
  the κ the signed manifest promised. Relays are blind: a set without the
  room key forwards ciphertext it can neither read nor alter, and one flipped
  bit anywhere is dropped on arrival.
* **The clock tower.** Air time rides inside each signed entry. Sets play at
  that instant, not on arrival — thousands of screens, one moment.
* **The relay web.** Sets form a deterministic bounded fanout tree computed
  identically by every peer, no coordinator. The desk uplinks O(k) no matter
  the audience. A set on a weak uplink declares itself a leaf and is never
  asked to forward anything.
* **Waiting is weather.** All real latency — tree joins, segment assembly,
  generation lag — appears on screen as static between realities. The set
  never says loading, because static is a picture.

## The one diagram

```
  THE DESK                    THE CLOCK TOWER              THE RELAY WEB
  transmissions from sets     one tiny signed entry        every set verifies,
  → Minimax → clip bytes  →   {segment κs, air time}   →   plays on the clock,
  → κ segments → fabric       fresh, gossiped, ~200 B      relays to its children
```

## Witnesses (run them — proof, not decoration)

```
npm run witness            # the pure invariant, no network, no browser
npm run witness:capacity   # weak sets sit at the leaves
npm run witness:live       # real browsers, real data channels
npm run witness:broker     # rendezvous through public brokers only
npm run witness:style      # the portal terminal laws (below)
```

| suite | result | proves |
| --- | --- | --- |
| channel | 10/10 | shared clock within 8 ms · O(k) desk uplink · a flipped byte drops · a wrong key never airs · a killed set rejoins from peers only |
| capacity | 8/8 | leaf sets forwarded exactly zero objects while relay sets carried the fan out; placement identical on every peer |
| live | 9/9 | all of the above over real Chromium sets and real RTCDataChannels, plus a viewer transmission reaching the desk |
| broker | 3/3 | sets found the channel through public MQTT brokers alone — the static host had no signal endpoint at all |
| style | see run | the forbidden character absent from every user facing string · no scrollbar from phone to 4K · the golden ratio present and obeyed · paint and zap budgets measured |

Measured on August 29, 2026. Generation measured the same day on fal's free
playground: a 5.18 second 1344×768 clip, 7.24 MB, in about 3.5 seconds — the
desk transcodes it to about 3 Mbps before sealing so residential relays carry
k copies comfortably.

## Where things are

* `web/watch.html` — the television. One page, both ends, one screen, no
  scrolling. Layout and type obey the golden ratio (documented in the file).
* `web/strings.mjs` — every user facing word, one voice, zero hyphens.
* `web/link.mjs` · `web/broker-door.mjs` — membership gossip, the capacity
  tree, one RTCDataChannel per tree edge; sealed rendezvous over public
  brokers on unguessable derived topics.
* `web/sw.js` — the set remembers itself: cache first shell, instant warm paint.
* `src/strand.mjs` · `src/channel.mjs` · `src/capacity-tree.mjs` ·
  `src/wire.mjs` — the engines. The restyle did not touch their logic.
* `vendor/` — the Hologram κ fabric, verbatim (see `vendor/PROVENANCE.md`).
* `director/director-fal.mjs` — the clip source as a CLI (`FAL_KEY` from env).

## Substrate note

The private hologram substrate was evaluated for the instant rails
(`hologram-net`: κ only identity, fetch/announce/discover with verify on
receipt, QUIC for native hosts; `hologram-store`: a browser OPFS κ store
behind a wasm JS API). That store is the production lift for the viewer
cache; this repo applies the same discipline in plain JS today — verify by
rederivation everywhere, a service worker owned shell, and clips assembled
ahead of their air time so the cut lands on the clock, not after it.

## Honest boundaries

* Rendezvous rides commons (public MQTT brokers, STUN) — no operator server,
  not zero infra. Brokers are fungible, raced, and see only ciphertext.
* Capacity classes are self declared: a lying leaf shirks relaying, it cannot
  corrupt or read anything. Measured capacity scoring is future work.
* Key compromise is channel death. A signed rotation entry is planned.
* Moderation moves, it does not vanish. The desk's filter is an edit desk;
  the operator is a publisher with a publisher's exposure, and there is no
  platform to appeal to or to hide behind.
* Minimax via fal is the one centralized dependency — generation, never
  distribution. It scales with minutes generated, not with viewers, and swaps
  per clip for any model, eventually a local one.
