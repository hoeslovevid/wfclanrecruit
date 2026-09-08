import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ZOOM,
  centerOffset,
  clampOffset,
  clampZoom,
  coverScale,
  sourceRect,
  zoomAbout,
} from "./crop.js";

const frame = 300;

test("cover scale is driven by the short edge", () => {
  assert.equal(coverScale(600, 300, frame), 1);
  assert.equal(coverScale(1200, 600, frame), 0.5);
  assert.equal(coverScale(300, 1200, frame), 1);
});

test("a broken image reports no scale rather than infinity", () => {
  assert.equal(coverScale(0, 500, frame), 0);
  assert.equal(coverScale(500, 0, frame), 0);
});

test("zoom never drops below cover or climbs past the cap", () => {
  assert.equal(clampZoom(0.2), 1);
  assert.equal(clampZoom(2.5), 2.5);
  assert.equal(clampZoom(99), MAX_ZOOM);
  assert.equal(clampZoom("nonsense"), 1);
});

test("a wide image starts centred horizontally and flush vertically", () => {
  const scale = coverScale(600, 300, frame);
  assert.deepEqual(centerOffset({ width: 600, height: 300, frame, scale }), { x: -150, y: 0 });
});

test("a square image at cover sits exactly in the frame", () => {
  const scale = coverScale(400, 400, frame);
  assert.deepEqual(centerOffset({ width: 400, height: 400, frame, scale }), { x: 0, y: 0 });
});

test("dragging cannot pull the image off an edge", () => {
  const scale = coverScale(600, 300, frame);
  const bounds = { width: 600, height: 300, frame, scale };
  assert.deepEqual(clampOffset({ ...bounds, x: 40, y: 40 }), { x: 0, y: 0 });
  assert.deepEqual(clampOffset({ ...bounds, x: -9999, y: -9999 }), { x: -300, y: 0 });
});

test("an offset already inside the bounds is left alone", () => {
  const scale = coverScale(600, 300, frame);
  assert.deepEqual(clampOffset({ width: 600, height: 300, frame, scale, x: -120, y: 0 }), {
    x: -120,
    y: 0,
  });
});

test("zooming in holds the middle of the frame still", () => {
  const scale = coverScale(400, 400, frame);
  const next = zoomAbout({
    x: 0,
    y: 0,
    width: 400,
    height: 400,
    frame,
    scale,
    nextScale: scale * 2,
  });
  // The image doubled around the centre, so each edge moved out by half a frame.
  assert.deepEqual(next, { x: -150, y: -150 });
});

test("zooming back out lands flush rather than leaving a gap", () => {
  const scale = coverScale(400, 400, frame);
  const next = zoomAbout({
    x: -150,
    y: -150,
    width: 400,
    height: 400,
    frame,
    scale: scale * 2,
    nextScale: scale,
  });
  assert.deepEqual(next, { x: 0, y: 0 });
});

test("the source rect is the frame read back in the image's own pixels", () => {
  const scale = coverScale(600, 300, frame); // 1
  assert.deepEqual(sourceRect({ x: -150, y: 0, frame, scale }), { sx: 150, sy: 0, size: 300 });
});

test("a zoomed crop reads back a smaller square of the original", () => {
  const scale = coverScale(600, 600, frame) * 2; // 1
  assert.deepEqual(sourceRect({ x: -300, y: -300, frame, scale }), { sx: 300, sy: 300, size: 300 });
});
