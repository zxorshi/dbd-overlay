// Map detection by reading text on screen. No game memory is read; this only looks at pixels.
// Catalog matching and the lock / unlock session are ported from zxorshi/dbd-clock-overlay (MIT).
const path = require('node:path');

const norm = (s) => String(s).toLowerCase().replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const NUMERAL = /\s+(i{1,3}|iv|v|[1-5])$/;
// Aliases that are ordinary phrases only count when they are the whole line ("Leave the game" must not match).
const STRICT = new Set(['the game']);
const EXTRA = {
  'Badham/Preschool1.webp': ['Badham Preschool I'], 'Badham/Preschool2.webp': ['Badham Preschool II'], 'Badham/Preschool3.webp': ['Badham Preschool III'],
  'Badham/Preschool4.webp': ['Preschool IV', 'Badham Preschool IV'], 'Badham/Preschool5.webp': ['Badham Preschool V'],
  'Raccoon City/Rpd East Wing.webp': ['RPD East Wing'],
  'Raccoon City/Rpd West Wing.webp': ['RPD West Wing'],
  'Other/Hawkins.webp': ['Hawkins National Laboratory'],
};
// End-of-match screen. Windows OCR returns clean lines; Tesseract often glues neighbours onto a line
// ("SCOREBOARD 00000 |B]") or damages the red title ("OR OARD"), so distinctive words count anywhere in a
// line and SCOREBOARD is also matched loosely. Patterns come from real reader output on game screenshots.
const END_SCREEN = /^\s*(continue|match)\s*$|\bscoreboard\b|\bmatch\s*result\b|\byou have fun\b/i;
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
const squash = (t) => t.replace(/ /g, '');
// Best similarity of `needle` against any equally long stretch of `hay` (both without spaces).
// OCR drops and inserts spaces freely ("DEADDAWGSALOON", "UNDERG ND"), so spaces are ignored.
function windowScore(needle, hay) {
  const n = needle.length;
  if (hay.length < n * 0.7) return 0;
  if (hay.length <= n) return 1 - distance(hay, needle) / n;
  let best = 0;
  for (let i = 0; i + n <= hay.length; i++) { const sc = 1 - distance(hay.slice(i, i + n), needle) / n; if (sc > best) best = sc; }
  return best;
}
const wordHit = (alias, line) => (' ' + line + ' ').includes(' ' + alias + ' ');
// In-game realm names where they differ from the catalog's realm label.
const REALM_NAMES = { Badham: 'Springwood', Ormond: 'Ormond' };

// Returns the catalog entry whose name appears in the text lines, or null.
// Stages, first hit wins: exact words; exact ignoring spaces; close match ignoring spaces;
// a looser match limited to maps of a realm whose name was also read.
function matchDetail(lines, catalog) {
  const ls = lines.map(norm).filter(Boolean);
  let best = null; let bestLen = 0;
  for (const line of ls) for (const m of catalog) for (const a of m.aliases) {
    const hit = STRICT.has(a) ? line === a : wordHit(a, line);
    if (hit && a.length > bestLen) { best = m; bestLen = a.length; }
  }
  if (best) return { map: best, exact: true };
  // Fuzzy stages only look at short lines: a map name is printed alone, long lines are menus or chat.
  const short = ls.map(squash).filter((l) => l.length >= 6 && l.length <= 48);
  for (const line of short) for (const m of catalog) for (const a of m.aliases) {
    const q = squash(a); if (q.length < 8 || STRICT.has(a)) continue;
    if (line.includes(q) && q.length > bestLen) { best = m; bestLen = q.length; }
  }
  let bestScore = 0;
  if (!best) for (const line of short) for (const m of catalog) for (const a of m.aliases) {
    const q = squash(a); if (q.length < 9 || STRICT.has(a)) continue;
    const score = windowScore(q, line);
    if (score >= 0.84 && score > bestScore) { best = m; bestScore = score; }
  }
  if (!best) {
    const realms = new Set();
    for (const m of catalog) { const r = squash(norm(REALM_NAMES[m.realm] || m.realm)); if (r.length >= 8 && short.some((l) => windowScore(r, l) >= 0.85)) realms.add(m.realm); }
    for (const line of short) for (const m of catalog) {
      if (!realms.has(m.realm)) continue;
      for (const a of m.aliases) { const q = squash(a); if (q.length < 6) continue; const score = windowScore(q, line); if (score >= 0.62 && score > bestScore) { best = m; bestScore = score; } }
    }
  }
  if (best) {
    const nums = new Set(ls.flatMap((l) => l.split(' ')).filter((t) => /^(i{1,3}|iv|v|[1-5])$/.test(t)));
    for (const v of variants(catalog, best)) { const sfx = norm(v.name).match(NUMERAL); if (sfx && nums.has(sfx[1])) return { map: v, exact: false }; }
    // No numeral read: a numbered family falls back to its first variant.
    if (norm(best.name).match(NUMERAL)) return { map: variants(catalog, best)[0], exact: false };
  }
  return best ? { map: best, exact: false } : null;
}
const matchMap = (lines, catalog) => { const d = matchDetail(lines, catalog); return d ? d.map : null; };

function isEndScreen(lines) {
  if (lines.some((l) => END_SCREEN.test(l))) return true;
  return lines.map((l) => squash(norm(l))).some((l) => l.length >= 8 && l.length <= 40 && windowScore('scoreboard', l) >= 0.7);
}

