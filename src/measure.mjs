// measure.mjs — a set measures ITSELF, silently, and the network promotes it.
//
// No probe traffic: the meter reads what already flows (bytes arriving on the
// set's data channels), plus two health facts the page owns (page visibility,
// store write success). Windows of `windowMs`; a window is GOOD when the set
// was visible, its store wrote cleanly, and inbound rate cleared `minRate`
// (proof a real path is carrying the stream through this set).
//
// Hysteresis: promote after `promoteAfter` consecutive good windows; demote
// after ONE bad one (a tower that falters must shed its children before it
// hurts them). Pure and injectable — the Node witness feeds it synthetic
// samples and a fake clock.
//
// HONEST BOUNDARY (say it everywhere this is used): the meter keeps an honest
// set from overcommitting; it cannot stop a hostile set from LYING upward.
// A lying tower can only serve slowly or not at all — every byte it touches
// is still κ verified, so it can waste, never corrupt.

export function makeMeter({ now = Date.now, windowMs = 2000, minRate = 4000, promoteAfter = 2 } = {}) {
  let bytes = 0, winStart = now();
  let visible = true, storeOk = true;
  let good = 0, cap = "leaf";
  const roll = () => {
    const t = now();
    if (t - winStart < windowMs) return;
    const rate = (bytes * 1000) / (t - winStart);
    const ok = visible && storeOk && rate >= minRate;
    good = ok ? good + 1 : 0;
    cap = good >= promoteAfter ? "relay" : "leaf";
    bytes = 0; winStart = t;
  };
  return {
    onBytes(n) { bytes += n; roll(); },
    setVisible(v) { visible = !!v; roll(); },
    setStoreOk(v) { storeOk = !!v; roll(); },
    cap() { roll(); return cap; },
    stats() { roll(); return { cap, good, visible, storeOk }; },
  };
}
