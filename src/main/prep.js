// Frame preparation for OCR. Input and output are Electron nativeImage / PNG buffers.
const { nativeImage } = require('electron');

// Crop to a region ([x, y, w, h] as fractions), grayscale, and invert dark frames:
// OCR reads dark text on a light ground best, and game text is light on dark.
// `white`: keep only near-white, unsaturated pixels (the map name's color) as black on white. This removes
// busy backgrounds the name is drawn over.
function prepare(img, [x, y, w, h], { scale = 1, white = false } = {}) {
  const s = img.getSize();
  let cut = img.crop({ x: Math.round(x * s.width), y: Math.round(y * s.height), width: Math.max(1, Math.round(w * s.width)), height: Math.max(1, Math.round(h * s.height)) });
  if (scale !== 1) { const c = cut.getSize(); cut = cut.resize({ width: Math.round(c.width * scale), height: Math.round(c.height * scale), quality: 'best' }); }
  const dim = cut.getSize(); const px = cut.toBitmap(); let sum = 0;
  if (white) {
    for (let i = 0; i < px.length; i += 4) {
      const lo = Math.min(px[i], px[i + 1], px[i + 2]); const hi = Math.max(px[i], px[i + 1], px[i + 2]);
      const g = lo >= 175 && hi - lo <= 40 ? 0 : 255;
      px[i] = g; px[i + 1] = g; px[i + 2] = g; px[i + 3] = 255;
    }
  } else {
    for (let i = 0; i < px.length; i += 4) { const g = (px[i] * 29 + px[i + 1] * 150 + px[i + 2] * 77) >> 8; px[i] = g; sum += g; }
    const invert = sum / (px.length / 4) < 110;
    for (let i = 0; i < px.length; i += 4) { const g = invert ? 255 - px[i] : px[i]; px[i] = g; px[i + 1] = g; px[i + 2] = g; px[i + 3] = 255; }
  }
  return nativeImage.createFromBitmap(px, { width: dim.width, height: dim.height }).toPNG();
}

module.exports = { prepare };
