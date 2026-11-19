// Main process: state store, overlay windows, global hotkeys, local server for overlays and OBS.
const { app, BrowserWindow, ipcMain, globalShortcut, screen, clipboard, desktopCapturer, shell, Tray, Menu, nativeImage } = require('electron');
const { execFile } = require('node:child_process');
const leagues = require('./leagues');
const hooks = require('./hooks');
const { createDetector, createSession, buildCatalog, norm } = require('./detect');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { defaultState, dispatch, merge, derive, OVERLAY_IDS, STREAK_RULES, CHALLENGE_PRESETS } = require('./tools');

const ROOT = path.join(__dirname, '..', '..');
const perks = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'perks.json'), 'utf8'));
const characters = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'characters.json'), 'utf8'));
let art = { perks: [], portraits: [] };
try { art = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'game', 'manifest.json'), 'utf8')); } catch { /* no art downloaded */ }
const catalog = buildCatalog(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'maps.json'), 'utf8')));
const maps = catalog.map(({ id, realm, name, family }) => ({ id, realm, name, family }));
const session = createSession(catalog);
let callouts = {}; // map id -> image file path
let calloutDir = '';
let detector = null;
const ICON = path.join(ROOT, 'assets', 'icon.png');
let tray = null; let quitting = false;
const PORT = Number(process.env.DBD_OVERLAY_PORT) || 47810;

let state = defaultState();
let mainWin = null;
const overlayWins = new Map();
const sseClients = new Set();
let saveTimer = null;
let stateFile = '';

function load() {
  stateFile = path.join(app.getPath('userData'), 'state.json');
  try { state = merge(defaultState(), JSON.parse(fs.readFileSync(stateFile, 'utf8'))); } catch { /* first run */ }
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(stateFile, JSON.stringify(state), () => {}), 300);
}

// ---- map callouts ----------------------------------------------------------
// Callout images are not shipped. They live in the user's callouts folder (or ./callouts next to the app),
// either at the catalog path (Realm/Map.webp) or as any image file named after the map.
const IMAGE_BASE_URL = 'https://hens333.com/img/dbd/callouts/';
function scanCallouts() {
  callouts = {};
  const roots = [calloutDir, path.join(ROOT, 'callouts')];
  const byName = {};
  for (const m of catalog) for (const a of m.aliases) byName[a] = byName[a] || m.id;
  for (const root of roots) {
    for (const m of catalog) { const f = path.join(root, m.image); if (!callouts[m.id] && fs.existsSync(f)) callouts[m.id] = f; }
    const visit = (dir, depth) => {
      let entries = []; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory() && depth < 2) visit(full, depth + 1);
        else if (/\.(png|jpe?g|webp|gif)$/i.test(e.name)) { const id = byName[norm(e.name.replace(/\.[^.]+$/, ''))]; if (id && !callouts[id]) callouts[id] = full; }
      }
    };
    visit(root, 0);
  }
}
let downloading = false;
async function downloadCallouts() {
  if (downloading) return; downloading = true;
  const missing = catalog.filter((m) => !callouts[m.id]); let done = 0; let failed = 0;
  for (const m of missing) {
    state.map.download = `Downloading ${done + 1} of ${missing.length}`; broadcast();
    try {
      const res = await fetch(IMAGE_BASE_URL + m.image.split('/').map(encodeURIComponent).join('/'));
      if (!res.ok) throw new Error(String(res.status));
      const file = path.join(calloutDir, m.image);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    } catch { failed += 1; }
    done += 1;
  }
  downloading = false; scanCallouts();
  state.map.download = failed ? `${failed} of ${missing.length} images could not be downloaded` : '';
  broadcast();
}

async function grabScreen([x, y, w, h]) {
  const { size } = screen.getPrimaryDisplay();
  const width = Math.min(1920, size.width); const height = Math.round((width * size.height) / size.width);
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
  const img = sources[0] && sources[0].thumbnail; if (!img || img.isEmpty()) return null;
  const s = img.getSize();
  return img.crop({ x: Math.round(x * s.width), y: Math.round(y * s.height), width: Math.round(w * s.width), height: Math.round(h * s.height) }).toPNG();
}

