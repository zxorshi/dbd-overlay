// Map detection by reading text on screen. No game memory is read; this only looks at pixels.
// Catalog matching and the lock / unlock session are ported from zxorshi/dbd-clock-overlay (MIT).
const path = require('node:path');

const norm = (s) => String(s).toLowerCase().replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const NUMERAL = /\s+(i{1,3}|iv|v|[1-5])$/;
// Aliases that are ordinary phrases only count when they are the whole line ("Leave the game" must not match).
const STRICT = new Set(['the game']);
const EXTRA = {
  'Badham/Preschool4.webp': ['Preschool IV'],
  'Raccoon City/Rpd East Wing.webp': ['RPD East Wing'],
  'Raccoon City/Rpd West Wing.webp': ['RPD West Wing'],
  'Other/Hawkins.webp': ['Hawkins National Laboratory'],
};
const END_SCREEN = /^\s*(continue|scoreboard|match\s*result)\s*$/i;
const END_COOLDOWN = 20000; // the scoreboard can show the map name: ignore map names for a while after it
const CONFIRM_SCANS = 2;

function buildCatalog(raw) {
  return raw.map((m) => {
    const names = [...m.names, ...(EXTRA[m.image] || [])];
    const aliases = [...new Set(names.map(norm).filter((n) => n.length >= 5))].sort((a, b) => b.length - a.length);
    return { ...m, aliases, family: m.realm + '/' + norm(m.name).replace(NUMERAL, '') };
  });
}
const variants = (catalog, m) => catalog.filter((x) => x.family === m.family);

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
// Best similarity of `alias` against any same-word-count window of `line`.
function partial(alias, line) {
  const n = alias.split(' ').length; const t = line.split(' '); let best = 0;
  for (let i = 0; i + n <= t.length; i++) {
    const w = t.slice(i, i + n).join(' ');
    best = Math.max(best, 1 - distance(w, alias) / Math.max(w.length, alias.length));
  }
  return best;
}
const wordHit = (alias, line) => (' ' + line + ' ').includes(' ' + alias + ' ');

// Returns the catalog entry whose name appears in the text lines, or null.
function matchMap(lines, catalog) {
  const ls = lines.map(norm).filter(Boolean);
  let best = null; let bestLen = 0;
  for (const line of ls) for (const m of catalog) for (const a of m.aliases) {
    const hit = STRICT.has(a) ? line === a : wordHit(a, line);
    if (hit && a.length > bestLen) { best = m; bestLen = a.length; }
  }
  if (best) return best;
  let bestScore = 0;
  for (const line of ls) for (const m of catalog) for (const a of m.aliases) {
    if (a.length < 10 || STRICT.has(a)) continue;
    const score = partial(a, line);
    if (score >= 0.88 && score > bestScore) { best = m; bestScore = score; }
  }
  if (best) {
    const nums = new Set(ls.flatMap((l) => l.split(' ')).filter((t) => /^(i{1,3}|iv|v|[1-5])$/.test(t)));
    for (const v of variants(catalog, best)) { const s = norm(v.name).match(NUMERAL); if (s && nums.has(s[1])) return v; }
  }
  return best;
}

// Lock onto a map when its name is read in consecutive scans; unlock at the end-of-match screen.
function createSession(catalog) {
  let candidate = null; let hits = 0; let ignoreUntil = 0;
  return {
    reset() { candidate = null; hits = 0; },
    // `cur` = { id, locked }. Returns { lock: id } | { unlock: true } | null.
    onLines(lines, cur, now) {
      if (lines.some((l) => END_SCREEN.test(l))) { ignoreUntil = now + END_COOLDOWN; candidate = null; hits = 0; return cur.locked ? { unlock: true } : null; }
      if (cur.locked || now < ignoreUntil) return null;
      let m = matchMap(lines, catalog);
      if (!m) { candidate = null; hits = 0; return null; }
      // A detected base name keeps the variant picked earlier ("Coal Tower" keeps "Coal Tower II").
      const prev = catalog.find((x) => x.id === cur.id);
      if (prev && prev.family === m.family && m === variants(catalog, m)[0]) m = prev;
      hits = m === candidate ? hits + 1 : 1; candidate = m;
      return hits >= CONFIRM_SCANS ? { lock: m.id } : null;
    },
  };
}

// Crops applied before OCR, as fractions of the frame: [x, y, width, height].
const REGIONS = { full: [0, 0, 1, 1], bottomLeft: [0, 0.5, 0.5, 0.5], bottom: [0, 0.6, 1, 0.4], center: [0.2, 0.3, 0.6, 0.4] };

// `winOcr` (optional) is tried first; Tesseract is the fallback and the only engine off Windows.
function createDetector({ cacheDir, grab, onLines, winOcr, engineChoice = () => 'auto' }) {
  let worker = null; let timer = null; let busy = false; let engine = '';
  async function tesseract(png) {
    if (!worker) {
      const { createWorker } = require('tesseract.js');
      // Packaged builds keep these modules outside the asar archive (see asarUnpack in package.json).
      const real = (f) => f.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
      worker = await createWorker('eng', 1, {
        langPath: real(path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int')),
        workerPath: real(path.join(path.dirname(require.resolve('tesseract.js/package.json')), 'src', 'worker-script', 'node', 'index.js')),
        cachePath: cacheDir, gzip: true,
      });
    }
    const { data } = await worker.recognize(png);
    return data.text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  }
  async function recognize(png) {
    if (winOcr && winOcr.available && engineChoice() !== 'tesseract') {
      try { const lines = await winOcr.recognize(png); engine = 'Windows OCR'; return lines; } catch { /* fall through */ }
    }
    engine = 'Tesseract';
    return tesseract(png);
  }
  async function scan(region) {
    if (busy) return; busy = true;
    try { const png = await grab(REGIONS[region] || REGIONS.full); onLines(png ? await recognize(png) : [], null, engine); }
    catch (err) { onLines([], String(err.message || err), engine); } finally { busy = false; }
  }
  return {
    scan, recognize,
    start(region, ms = 2000) { this.stop(); timer = setInterval(() => scan(region), ms); },
    stop() { clearInterval(timer); timer = null; },
    async close() { this.stop(); if (winOcr) winOcr.close(); if (worker) await worker.terminate(); worker = null; },
  };
}

module.exports = { buildCatalog, variants, matchMap, createSession, createDetector, norm, REGIONS };
