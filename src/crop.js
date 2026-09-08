// The geometry behind the emblem cropper, kept away from the DOM so the part
// that is easy to get wrong is the part that is tested.
//
// One model throughout: the frame is a square of `frame` units, the image is
// drawn at `scale`, and `x`/`y` are the image's top-left corner measured from
// the frame's top-left. Both are therefore zero or negative - a positive corner
// would mean the frame is showing something the image does not cover.

// The zoom at which the image exactly covers the frame. Anything less would
// leave a gap, so this is the floor every other number is measured against.
export function coverScale(width, height, frame) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (w <= 0 || h <= 0) return 0;
  return frame / Math.min(w, h);
}

// Four times the cover is enough to crop a face out of a group photo and not
// so much that the emblem turns to porridge.
export const MAX_ZOOM = 4;

export function clampZoom(zoom) {
  const value = Number(zoom);
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_ZOOM, Math.max(1, value));
}

// Dragging is free until the image would pull away from an edge. Clamping here
// rather than in the drag handler means the frame is never partly empty, no
// matter how the offset was arrived at - drag, zoom, or a fresh file.
export function clampOffset({ x, y, width, height, frame, scale }) {
  const drawnWidth = width * scale;
  const drawnHeight = height * scale;
  return {
    x: Math.min(0, Math.max(frame - drawnWidth, Number(x) || 0)),
    y: Math.min(0, Math.max(frame - drawnHeight, Number(y) || 0)),
  };
}

// Where a fresh image sits: centred, both ways.
export function centerOffset({ width, height, frame, scale }) {
  return clampOffset({
    x: (frame - width * scale) / 2,
    y: (frame - height * scale) / 2,
    width,
    height,
    frame,
    scale,
  });
}

// Zooming holds the middle of the frame still. Growing the image around the
// centre is what makes the slider feel like a lens rather than a scrollbar.
export function zoomAbout({ x, y, width, height, frame, scale, nextScale }) {
  const ratio = nextScale / scale;
  const middle = frame / 2;
  return clampOffset({
    x: middle - (middle - x) * ratio,
    y: middle - (middle - y) * ratio,
    width,
    height,
    frame,
    scale: nextScale,
  });
}

// The square of the original image the frame is looking at, in the image's own
// pixels - which is exactly what canvas drawImage wants for its source rect.
export function sourceRect({ x, y, frame, scale }) {
  // The offsets are zero or negative, so negating them lands on the source
  // corner. Flooring at zero keeps a stray positive from reading off the
  // image, and keeps a zero offset from coming back as -0.
  return {
    sx: Math.max(0, -x / scale),
    sy: Math.max(0, -y / scale),
    size: frame / scale,
  };
}
