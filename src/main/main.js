// Main process: state store, overlay windows, global hotkeys, local server for overlays and OBS.
const { app, BrowserWindow, ipcMain, globalShortcut, screen, clipboard } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { defaultState, dispatch, merge, derive, OVERLAY_IDS, STREAK_RULES, CHALLENGE_PRESETS } = require('./tools');

const ROOT = path.join(__dirname, '..', '..');
const perks = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'perks.json'), 'utf8'));
const characters = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'characters.json'), 'utf8'));
let art = { perks: [], portraits: [] };
try { art = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'game', 'manifest.json'), 'utf8')); } catch { /* no art downloaded */ }
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

function broadcast() {
  state.derived = derive(state, perks);
  const json = JSON.stringify(state);
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('state', state);
  for (const res of sseClients) res.write(`data: ${json}\n\n`);
}

function act(name, payload) {
  const ok = dispatch(state, name, payload, { now: Date.now(), perks, characters, random: Math.random });
  if (!ok) return;
  if (name.startsWith('hotkey.')) registerHotkeys();
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
        x: o.x, y: o.y, width: o.w, height: o.h,
        frame: false, transparent: true, resizable: true, skipTaskbar: true, hasShadow: false,
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
  }
}
function centerCrosshair(win) {
  const { bounds } = screen.getPrimaryDisplay();
  const size = 400;
  win.setBounds({ x: bounds.x + (bounds.width - size) / 2, y: bounds.y + (bounds.height - size) / 2, width: size, height: size });
}

// ---- hotkeys ---------------------------------------------------------------
function registerHotkeys() {
  globalShortcut.unregisterAll();
  const failed = [];
  for (const [action, key] of Object.entries(state.hotkeys)) {
    if (!key) continue;
    try { if (!globalShortcut.register(key, () => act(action))) failed.push(key); } catch { failed.push(key); }
  }
  state.hotkeysFailed = failed;
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
      return res.end(JSON.stringify({ perks, characters, art }));
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
app.whenReady().then(async () => {
  load();
  await serve();
  ipcMain.handle('init', () => ({ state: Object.assign(state, { derived: derive(state, perks) }), presets: CHALLENGE_PRESETS, perks, characters, art, port: PORT, rules: STREAK_RULES, overlayIds: OVERLAY_IDS }));
  ipcMain.on('action', (_e, name, payload) => act(name, payload));
  ipcMain.on('copy', (_e, text) => clipboard.writeText(String(text)));

  mainWin = new BrowserWindow({
    width: 1120, height: 720, minWidth: 820, minHeight: 520, backgroundColor: '#141a16', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true },
  });
  mainWin.loadFile(path.join(ROOT, 'src', 'ui', 'index.html'));
  mainWin.on('closed', () => app.quit());
  registerHotkeys();
  syncOverlayWindows();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
