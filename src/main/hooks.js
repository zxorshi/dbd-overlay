// Global input in two modes.
//  standard:    Electron globalShortcut. The key is consumed and does not reach the game. Keyboard only.
//  passthrough: low-level hook (uiohook-napi). The key still reaches the game; mouse buttons can be bound.
//               On some systems the game's anti-cheat only lets hooks see input when this app runs as administrator.
// A binding is a string such as "F1", "Ctrl+Shift+T", "num1", "Mouse4".
const { globalShortcut } = require('electron');

let uio = null;
try { uio = require('uiohook-napi'); } catch { /* optional: passthrough mode is unavailable */ }

// KeyboardEvent.code -> binding token (also valid Electron accelerator key names).
function tokenFromCode(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code;
  if (/^Numpad\d$/.test(code)) return 'num' + code.slice(6);
  const map = { Space: 'Space', Tab: 'Tab', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec', CapsLock: 'Capslock' };
  return map[code] || null;
}
// binding token -> uiohook key name
function uioName(token) {
  if (/^[A-Z]$/.test(token) || /^\d$/.test(token) || /^F\d{1,2}$/.test(token)) return token;
  if (/^num\d$/.test(token)) return 'Numpad' + token.slice(3);
  const map = { Space: 'Space', Tab: 'Tab', '`': 'Backquote', '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', ';': 'Semicolon', "'": 'Quote', ',': 'Comma', '.': 'Period', '/': 'Slash', Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight', numadd: 'NumpadAdd', numsub: 'NumpadSubtract', nummult: 'NumpadMultiply', numdiv: 'NumpadDivide', numdec: 'NumpadDecimal', Capslock: 'CapsLock' };
  return map[token] || null;
}
function parse(binding) {
  const parts = String(binding).split('+').map((p) => p.trim()).filter(Boolean);
  const key = parts.pop() || '';
  const mods = new Set(parts.map((p) => p.toLowerCase().replace('control', 'ctrl')));
  return { key, ctrl: mods.has('ctrl'), alt: mods.has('alt'), shift: mods.has('shift') };
}
const isMouse = (binding) => /(^|\+)Mouse[3-5]$/.test(binding);

let listeners = null;
function stopHook() {
  if (uio && listeners) { uio.uIOhook.off('keydown', listeners.key); uio.uIOhook.off('keyup', listeners.up); uio.uIOhook.off('mousedown', listeners.mouse); try { uio.uIOhook.stop(); } catch { /* not running */ } }
  listeners = null;
}

// bindings: { action: binding }. Returns the actions whose binding could not be registered.
function apply(bindings, mode, onAction) {
  globalShortcut.unregisterAll(); stopHook();
  const failed = []; const entries = Object.entries(bindings).filter(([, b]) => b);
  if (mode === 'passthrough' && uio) {
    const table = entries.map(([action, b]) => { const p = parse(b); const code = isMouse(b) ? Number(p.key.slice(5)) : uio.UiohookKey[uioName(p.key)]; if (code === undefined) failed.push(action); return { action, ...p, code, mouse: isMouse(b) }; });
    const down = new Set(); // held keys: the OS repeats keydown while a key is held, the action must fire once
    const fire = (e, mouse, code) => { for (const t of table) if (t.mouse === mouse && t.code === code && t.ctrl === Boolean(e.ctrlKey) && t.alt === Boolean(e.altKey) && t.shift === Boolean(e.shiftKey)) onAction(t.action); };
    listeners = { key: (e) => { if (down.has(e.keycode)) return; down.add(e.keycode); fire(e, false, e.keycode); }, up: (e) => down.delete(e.keycode), mouse: (e) => fire(e, true, e.button) };
    uio.uIOhook.on('keydown', listeners.key); uio.uIOhook.on('keyup', listeners.up); uio.uIOhook.on('mousedown', listeners.mouse);
    try { uio.uIOhook.start(); } catch { return entries.map(([a]) => a); }
    return failed;
  }
  for (const [action, b] of entries) {
    if (isMouse(b)) { failed.push(action); continue; } // mouse buttons need passthrough mode
    try { if (!globalShortcut.register(b, () => onAction(action))) failed.push(action); } catch { failed.push(action); }
  }
  return failed;
}

module.exports = { apply, stop: () => { globalShortcut.unregisterAll(); stopHook(); }, tokenFromCode, parse, passthroughAvailable: Boolean(uio) };
