# Infinite Channel

Serverless, unbannable, chat-driven generative TV.

**The channel is a signed strand of clip κs — a content-addressed object, not a
socket.** A creator device turns live chat prompts into video clips (Minimax H3
Max generates faster than you can watch), seals each clip into content-addressed
segments, signs a tiny manifest entry (the shared clock), and hands everything
once to a bounded-fanout tree of viewers. Every viewer verifies every byte by
re-derivation, plays on the shared clock, and automatically relays to its tree
children — **popularity adds capacity instead of cost**. No ingest server, no
CDN, no platform, no kill-switch: the channel's identity is an Ed25519 key.

Built on the Hologram κ-fabric ([vendor/PROVENANCE.md](vendor/PROVENANCE.md)):
blind verified peer-relays (a relay without the room key forwards ciphertext it
can neither read nor forge) over a coordinator-free deterministic tree
(every peer computes the identical topology from the membership set — O(k)
uplink per node, O(1) churn perturbation, no election, no SFU).

## Why this shape

Generation is **faster than playback**, so this is not a live-video problem: the
channel is a stream of immutable, already-finished chunks published slightly
ahead of time, plus a ~200-byte signed heartbeat saying which chunk plays now.
Every hard live-streaming problem (real-time encode, jitter, backpressure)
evaporates; what remains is verified replication and a clock.

```
GENERATION  (creator device — the only machine that must stay up)
  chat κ-objects → director filter → Minimax (fal.ai) → clip bytes
  → segments (≤60 KB, sha256 κ each) → SIGNED strand entry {seq, prev, segs, startAt}
  → fabric.publish(), once, to ≤ k tree links

DISTRIBUTION  (every viewer, automatically)
  verify manifest signature + chain → re-derive every segment κ →
  assemble → play at startAt (the SHARED CLOCK) → relay to tree children

RENDEZVOUS  (bootstrap only)
  membership gossip over a content-blind door; in production the Nostr
  dead-drop of hologram-os holo-rendezvous.mjs (coordinate DERIVED from the
  channel κ, sealed SDP over public relays — no operator server)
```

## Layout

- [`src/strand.mjs`](src/strand.mjs) — channel identity (Ed25519) + signed hash-linked manifest; verifier anchors mid-chain (live join).
- [`src/channel.mjs`](src/channel.mjs) — generator + viewer engines; three object kinds (`man`/`seg`/`chat`), one fabric waist.
- [`src/wire.mjs`](src/wire.mjs) — the one payload framing (encrypted headers; relays route only by κ).
- [`web/watch.html`](web/watch.html) + [`web/link.mjs`](web/link.mjs) — both ends as one page: membership gossip → tree → one RTCDataChannel per edge.
- [`director/director-fal.mjs`](director/director-fal.mjs) — the real clip source (fal.ai queue API; `FAL_KEY` from env, never in code).
- [`vendor/`](vendor/) — the Hologram κ-fabric, verbatim.
- [`witness/`](witness/) — proof, not tests-as-decoration (below).

## Witnesses (run them)

```
npm run witness        # pure: no network, no browser, the real modules
npm run witness:live   # live: real Chromium contexts, real RTCDataChannels
```

Pure witness (10/10 on 2026-08-29):
**A. shared clock** — 3 viewers play the same clip κ within ms of the signed
`startAt`, not on arrival · **B. O(k) uplink** — generator holds ≤ k+1 links
regardless of audience · **C. verification** — one flipped byte anywhere is
dropped on κ re-derivation; a manifest signed by a non-channel key (even one
holding the room key) never plays · **D. churn** — a killed viewer rejoins under
a peer, anchors mid-chain, and plays the next clip with no generator edge.

Live witness (8/8 on 2026-08-29): the same invariants over real browser
contexts and real data channels, plus a viewer prompt riding the fabric back up
to the generator. Headless media stacks crash on `MediaRecorder`
(`witness/debug-rec.mjs` is the repro), so the live witness runs PNG stills;
the webm path is the same page in a desktop browser, and moving video over this
exact fabric is witnessed upstream (`holo-fabric-call.witness.mjs`).

## Generation (measured)

fal.ai's free H3 Max playground (2026-08-29): a 5.18 s 1344×768 clip, 7.24 MB,
in ~3–4 s wall. With `FAL_KEY`:

```
FAL_KEY=... node director/director-fal.mjs "a weary alien interviews a sentient houseplant"
```

Cost scales with minutes generated — never with viewers.

## The math

Native H3 clips are ~11 Mbps — too hot for residential relays at k=4. One
creator-side re-encode to ~3 Mbps 720p (WebCodecs, cheap) gives: relay uplink
~12 Mbps, creator uplink ~15 Mbps **constant in N**, 10,000 viewers ≈ 7 hops
≈ 10 s tree traversal — invisible inside a 30–60 s playhead lag. Prompt-to-
screen ≈ 1.5–3 min at steady state (generation latency + buffer), matching the
original stream's feel.

## Honest boundaries

- **Rendezvous rides commons** (public Nostr relays / STUN) — no operator
  server, not zero infra. The witness relay is local stand-in glue.
- **Capacity-blind tree** — slots are assigned by hash, not uplink; a weak peer
  can land as an internal node. Fix: a capacity hint in membership gossip
  (weak peers become leaves). The one real piece of net-new mesh work.
- **Key compromise = channel death.** Plan a signed rotation entry.
- **Moderation moves, it doesn't vanish** — the creator's director filter is an
  edit desk; the creator is a publisher, with a publisher's copyright exposure,
  and there is no platform to appeal to or to hide behind.
- **Minimax via fal is the remaining centralized dependency** — generation, not
  distribution; swappable per-clip for any model, eventually a local one.
