// Launches the app, opens every tool and its overlay window, and reports page errors.
// Needs Playwright (not a project dependency): node scripts/smoke.js <output-folder>
const { _electron } = require('playwright');
const fs = require('node:fs'); const path = require('node:path');
const out = process.argv[2] || 'smoke-out'; const root = path.join(__dirname, '..');
(async () => {
  fs.rmSync(path.join(out, 'profile'), { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
  const app = await _electron.launch({ executablePath: require(path.join(root, 'node_modules', 'electron')), args: [root, '--no-sandbox', '--user-data-dir=' + path.resolve(out, 'profile')], cwd: root });
  const errs = [];
  app.process().stderr.on('data', (d) => { const t = String(d); if (/TypeError|ReferenceError|Unhandled|SyntaxError/.test(t)) errs.push('MAIN ' + t.slice(0, 400)); });
  const win = await app.firstWindow();
  win.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); win.on('pageerror', (e) => errs.push(String(e)));
  await win.setViewportSize({ width: 1280, height: 900 }); await win.waitForSelector('h1');

  const tools = await win.$$eval('[data-tool]:not([disabled])', (n) => n.map((x) => x.dataset.tool));
  const sizes = {};
  for (const t of tools) {
    await win.click(`[data-tool="${t}"]`); await win.waitForTimeout(250);
    const toggle = await win.$('[data-act="overlay.toggle"]');
    if (toggle) {
      await toggle.click(); await win.waitForTimeout(900);
      sizes[t] = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.webContents.getURL().startsWith('file')).map((w) => w.getBounds().width + 'x' + w.getBounds().height).pop());
      await win.click('[data-act="overlay.toggle"]'); await win.waitForTimeout(150);
    }
    await win.screenshot({ path: path.join(out, t + '.png') });
  }
  console.log('tools', tools.length, 'overlay window sizes', JSON.stringify(sizes));
  console.log('errors', JSON.stringify(errs));
  await app.close(); process.exit(errs.length ? 1 : 0);
})().catch((e) => { console.error('FAIL', String(e).slice(0, 600)); process.exit(1); });
