// What a character counter has to decide, kept away from the DOM so it can be
// tested: how much of the budget is gone, and whether to say so quietly, in
// amber, or in red.

// Amber at four fifths of the budget. Earlier than that and every field spends
// most of its life shouting; later and the warning arrives after the sentence
// the leader was going to have to cut anyway.
const NEAR_RATIO = 0.8;

export function counterState(used, max) {
  const cap = Math.max(0, Number(max) || 0);
  const count = Math.max(0, Number(used) || 0);
  return {
    used: count,
    max: cap,
    remaining: cap - count,
    near: cap > 0 && count >= Math.floor(cap * NEAR_RATIO) && count <= cap,
    over: count > cap,
  };
}

// Paste is the one way past a keystroke cap, so what lands is trimmed to what
// is left rather than accepted and cut on save.
export function fitPlain(text, remaining) {
  const room = Math.max(0, Number(remaining) || 0);
  const value = String(text ?? "");
  return room >= value.length ? value : value.slice(0, room);
}
