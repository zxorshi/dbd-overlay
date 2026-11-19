// Runs every image in a folder through the app's OCR path and prints what map (or end screen) is detected.
// Usage: npx electron scripts/ocr-eval.js <folder> [region] [scale]
const { app, nativeImage } = require('electron');
const fs = require('node:fs'); const path = require('node:path');
const { prepare } = require('../src/main/prep');
const { createDetector, buildCatalog, matchMap, REGIONS } = require('../src/main/detect');
const catalog = buildCatalog(require('../data/maps.json'));
const [dir, region = 'full', scale = '1'] = process.argv.slice(process.argv.findIndex((a) => a.endsWith('ocr-eval.js')) + 1);
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const det = createDetector({ cacheDir: app.getPath('temp'), grab: async () => null, onLines() {} });
  for (const f of fs.readdirSync(dir).sort()) {
    const img = nativeImage.createFromPath(path.join(dir, f));
    if (img.isEmpty()) { console.log(f, 'UNREADABLE'); continue; }
    const t0 = Date.now();
    const lines = await det.recognize(prepare(img, REGIONS[region], { scale: Number(scale) }));
    const m = matchMap(lines, catalog); const end = lines.some((l) => /^\s*(continue|scoreboard|match\s*result)\s*$/i.test(l));
    console.log(`${f} ${img.getSize().width}x${img.getSize().height} ${Date.now() - t0}ms => ${m ? m.name : '-'}${end ? ' [END SCREEN]' : ''} | ${lines.join(' / ').slice(0, 200)}`);
  }
  await det.close(); app.exit(0);
});