// Is the game running? Process list only (tasklist); the game process itself is never opened.
let gameRunning = process.platform !== 'win32';
function checkGame() {
  if (process.platform !== 'win32') return;
  execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 4 << 20 }, (err, out) => {
    const running = !err && /"deadbydaylight[^"]*shipping[^"]*\.exe"/i.test(out);
    if (running === gameRunning) return;
    gameRunning = running;
    if (!running && state.map.locked) { state.map.locked = false; session.reset(); }
    syncDetector(); broadcast();
  });
}
function syncDetector() {
  if (!detector) return;
  const on = state.map.auto && (gameRunning || !state.settings.onlyWhenGameRuns);
  if (on) detector.start(state.map.region, state.settings.scanSeconds * 1000); else detector.stop();
  // The app window lists every map name; keep it out of screen capture so it is never read as the game's map.
  if (mainWin && !mainWin.isDestroyed()) mainWin.setContentProtection(Boolean(state.map.auto));
}
function onLines(lines, error) {
  state.map.lastText = lines.join(' | ').slice(0, 300); state.map.lastError = error || '';
  const ev = session.onLines(lines, { id: state.map.current, locked: state.map.locked }, Date.now());
  if (ev && ev.lock) { state.map.current = ev.lock; state.map.locked = true; }
  if (ev && ev.unlock) state.map.locked = false;
  broadcast(); if (ev) save();
}

function broadcast() {
  state.calloutIds = Object.keys(callouts);
  state.gameRunning = gameRunning;
  state.derived = derive(state, perks);
  const json = JSON.stringify(state);
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('state', state);
  for (const res of sseClients) res.write(`data: ${json}\n\n`);
}

function act(name, payload) {
  const ok = dispatch(state, name, payload, { now: Date.now(), perks, characters, catalog, random: Math.random });
  if (!ok) return;
  if (name.startsWith('hotkey.') || name === 'settings.set' || name === 'perks.remove') registerHotkeys();
  if (name.startsWith('map.')) session.reset();
  if (name.startsWith('map.') || name === 'settings.set') syncDetector();
  syncOverlayWindows();
  broadcast();
  save();
}

// ---- overlay windows -------------------------------------------------------
function syncOverlayWindows() {
  for (const id of OVERLAY_IDS) {
    const o = state.overlays[id];
    let win = overlayWins.get(id);
    if (!o.open) { if (win) { win.destroy(); overlayWins.delete(id); } continue; }
    if (!win) {
      win = new BrowserWindow({
        x: o.x, y: o.y, width: o.w, height: o.h, show: false,
        frame: false, transparent: true, resizable: false, skipTaskbar: true, hasShadow: false,
        alwaysOnTop: true, focusable: false, fullscreenable: false, minWidth: 60, minHeight: 40,
        webPreferences: { contextIsolation: true },
      });
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.loadURL(`http://127.0.0.1:${PORT}/overlay/${id}?win=1`);
      const keep = () => {
        if (win.isDestroyed()) return;
        const b = win.getBounds();
        Object.assign(state.overlays[id], { x: b.x, y: b.y, w: b.width, h: b.height });
        save();
      };
      win.on('moved', keep); win.on('resized', keep);
      win.on('closed', () => overlayWins.delete(id));
      overlayWins.set(id, win);
      if (id === 'crosshair') centerCrosshair(win);
    }
    // The crosshair never takes mouse input. Other overlays take it only while unlocked.
    win.setIgnoreMouseEvents(id === 'crosshair' || o.locked);
    win.setOpacity(o.opacity);
    win.setContentProtection(Boolean(state.settings.hideFromCapture));
    if (state.settings.overlaysHidden) win.hide(); else if (!win.isVisible()) win.showInactive();
  }
}
function centerCrosshair(win) {
  const { bounds } = screen.getPrimaryDisplay();
  const size = 400;
  win.setBounds({ x: bounds.x + (bounds.width - size) / 2, y: bounds.y + (bounds.height - size) / 2, width: size, height: size });
}

// ---- hotkeys ---------------------------------------------------------------
// An action name may carry one argument after a colon: "perks.fire:ds", "score.hook:2".
function runHotkey(action) {
  const [name, arg] = action.split(':');
  act(name, arg === undefined ? undefined : { id: arg, i: Number(arg) });
}
function registerHotkeys() {
  state.hotkeysFailed = hooks.apply(state.hotkeys, state.settings.inputMode, runHotkey);
  state.passthroughAvailable = hooks.passthroughAvailable;
}

