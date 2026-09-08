import test from "node:test";
import assert from "node:assert/strict";
import { counterState, fitPlain } from "./limits.js";

test("an empty field is neither near nor over", () => {
  const state = counterState(0, 220);
  assert.equal(state.used, 0);
  assert.equal(state.remaining, 220);
  assert.equal(state.near, false);
  assert.equal(state.over, false);
});

test("well under the budget stays quiet", () => {
  assert.equal(counterState(100, 220).near, false);
});

test("four fifths of the budget turns the counter amber", () => {
  assert.equal(counterState(175, 220).near, false);
  assert.equal(counterState(176, 220).near, true);
});

test("the last character allowed is near, not over", () => {
  const state = counterState(220, 220);
  assert.equal(state.near, true);
  assert.equal(state.over, false);
  assert.equal(state.remaining, 0);
});

test("past the budget is over and stops being near", () => {
  const state = counterState(221, 220);
  assert.equal(state.over, true);
  assert.equal(state.near, false);
  assert.equal(state.remaining, -1);
});

test("a missing budget never reports near", () => {
  assert.equal(counterState(10, 0).near, false);
  assert.equal(counterState(10, undefined).over, true);
});

test("a paste that fits is left alone", () => {
  assert.equal(fitPlain("Steel Path nights", 100), "Steel Path nights");
});

test("a paste that overruns is trimmed to what is left", () => {
  assert.equal(fitPlain("abcdefgh", 3), "abc");
});

test("a paste with no budget left lands as nothing", () => {
  assert.equal(fitPlain("abcdefgh", 0), "");
  assert.equal(fitPlain("abcdefgh", -5), "");
});