// Lock onto a map when its name is read. An exact name locks at once; a fuzzy read needs two scans in a row.
// A locked map is replaced when a different map is read at the start of the next trial. There is no
// end-of-match scanning: it needed a large, slow read every scan for the whole match.
const HOLD_MS = 60000; // after a lock, ignore other names for a minute (the same screen can still show text)
function createSession(catalog) {
  let candidate = null; let hits = 0; let lockedAt = -Infinity;
  return {
    reset() { candidate = null; hits = 0; },
    // `cur` = { id, locked }. Returns { lock: id } or null.
    onLines(lines, cur, now) {
      const d = matchDetail(lines, catalog);
      if (!d) { candidate = null; hits = 0; return null; }
      let m = d.map;
      // A detected base name keeps the variant picked earlier ("Coal Tower" keeps "Coal Tower II").
      const prev = catalog.find((x) => x.id === cur.id);
      if (prev && prev.family === m.family && m === variants(catalog, m)[0]) m = prev;
      if (cur.locked && (m.id === cur.id || now - lockedAt < HOLD_MS)) { candidate = null; hits = 0; return null; }
      hits = m === candidate ? hits + 1 : 1; candidate = m;
      if (hits < (d.exact ? 1 : CONFIRM_SCANS)) return null;
      lockedAt = now; candidate = null; hits = 0;
      return { lock: m.id };
    },
  };
}

// Crops applied before OCR, as fractions of the frame: [x, y, width, height].
// mapName: where the game prints the map and realm name at trial start (bottom left, during the intro pan).
const REGIONS = { mapName: [0.03, 0.79, 0.6, 0.12], full: [0, 0, 1, 1], bottomLeft: [0, 0.5, 0.5, 0.5], bottom: [0, 0.6, 1, 0.4], center: [0.2, 0.3, 0.6, 0.4] };
// Share of near-white pixels the map-name strip must have before the text reader is run at all.
// Measured on 26 real frames: readable map names gave 0.48% to 1.84%, end screens 0.00% to 0.07%.
const MIN_INK = 0.003;

// `grab(region, opts)` returns { png, ink } (ink = share of near-white pixels, only for white passes) or null.
// `winOcr` (optional) is tried first; Tesseract is the fallback and the only engine off Windows.
function createDetector({ cacheDir, grab, onLines, winOcr, engineChoice = () => 'auto', findsMap = () => false }) {
  let worker = null; let timer = null; let busy = false; let engine = ''; let skipped = 0;
  const within = (promise, ms, what) => Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' timed out')), ms))]);
  async function tesseract(png) {
    if (!worker) {
      const fs = require('node:fs'); const zlib = require('node:zlib');
      const { createWorker } = require('tesseract.js');
      const langDir = path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
      // Inside Electron tesseract.js tries to fetch the language file as a URL and fails. It reads its cache
      // folder first, so the bundled file is unpacked there once.
      const cached = path.join(cacheDir, 'eng.traineddata');
      if (!fs.existsSync(cached)) { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(cached, zlib.gunzipSync(fs.readFileSync(path.join(langDir, 'eng.traineddata.gz')))); }
      let failure = null;
      const created = createWorker('eng', 1, {
        langPath: langDir, cachePath: cacheDir, gzip: true,
        workerPath: path.join(path.dirname(require.resolve('tesseract.js/package.json')), 'src', 'worker-script', 'node', 'index.js'),
        errorHandler: (e) => { failure = e; },
      });
      try { worker = await within(created, 30000, 'OCR start'); } catch (err) { throw new Error(failure ? String(failure.message || failure) : err.message); }
    }
    const { data } = await within(worker.recognize(png), 20000, 'OCR');
    return data.text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  }
  async function recognize(png) {
    if (winOcr && winOcr.available && engineChoice() !== 'tesseract') {
      try { const lines = await winOcr.recognize(png); engine = 'Windows OCR'; return lines; } catch { /* fall through */ }
    }
    engine = 'Tesseract';
    return tesseract(png);
  }
  // 'auto' reads only the small strip where the map name is printed, and only when that strip holds
  // near-white pixels. A second, unfiltered read runs only if the first found text but no map.
  // Returns null when nothing was read (no text reader run).
  async function read(region) {
    if (region !== 'auto') { const g = await grab(REGIONS[region] || REGIONS.full, {}); return g ? recognize(g.png) : []; }
    const first = await grab(REGIONS.mapName, { scale: 2, white: true, minInk: MIN_INK });
    if (!first) return [];
    if (first.ink < MIN_INK) { skipped += 1; return null; }
    const lines = await recognize(first.png);
    if (findsMap(lines) || !lines.some((l) => l.replace(/[^A-Za-z]/g, '').length >= 6)) return lines;
    const second = await grab(REGIONS.mapName, { scale: 2 });
    return second ? [...lines, ...(await recognize(second.png))] : lines;
  }
  async function scan(region) {
    if (busy) return; busy = true;
    try { const lines = await read(region); if (lines) onLines(lines, null, engine); }
    catch (err) { onLines([], String(err.message || err), engine); } finally { busy = false; }
  }
  return {
    scan, recognize, read,
    get skipped() { return skipped; },
    start(region, ms = 2000) { this.stop(); timer = setInterval(() => scan(region), ms); },
    stop() { clearInterval(timer); timer = null; },
    async close() { this.stop(); if (winOcr) winOcr.close(); if (worker) await worker.terminate(); worker = null; },
  };
}

module.exports = { END_SCREEN, isEndScreen, buildCatalog, variants, matchMap, matchDetail, createSession, createDetector, norm, REGIONS, MIN_INK };
