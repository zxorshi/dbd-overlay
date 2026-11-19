// Map detection by reading text on screen. No game memory is read; this only looks at pixels.
// Approach follows open source tools (H4RDC0RN/dbd-overlay, erktiky/DBDMap): OCR, then fuzzy match to map names.
const path = require('node:path');

const norm = (s) => String(s).toLowerCase().replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}
const ratio = (a, b) => (a.length || b.length ? 1 - distance(a, b) / Math.max(a.length, b.length) : 0);

// Returns { id, score } for the best map name found in the text, or null below the threshold.
function matchMap(text, maps, threshold = 0.84) {
  const lines = String(text).split(/\n+/).map(norm).filter((l) => l.length >= 4);
  let best = null;
  for (const m of maps) {
    const name = norm(m.name); const words = name.split(' ').length;
    for (const line of lines) {
      const tokens = line.split(' ');
      // Compare the name against every run of the same number of words in the line.
      for (let i = 0; i + words <= tokens.length; i++) {
        const score = ratio(tokens.slice(i, i + words).join(' '), name);
        if (score >= threshold && (!best || score > best.score || (score === best.score && name.length > best.len))) best = { id: m.id, score, len: name.length };
      }
    }
  }
  return best && { id: best.id, score: Math.round(best.score * 100) / 100 };
}

// Crops applied before OCR, as fractions of the frame: [x, y, width, height].
const REGIONS = { full: [0, 0, 1, 1], bottomLeft: [0, 0.5, 0.5, 0.5], bottom: [0, 0.6, 1, 0.4], center: [0.2, 0.3, 0.6, 0.4] };

function createDetector({ maps, cacheDir, grab, onResult }) {
  let worker = null; let timer = null; let busy = false;
  async function recognize(png) {
    if (!worker) {
      const { createWorker } = require('tesseract.js');
      worker = await createWorker('eng', 1, {
        langPath: path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int'),
        cachePath: cacheDir, gzip: true,
      });
    }
    const { data } = await worker.recognize(png);
    return data.text;
  }
  async function scan(region) {
    if (busy) return null; busy = true;
    try {
      const png = await grab(REGIONS[region] || REGIONS.full);
      const text = png ? await recognize(png) : '';
      const hit = matchMap(text, maps);
      onResult({ hit, text: text.slice(0, 400) });
      return hit;
    } catch (err) { onResult({ hit: null, text: '', error: String(err.message || err) }); return null; } finally { busy = false; }
  }
  return {
    scan, recognize,
    start(region, ms = 3000) { this.stop(); timer = setInterval(() => scan(region), ms); },
    stop() { clearInterval(timer); timer = null; },
    async close() { this.stop(); if (worker) await worker.terminate(); worker = null; },
  };
}

module.exports = { matchMap, createDetector, norm, REGIONS };
