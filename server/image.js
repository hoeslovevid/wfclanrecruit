import fs from "node:fs/promises";
import path from "node:path";

export const IMAGE_MAX_EDGE = 960;

let sharpLoader = null;

async function loadSharp() {
  if (!sharpLoader) {
    sharpLoader = import("sharp")
      .then((mod) => mod.default)
      .catch((error) => {
        console.warn("Listing image resize is off:", error.message);
        return null;
      });
  }
  return sharpLoader;
}

export async function resizeListingImage(filePath) {
  const sharp = await loadSharp();
  if (!sharp) return path.basename(filePath);

  const dir = path.dirname(filePath);
  const destName = `${path.basename(filePath, path.extname(filePath))}.webp`;
  const dest = path.join(dir, destName);
  const tmp = `${dest}.tmp`;
  try {
    await sharp(filePath, { animated: false, failOn: "error" })
      .rotate()
      .resize(IMAGE_MAX_EDGE, IMAGE_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(tmp);
    await fs.rename(tmp, dest);
    if (path.resolve(dest) !== path.resolve(filePath)) {
      await fs.unlink(filePath).catch(() => {});
    }
    return destName;
  } catch (error) {
    await fs.unlink(tmp).catch(() => {});
    throw error;
  }
}
