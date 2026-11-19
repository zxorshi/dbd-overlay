// Runs every image in a folder through the app's OCR path and prints what map (or end screen) is detected.
// Usage: npx electron scripts/ocr-eval.js <folder> [region] [scale]
const { app, nativeImage } = require('electron');
const fs = require('node:fs'); const path = require('node:path');
const { prepare } = require('../src/main/prep');
const { createDetector, buildCatalog, matchMap, REGIONS, isEndScreen } = require('../src/main/detect');
const catalog = buildCatalog(require('../data/maps.json'));
const [dir, region = 'auto'] = process.argv.slice(process.argv.findIndex((a) => a.endsWith('ocr-eval.js')) + 1);
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  let frame = null; let locked = false;
  const det = createDetector({ cacheDir: app.getPath('temp'), grab: async (r, o) => prepare(frame, r, o), onLines() {}, findsMap: (l) => Boolean(matchMap(l, catalog)) });
  let hits = 0; let n = 0;
  for (const f of fs.readdirSync(dir).sort()) {
    frame = nativeImage.createFromPath(path.join(dir, f));
    if (frame.isEmpty()) { console.log(f, 'UNREADABLE'); continue; }
    const W = Number(process.env.EVAL_WIDTH) || 1600; if (frame.getSize().width > W) frame = frame.resize({ width: W, quality: 'best' }); // the app captures at 1920 wide at most
    locked = f.startsWith('c'); // c* files are end screens: read them the way a locked session does
    const t0 = Date.now();
    const read = await det.read(f.startsWith('a') ? region : region); const lines = read || [];
    const m = matchMap(lines, catalog); const end = isEndScreen(lines);
    n += 1; if (m || end) hits += 1;
    console.log(`${f} ${Date.now() - t0}ms${read ? '' : ' (skipped: no white text)'} => ${m ? m.name : '-'}${end ? ' [END SCREEN]' : ''} | ${lines.join(' / ').slice(0, 110)}`);
  }
  console.log(`detected ${hits} of ${n}`);
  await det.close(); app.exit(0);
});
