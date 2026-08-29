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
* **The relay web is a BRAID.** Sets form TWO deterministic bounded fanout
  trees computed identically by every peer, no coordinator: a deep tree and a
  wide backup tree whose interior is drawn from the first tree's exterior, so
  no honest set carries fanout in both. Links are the union; the fabric
  floods with κ dedup, so one crashed tower costs nobody a frame — the other
  tree's edges still connect the survivors. The desk itself is a pinned
  SOURCE, a leaf in both trees: the audience carries every copy, and the
  desk's uplink stays constant no matter the crowd.
* **Every set earns its place.** A set is born a leaf. While it watches, it
  measures itself — bytes flowing, tab visible, store writing clean — and
  after two good windows it silently declares it can carry, the braid
  recomputes, and it becomes a tower. One bad window and it demotes before
  it hurts anyone. No toggle, no dialog, no permission: watching is the only
  action, and the network organizes itself around who can actually help.
* **Watching is seeding.** Every clip a set plays lands in its own κ store
  (OPFS, bounded at 200 MB, oldest air time evicted first, never a prompt).
  Any set can then serve history to any joining set over the same channels —
  want by κ, serve, rederive, believe only what hashes. A late joiner tunes
  into a full reel from the AUDIENCE; the desk can crash and the last hours
  of television stay alive in the sets that watched them.
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
npm run witness:tower      # the braid, the meter, the store, the storm
npm run witness:live       # real browsers, real data channels
npm run witness:seed       # promotion, peer served history, desk death
npm run witness:broker     # rendezvous through public brokers only
npm run witness:style      # the portal terminal laws (below)
```

| suite | result | proves |
| --- | --- | --- |
| channel | 10/10 | shared clock within 8 ms · O(k) desk uplink · a flipped byte drops · a wrong key never airs · a killed set rejoins from peers only |
| capacity | 8/8 | leaf sets forwarded exactly zero objects while relay sets carried the fan out; placement identical on every peer |
| live | 9/9 | all of the above over real Chromium sets and real RTCDataChannels, plus a viewer transmission reaching the desk |
| tower | 15/15 | braid interiors fully disjoint at N ≤ 32 · promotion after two good windows, demotion after one bad · a store refuses what does not rederive and evicts what rots · THE STORM: a tower and two leaves crash with no goodbye and every survivor still plays the next clip before air time · the audience pushed 4.9× the desk's bytes |
| seed | 8/8 | towerhood earned by watching, zero UI events · a late joiner filled its reel from a PEER in 433 ms with zero desk bytes · a peer serving corrupted bytes was caught by rederivation and routed around · the desk crashed and a brand new set still tuned into the archive |
| broker | 3/3 | sets found the channel through public MQTT brokers alone — the static host had no signal endpoint at all |
| style | 11/11 | the forbidden character absent from every user facing string · no scrollbar from phone to 4K · the golden ratio present and obeyed · paint and zap budgets measured |

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
* The meter keeps an HONEST set from overcommitting; it cannot stop a hostile
  set from lying upward. A lying tower can serve slowly, refuse, or waste —
  it can never corrupt (every byte rederives), impersonate (every manifest is
  signed), or censor (the braid routes around it within beats).
* Key compromise is channel death. A signed rotation entry is planned.
* Moderation moves, it does not vanish. The desk's filter is an edit desk;
  the operator is a publisher with a publisher's exposure, and there is no
  platform to appeal to or to hide behind.
* Minimax via fal is the one centralized dependency — generation, never
  distribution. It scales with minutes generated, not with viewers, and swaps
  per clip for any model, eventually a local one.

## What can a platform seize?

Walk the data path looking for a throat to choke. The stream: peer to peer,
sealed, κ verified — nothing to seize. The archive: replicated in every
watching set's own store — seizing any machine, including the desk, loses
nothing the audience holds. The rendezvous: free public brokers, fungible and
raced — block one and the door rotates to another. The identity: a signing
key in the operator's hand — it walks away and broadcasts again from any
static page on earth. What a platform CAN do is refuse to host a copy of one
HTML file; the answer to that is every other place an HTML file can live.
