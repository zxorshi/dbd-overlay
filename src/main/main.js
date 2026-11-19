// Main process: state store, overlay windows, global hotkeys, local server for overlays and OBS.
const { app, BrowserWindow, ipcMain, screen, clipboard, desktopCapturer, shell, Tray, Menu, nativeImage, dialog } = require('electron');
const { execFile } = require('node:child_process');
const leagues = require('./leagues');
const hooks = require('./hooks');
const calloutSite = require('./callouts');
const { createWinOcr } = require('./winocr');
const { prepare } = require('./prep');
const { createDetector, createSession, buildCatalog, matchMap, norm } = require('./detect');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { defaultState, dispatch, merge, derive, OVERLAY_IDS, STREAK_RULES, CHALLENGE_PRESETS, TIMER_PRESETS } = require('./tools');

const ROOT = path.join(__dirname, '..', '..');
const perks = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'perks.json'), 'utf8'));
const characters = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'characters.json'), 'utf8'));
let art = { perks: [], portraits: [] };
try { art = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'game', 'manifest.json'), 'utf8')); } catch { /* no art downloaded */ }
const catalog = buildCatalog(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'maps.json'), 'utf8')));
const maps = catalog.map(({ id, realm, name, family, image }) => ({ id, realm, name, family, image: Boolean(image) }));
const session = createSession(catalog);
let callouts = Object.create(null); // map id -> image file path
let calloutDir = '';
let detector = null;
const ICON = path.join(ROOT, 'assets', 'icon.png');
let tray = null; let quitting = false;
const PORT = Number(process.env.DBD_OVERLAY_PORT) || 47810;
let port = PORT; // the port actually bound; moves up if PORT is taken

// Plain-text log in the user data folder (log.txt), for bug reports. Start-up steps and errors only.
let logFile = '';
function log(...parts) {
  if (!logFile) return;
  try { fs.appendFileSync(logFile, new Date().toISOString() + ' ' + parts.map((x) => (x && x.stack) || String(x)).join(' ') + '\n'); } catch { /* logging must never break the app */ }
}
process.on('uncaughtException', (err) => { log('uncaught', err); });
process.on('unhandledRejection', (err) => { log('unhandled', err); });

let state = defaultState();
let mainWin = null;
const overlayWins = new Map();
const sseClients = new Set();
let saveTimer = null;
let stateFile = '';

function load() {
  stateFile = path.join(app.getPath('userData'), 'state.json');
  let raw = null;
  try { raw = fs.readFileSync(stateFile, 'utf8'); } catch { /* first run */ }
  if (raw !== null) {
    try {
      const saved = JSON.parse(raw);
      state = merge(defaultState(), saved);
      // A default key added by a newer version must not collide with a key the user already uses.
      const used = new Set(Object.values(saved.hotkeys || {}).filter(Boolean));
      for (const [a, k] of Object.entries(state.hotkeys)) if (k && !(a in (saved.hotkeys || {})) && used.has(k)) state.hotkeys[a] = '';
    } catch {
      // Unreadable file: keep it for recovery instead of overwriting it with defaults.
      try { fs.copyFileSync(stateFile, stateFile + '.broken-' + Date.now()); } catch { /* best effort */ }
    }
  }
  state.map.locked = false; state.map.download = ''; // a lock never outlives the session
  for (const o of Object.values(state.overlays)) o.locked = true; // edit mode never survives a restart: overlays start click-through
}
function writeNow() {
  clearTimeout(saveTimer); saveTimer = null;
  try { const tmp = stateFile + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(state)); fs.renameSync(tmp, stateFile); } catch { /* disk full or locked: keep running */ }
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, 300);
}