// ---- local server (overlay pages + live state) -----------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
function serve() {
  const dir = path.join(ROOT, 'src', 'overlay');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      state.derived = derive(state, perks);
      res.write(`data: ${JSON.stringify(state)}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }
    if (url.pathname === '/data') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ perks, characters, art, maps }));
    }
    const sz = req.method === 'POST' && url.pathname.match(/^\/size\/([A-Za-z]+)$/);
    if (sz) {
      let body = ''; req.on('data', (c) => { if (body.length < 200) body += c; });
      req.on('end', () => {
        try {
          const { w, h } = JSON.parse(body); const win = overlayWins.get(sz[1]);
          if (win && !win.isDestroyed() && w > 0 && h > 0 && w < 4000 && h < 4000) {
            const b = win.getBounds(); const nw = Math.round(w) + 28; const nh = Math.round(h) + 28;
            if (b.width !== nw || b.height !== nh) win.setBounds({ x: b.x, y: b.y, width: nw, height: nh });
          }
        } catch { /* ignore malformed size reports */ }
        res.writeHead(204); res.end();
      });
      return;
    }
    const co = url.pathname.match(/^\/callout\/([A-Za-z0-9_]+)$/);
    if (co) {
      const file = callouts[co[1]];
      if (!file) { res.writeHead(404); return res.end(); }
      return fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); return res.end(); }
        const ext = path.extname(file).toLowerCase();
        res.writeHead(200, { 'Content-Type': ext === '.webp' ? 'image/webp' : ext === '.png' ? 'image/png' : 'image/jpeg', 'Cache-Control': 'no-store' }); res.end(buf);
      });
    }
    const m = url.pathname.match(/^\/art\/(perks|portraits)\/([A-Za-z0-9_]+)\.png$/);
    if (m) {
      return fs.readFile(path.join(ROOT, 'assets', 'game', m[1], m[2] + '.png'), (err, buf) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' }); res.end(buf);
      });
    }
    const file = url.pathname.startsWith('/overlay/') ? 'overlay.html' : path.basename(url.pathname);
    fs.readFile(path.join(dir, file), (err, buf) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain', 'Cache-Control': 'no-store' });
      res.end(buf);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', resolve); });
}

// ---- app -------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); } });

app.whenReady().then(async () => {
  load();
  calloutDir = path.join(app.getPath('userData'), 'callouts');
  fs.mkdirSync(calloutDir, { recursive: true });
  scanCallouts();
  detector = createDetector({ cacheDir: app.getPath('userData'), grab: grabScreen, onLines });
  state.map.download = '';
  await serve();
  ipcMain.handle('init', () => ({ state: Object.assign(state, { derived: derive(state, perks), calloutIds: Object.keys(callouts) }), presets: CHALLENGE_PRESETS, maps, calloutDir, perks, characters, art, port: PORT, rules: STREAK_RULES, overlayIds: OVERLAY_IDS }));
  ipcMain.on('action', (_e, name, payload) => act(name, payload));
  ipcMain.on('callouts', (_e, what) => { if (what === 'open') shell.openPath(calloutDir); else if (what === 'download') downloadCallouts(); else { scanCallouts(); broadcast(); } });
  ipcMain.on('detect', () => detector.scan(state.map.region));
  ipcMain.handle('leagues.list', async () => { try { return { list: await leagues.listPresets() }; } catch (e) { return { error: String(e.message || e) }; } });
  ipcMain.handle('leagues.import', async (_e, presetPath) => {
    try { act('rules.addImported', { ruleset: await leagues.importPreset(String(presetPath), perks, characters) }); return {}; } catch (e) { return { error: String(e.message || e) }; }
  });
  ipcMain.on('copy', (_e, text) => clipboard.writeText(String(text)));

  mainWin = new BrowserWindow({
    width: 1120, height: 720, minWidth: 820, minHeight: 520, backgroundColor: '#141a16', autoHideMenuBar: true, icon: ICON,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true },
  });
  mainWin.loadFile(path.join(ROOT, 'src', 'ui', 'index.html'));
  mainWin.on('close', (e) => { if (state.settings.closeToTray && !quitting) { e.preventDefault(); mainWin.hide(); } });
  mainWin.on('closed', () => app.quit());
  try {
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
    tray.setToolTip('DBD Overlay');
    const showMain = () => { mainWin.show(); mainWin.focus(); };
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open DBD Overlay', click: showMain },
      { label: 'Show / hide all overlays', click: () => act('overlays.toggleAll') },
      { label: 'Lock / unlock all overlays', click: () => act('overlays.toggleLock') },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('click', showMain);
  } catch { /* no tray on this desktop */ }
  registerHotkeys();
  syncOverlayWindows();
  checkGame(); setInterval(checkGame, 5000);
  syncDetector();
});
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => hooks.stop());
app.on('window-all-closed', () => app.quit());
