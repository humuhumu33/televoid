// strings.mjs — TELEVOID: every user facing word, one place, one voice.
//
// The voice: deadpan cosmic broadcast operator. Wit through understatement.
// HARD LAW (style witness enforced): no "-" in any string below, ever.
//
// Name candidates considered: TELEVOID · STATICA · REALITY DIAL · PORTALSET ·
// VOIDCAST · KZAP · TUNEVERSE · OMNITUNER · CHANNEL NULL · THE RECEIVER.
// TELEVOID won: short, shoutable, a domain, a wordmark, and it says the thing —
// television, from the void.

export const NAME = "TELEVOID";
export const TAGLINE = "television from realities that don't exist";
export const HN_SENTENCE = "A TV set that receives broadcasts from realities that don't exist, with no server behind it.";

// The golden ratio — the layout law. Screen : console = PHI : 1.
// Type scale steps by PHI from 16px. Spacing derives from the same ratio.
export const PHI = 1.618;

export const STR = {
  tuning: "locking onto reality",
  live: "LIVE",
  returnLive: "RETURN TO LIVE",
  betweenRealities: "between realities",
  verified: "signal verified",
  zap: "ZAP",
  transmit: "transmit to the studio…",
  transmitSent: "transmission received by the studio",
  share: "beam this channel",
  shared: "channel link beamed to your clipboard",
  reality: "REALITY",
  receiving: (n) => (n === 1 ? "1 set receiving" : n + " sets receiving"),
  transmissionFrom: (from) => "transmission from " + from,
  desk: "BROADCAST DESK",
  transmitterPower: "transmitter power (your FAL key, kept in this set)",
  onAir: "ON AIR",
  standBy: "STAND BY",
  broadcasts: (n) => n + " broadcasts sent",
};