// ---- map callouts ----------------------------------------------------------
// Callout images are not shipped. They live in the user's callouts folder (or ./callouts next to the app),
// either at the catalog path (Realm/Map.webp) or as any image file named after the map.
function scanCallouts() {
  callouts = Object.create(null);
  // Packaged: a callouts folder beside the exe. From source: ./callouts in the project (git-ignored).
  // The chosen style's download folder wins, then the user's own files, then other styles.
  // A portable exe unpacks to a temp folder: PORTABLE_EXECUTABLE_DIR is where the exe itself sits.
  const beside = process.env.PORTABLE_EXECUTABLE_DIR || (app.isPackaged ? path.dirname(app.getPath('exe')) : ROOT);
  const roots = [path.join(calloutDir, 'hens-' + (state.map.style || 'classic')), calloutDir, path.join(beside, 'callouts'), path.join(process.resourcesPath || ROOT, 'callouts')];
  const byName = {};
  for (const m of catalog) { byName[norm(m.id)] = m.id; for (const a of m.aliases) byName[a] = byName[a] || m.id; }
  for (const root of roots) {
    for (const m of catalog) { if (!m.image) continue; const f = path.join(root, m.image); if (!callouts[m.id] && fs.existsSync(f)) callouts[m.id] = f; }
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
  try {
    const r = await calloutSite.download({ dir: calloutDir, style: state.map.style, catalog, onProgress: (n, total) => { state.map.download = `Downloading ${n} of ${total}`; broadcast(); } });
    state.map.download = r.failed ? `${r.failed} of ${r.total} images could not be downloaded` : `Done: ${r.saved} new images`;
  } catch (err) { state.map.download = 'Download failed: ' + (err.message || err); }
  downloading = false; scanCallouts(); broadcast();
}

async function grabScreen(region, opts) {
  const { size } = screen.getPrimaryDisplay();
  const width = Math.min(1920, size.width); const height = Math.round((width * size.height) / size.width);
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
  const primary = String(screen.getPrimaryDisplay().id);
  const src = sources.find((x) => x.display_id === primary) || sources[0];
  const img = src && src.thumbnail; if (!img || img.isEmpty()) return null;
  return prepare(img, region, opts);
}

// Is the game running? Process list only (tasklist); the game process itself is never opened.
let gameRunning = process.platform !== 'win32';
function checkGame() {
  if (process.platform !== 'win32') return;
  execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 4 << 20 }, (err, out) => {
    if (err) return; // a failed process listing says nothing about the game
    const running = /"deadbydaylight[^"]*shipping[^"]*\.exe"/i.test(out);
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
let scansLogged = 0;
function onLines(lines, error, engine) {
  if (scansLogged < 5) { scansLogged += 1; log('ocr read', engine, JSON.stringify(lines.join(' | ').slice(0, 160))); } // first reads only, for bug reports
  if (error && error !== state.map.lastError) log('ocr error', engine, error);
  state.map.engine = engine || '';
  state.map.lastText = lines.join(' | ').slice(0, 300); state.map.lastError = error || '';
  const ev = session.onLines(lines, { id: state.map.current, locked: state.map.locked }, Date.now());
  if (ev && ev.lock) { state.map.current = ev.lock; state.map.locked = true; }
  if (ev && ev.unlock) state.map.locked = false;
  broadcast(); if (ev) save();
}

// What overlay pages and OBS sources receive: no screen text, no roster, no match log.
function publicState() {
  return JSON.stringify({ ...state, map: { ...state.map, lastText: '', lastError: '' }, league: undefined, stats: undefined, rulesets: undefined, hotkeys: undefined, timer: { ...state.timer, log: undefined } });
}
function broadcast() {
  state.calloutIds = Object.keys(callouts);
  state.gameRunning = gameRunning;
  state.derived = derive(state, perks);
  const json = publicState();
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('state', state);
  for (const res of sseClients) res.write(`data: ${json}\n\n`);
}

function act(name, payload) {
  const ok = dispatch(state, name, payload, { now: Date.now(), perks, characters, catalog, random: Math.random });
  if (!ok) return;
  if (name.startsWith('hotkey.') || name === 'settings.set' || name === 'perks.remove') registerHotkeys();
  if (name.startsWith('map.')) session.reset();
  if (name === 'map.set' && payload && 'style' in payload) scanCallouts();
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
        webPreferences: { contextIsolation: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
      });
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.loadURL(`http://127.0.0.1:${port}/overlay/${id}?win=1`);
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
  win.setBounds({ x: Math.round(bounds.x + (bounds.width - size) / 2), y: Math.round(bounds.y + (bounds.height - size) / 2), width: size, height: size });
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
const lastPad = {}; let padSuspended = false;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
function serve() {
  const dir = path.join(ROOT, 'src', 'overlay');
  const server = http.createServer((req, res) => {
    // Local use only: refuse other hosts (DNS rebinding) and writes from web pages.
    const host = String(req.headers.host || '');
    const origin = req.headers.origin;
    const local = (h) => h === `127.0.0.1:${port}` || h === `localhost:${port}`;
    if (!local(host) || (req.method !== 'GET' && origin && !local(String(origin).replace(/^https?:\/\//, '')))) { res.writeHead(403); return res.end(); }
    let url; try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400); return res.end(); }
    if (url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      state.derived = derive(state, perks);
      res.write(`data: ${publicState()}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }
    if (url.pathname === '/data') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ perks, characters, art, maps }));
    }
    // Controller buttons: overlay windows poll the gamepad and report presses here.
    const pad = req.method === 'POST' && url.pathname.match(/^\/pad\/(\d{1,2})$/);
    if (pad) {
      const key = 'Pad' + Number(pad[1]); const now = Date.now();
      if (!padSuspended && now - (lastPad[key] || 0) > 150) { // several overlay windows report the same press
        lastPad[key] = now;
        for (const [action, b] of Object.entries(state.hotkeys)) if (b === key) runHotkey(action);
      }
      res.writeHead(204); return res.end();
    }
    // Edit-mode controls on the overlay itself: resize, and Done to lock it again.
    const ed = req.method === 'POST' && url.pathname.match(/^\/edit\/([A-Za-z]+)$/);
    if (ed) {
      let body = ''; req.on('data', (c) => { if (body.length < 200) body += c; });
      req.on('end', () => {
        try {
          const d = JSON.parse(body); const o = state.overlays[ed[1]];
          if (o && !o.locked) {
            if (d.done) act('overlay.set', { id: ed[1], locked: true });
            else if (Number.isFinite(d.scale)) act('overlay.set', { id: ed[1], scale: Math.round(Math.min(2.5, Math.max(0.5, d.scale)) * 100) / 100 });
          }
        } catch { /* ignore malformed requests */ }
        res.writeHead(204); res.end();
      });
      return;
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
      if (typeof file !== 'string') { res.writeHead(404); return res.end(); }
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
  // If the port is taken, try the next ones. The UI and overlay windows use whichever port was bound.
  return new Promise((resolve, reject) => {
    let tries = 0;
    server.on('error', (err) => { if (err.code === 'EADDRINUSE' && tries++ < 20) { port += 1; server.listen(port, '127.0.0.1'); } else reject(err); });
    server.on('listening', resolve);
    server.listen(port, '127.0.0.1');
  });
}

// ---- app -------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => { if (mainWin) { mainWin.show(); if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); } });

app.whenReady().then(async () => {
  if (!gotLock) return;
  logFile = path.join(app.getPath('userData'), 'log.txt');
  try { if (fs.existsSync(logFile) && fs.statSync(logFile).size > 512000) fs.unlinkSync(logFile); } catch { /* keep going */ }
  log('start', app.getVersion(), process.platform, 'packaged=' + app.isPackaged);
  load(); log('state loaded');
  calloutDir = path.join(app.getPath('userData'), 'callouts');
  fs.mkdirSync(calloutDir, { recursive: true });
  scanCallouts();
  detector = createDetector({ cacheDir: app.getPath('userData'), grab: grabScreen, onLines, winOcr: createWinOcr(app.getPath('temp')), engineChoice: () => state.settings.ocrEngine,
    isLocked: () => state.map.locked, findsMap: (lines) => Boolean(matchMap(lines, catalog)) });
  log('callouts', Object.keys(callouts).length);
  try { await serve(); log('server on', port); } catch (err) { log('server failed', err); dialog.showErrorBox('DBD Overlay', 'Could not start the local overlay server: ' + err.message); app.quit(); return; }
  ipcMain.handle('init', () => ({ state: Object.assign(state, { derived: derive(state, perks), calloutIds: Object.keys(callouts) }), platform: process.platform, presets: CHALLENGE_PRESETS, timerPresets: TIMER_PRESETS, maps, calloutDir, perks, characters, art, port, rules: STREAK_RULES, overlayIds: OVERLAY_IDS }));
  ipcMain.on('action', (_e, name, payload) => act(name, payload));
  ipcMain.on('callouts', (_e, what) => { if (what === 'open') shell.openPath(calloutDir); else if (what === 'download') downloadCallouts(); else { scanCallouts(); broadcast(); } });
  ipcMain.on('detect', () => detector.scan(state.map.region));
  ipcMain.handle('leagues.list', async () => { try { return { list: await leagues.listPresets() }; } catch (e) { return { error: String(e.message || e) }; } });
  ipcMain.handle('leagues.import', async (_e, presetPath) => {
    try { act('rules.addImported', { ruleset: await leagues.importPreset(String(presetPath), perks, characters) }); return {}; } catch (e) { return { error: String(e.message || e) }; }
  });
  ipcMain.handle('restore', (_e, json) => {
    try {
      const d = JSON.parse(String(json)); if (!d || typeof d !== 'object' || !d.overlays || !d.timer) throw new Error('This is not a DBD Overlay backup');
      for (const k of ['derived', 'calloutIds', 'gameRunning', 'hotkeysFailed', 'passthroughAvailable']) delete d[k];
      state = merge(defaultState(), d); registerHotkeys(); syncOverlayWindows(); syncDetector(); broadcast(); save(); return {};
    } catch (e) { return { error: String(e.message || e) }; }
  });
  ipcMain.on('hotkeys.suspend', (_e, on) => { padSuspended = Boolean(on); if (on) hooks.stop(); else registerHotkeys(); });
  // Snap an overlay to a screen corner or edge of the primary display.
  ipcMain.on('overlay.snap', (_e, id, where) => {
    const o = state.overlays[id]; if (!o) return;
    const wa = screen.getPrimaryDisplay().workArea; const win = overlayWins.get(id);
    const b = win && !win.isDestroyed() ? win.getBounds() : { width: o.w, height: o.h };
    const pad = 16; const [v, h] = String(where).split('-');
    o.x = Math.round(h === 'left' ? wa.x + pad : h === 'right' ? wa.x + wa.width - b.width - pad : wa.x + (wa.width - b.width) / 2);
    o.y = Math.round(v === 'top' ? wa.y + pad : v === 'bottom' ? wa.y + wa.height - b.height - pad : wa.y + (wa.height - b.height) / 2);
    if (win && !win.isDestroyed()) win.setBounds({ x: o.x, y: o.y, width: b.width, height: b.height });
    save();
  });
  ipcMain.on('copy', (_e, text) => clipboard.writeText(String(text)));

  mainWin = new BrowserWindow({
    width: 1120, height: 720, minWidth: 820, minHeight: 520, backgroundColor: '#141a16', autoHideMenuBar: true, icon: ICON,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true },
  });
  mainWin.loadFile(path.join(ROOT, 'src', 'ui', 'index.html'));
  mainWin.on('close', (e) => { if (state.settings.closeToTray && tray && !quitting) { e.preventDefault(); mainWin.hide(); } });
  // Capture mode suspends hotkeys; never leave them suspended once the window is out of use.
  mainWin.on('blur', () => { padSuspended = false; registerHotkeys(); }); mainWin.on('hide', () => { padSuspended = false; registerHotkeys(); });
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
  registerHotkeys(); log('hotkeys', state.settings.inputMode, 'failed=' + (state.hotkeysFailed || []).join(','));
  syncOverlayWindows();
  checkGame(); setInterval(checkGame, 5000);
  syncDetector(); log('ready');
});
app.on('before-quit', () => { quitting = true; if (stateFile) writeNow(); });
app.on('will-quit', () => { hooks.shutdown(); if (detector) detector.close(); });
app.on('window-all-closed', () => app.quit());
