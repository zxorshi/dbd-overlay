// Main window. Renders the active tool from state; sends actions to the main process.
const TOOLS = [
  { g: 'Home', id: 'home', name: 'Overlays' },
  { g: 'Play', id: 'timer', name: '1v1 Timer' },
  { g: 'Play', id: 'crosshair', name: 'Crosshair' },
  { g: 'Play', id: 'perks', name: 'Perk Timers' },
  { g: 'Play', id: 'streak', name: 'Streak Counter' },
  { g: 'Play', id: 'perkShuffle', name: 'Perk Shuffle' },
  { g: 'Play', id: 'killerShuffle', name: 'Killer Shuffle' },
  { g: 'Compete', id: 'map', name: 'Map Callouts' },
  { g: 'Compete', id: 'builds', name: 'Build Library' },
  { g: 'Compete', id: 'score', name: 'Match Scoreboard' },
  { g: 'Compete', id: 'lobby', name: 'Lobby Perks' },
  { g: 'Compete', id: 'stats', name: 'Statistics' },
  { g: 'Compete', id: 'challenge', name: 'Challenges' },
  { g: 'Online', id: 'league', name: 'My League' },
  { g: 'Online', id: 'party', name: 'Party', soon: true },
  { g: 'App', id: 'settings', name: 'Settings' },
];
const HOTKEY_LABELS = {
  'timer.toggle': 'Timer: start / stop', 'timer.switch': 'Timer: switch player', 'timer.reset': 'Timer: reset', 'timer.scoreRound': 'Timer: score round',
  'perks.fireAll': 'Perk timers: fire all armed', 'streak.win': 'Streak: win', 'streak.loss': 'Streak: loss',
  'perkShuffle.roll': 'Perk shuffle: roll', 'killerShuffle.roll': 'Killer shuffle: roll', 'overlays.toggleLock': 'Overlays: lock / unlock all',
  'overlays.toggleAll': 'Overlays: show / hide all', 'timer.cycle': 'Timer: start, stop, reset in turn', 'timer.select:0': 'Timer: select player 1', 'timer.select:1': 'Timer: select player 2', 'timer.penalty': 'Timer: penalty', 'perks.clear': 'Perk timers: clear',
  'score.hook:0': 'Scoreboard: hook survivor 1', 'score.hook:1': 'Scoreboard: hook survivor 2', 'score.hook:2': 'Scoreboard: hook survivor 3', 'score.hook:3': 'Scoreboard: hook survivor 4', 'score.bump:gen': 'Scoreboard: generator done', 'map.nextVariant': 'Map: next variant', 'map.toggleLock': 'Map: lock / unlock',
};

let S = null; let D = null; let cur = 'home';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const A = (name, payload) => `data-act="${name}" data-p='${esc(JSON.stringify(payload || {}))}'`;
const B = (action, field, extra) => `data-set="${action}" data-field="${field}" data-p='${esc(JSON.stringify(extra || {}))}'`;
const fmt = (ms) => { const s = Math.abs(ms) / 1000; return (ms < 0 ? '-' : '') + Math.floor(s / 60) + ':' + (s % 60).toFixed(1).padStart(4, '0'); };
const slotMs = (x) => x.base + (x.startedAt ? Date.now() - x.startedAt : 0);
const key = (action) => (S.hotkeys[action] ? `<kbd>${esc(S.hotkeys[action])}</kbd>` : '');
const art = (kind, id, cls) => (id && D.art[kind].includes(id) ? `<img class="${cls}" src="http://127.0.0.1:${D.port}/art/${kind}/${id}.png" alt="" loading="lazy">` : `<span class="${cls}"></span>`);
let capturing = null;
const bindBtn = (action) => `<span class="row"><button class="btn sm ${capturing === action ? 'pri' : ''}" data-bind="${action}">${capturing === action ? 'Press a key' : esc(S.hotkeys[action] || 'none')}</button>${S.hotkeys[action] ? `<button class="btn sm" ${A('hotkey.set', { action, key: '' })} aria-label="Clear binding">✕</button>` : ''}${S.hotkeys[action] && (S.hotkeysFailed || []).includes(S.hotkeys[action]) ? '<span class="bad">not active</span>' : ''}</span>`;
function tokenFromCode(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code;
  if (/^Numpad\d$/.test(code)) return 'num' + code.slice(6);
  return ({ Space: 'Space', Tab: 'Tab', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec', CapsLock: 'Capslock' })[code] || null;
}
function capture(e, token) {
  if (!capturing) return;
  e.preventDefault(); e.stopPropagation();
  if (token) { const mods = (e.ctrlKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : ''); api.act('hotkey.set', { action: capturing, key: mods + token }); }
  capturing = null; panel(true);
}
document.addEventListener('keydown', (e) => { if (!capturing) return; if (e.key === 'Escape') return capture(e, null); if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return; const t = tokenFromCode(e.code); if (t) capture(e, t); }, true);
document.addEventListener('mousedown', (e) => { if (capturing && [1, 3, 4].includes(e.button)) capture(e, 'Mouse' + ({ 1: 3, 3: 4, 4: 5 })[e.button]); }, true);
const opt = (v, label, sel) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${label}</option>`;

function overlayCard(id) {
  const o = S.overlays[id]; const url = `http://127.0.0.1:${D.port}/overlay/${id}`;
  return `<div class="card">
    <h2>Overlay</h2>
    <div class="preview"><iframe src="${url}" title="Overlay preview"></iframe></div>
    <div class="row">
      <button class="btn ${o.open ? '' : 'pri'}" ${A('overlay.toggle', { id })}>${o.open ? 'Hide overlay' : 'Show on screen'}</button>
      ${id === 'crosshair' ? '' : `<button class="btn" ${A('overlay.set', { id, locked: !o.locked })}>${o.locked ? 'Unlock to move' : 'Lock (click-through)'}</button>`}
    </div>
    <div class="row">
      <label for="oc">Color</label><input id="oc" type="color" value="${o.color}" ${B('overlay.set', 'color', { id })}>
      <label for="os">Size</label><input id="os" type="range" min="0.5" max="2.5" step="0.05" value="${o.scale}" ${B('overlay.set', 'scale', { id })}>
      <label for="oo">Opacity</label><input id="oo" type="range" min="0.2" max="1" step="0.05" value="${o.opacity}" ${B('overlay.set', 'opacity', { id })}>
    </div>
    <div class="field"><span>OBS browser source URL</span>
      <div class="row"><span class="url">${url}</span><button class="btn sm" data-copy="${url}">Copy</button></div></div>
    ${id === 'crosshair' ? '<p class="note">The crosshair sits at the center of the primary display and never takes mouse input.</p>' : '<p class="note">Unlocked: drag the overlay to move it. Use Size to scale it. Lock it before playing.</p>'}
  </div>`;
}

const VIEWS = {
  timer() {
    const t = S.timer;
    const slot = (i) => `<div class="slot ${t.active === i ? 'active' : ''}">
      <input type="text" aria-label="Player ${i + 1} name" value="${esc(t.labels[i])}" data-label="${i}">
      <span class="big" data-slot="${i}">${fmt(slotMs(t.slots[i]))}</span>
      <div class="row"><span class="note">Rounds</span><span class="mid">${t.rounds[i]}</span>
        <button class="btn sm" ${A('timer.round', { slot: i, delta: 1 })}>+</button><button class="btn sm" ${A('timer.round', { slot: i, delta: -1 })}>−</button></div></div>`;
    return ['1v1 Timer', 'Chase timer with one run per player. The longer run wins the round.', `<div class="card">
      <h2>Runs</h2><div class="row">${slot(0)}${slot(1)}</div>
      <div class="row">
        <button class="btn pri" ${A('timer.toggle')}>Start / Stop ${key('timer.toggle')}</button>
        <button class="btn" ${A('timer.switch')}>Switch player ${key('timer.switch')}</button>
        <button class="btn" ${A('timer.penalty')}>Penalty −${(t.penaltyMs || 5000) / 1000} s ${key('timer.penalty')}</button>
        <button class="btn warn" ${A('timer.reset')}>Reset ${key('timer.reset')}</button>
      </div>
      <div class="row"><button class="btn" ${A('timer.scoreRound')}>Score round (longer run wins) ${key('timer.scoreRound')}</button><button class="btn" ${A('timer.newMatch')}>New match</button></div>
      ${(t.history || []).length ? `<table><tr><th>Round</th><th>${esc(t.labels[0])}</th><th>${esc(t.labels[1])}</th><th>Winner</th></tr>${t.history.map((h, i) => `<tr><td>${i + 1}</td><td>${fmt(h.a)}</td><td>${fmt(h.b)}</td><td>${esc(t.labels[h.winner])}</td></tr>`).join('')}</table>` : ''}
      <div class="row"><label for="tl">Layout</label><select id="tl" style="width:auto" ${B('timer.set', 'layout')}>
        ${opt('dual', 'Dual with rounds', t.layout)}${opt('single', 'Single (active player)', t.layout)}${opt('compact', 'Compact', t.layout)}</select></div>
      <div class="row"><label class="row">Warning color <input type="number" min="0" max="120" value="${t.warnSeconds}" ${B('timer.set', 'warnSeconds')}> s before the time to beat</label>
        <label class="row">Penalty <input type="number" min="1" max="60" value="${(t.penaltyMs || 5000) / 1000}" data-penalty> s</label>
        <label><input type="checkbox" ${t.startOnSelect ? 'checked' : ''} ${B('timer.set', 'startOnSelect')}> Selecting a player starts their timer</label></div>
      <p class="note">Penalty deducts out-of-sight time from the active run. More timer keys (one-key start/stop/reset, select player) are in Settings.</p></div>`];
  },
  crosshair() {
    const c = S.crosshair;
    const num = (f, label, min, max) => `<label class="field"><span>${label}</span><input type="number" min="${min}" max="${max}" value="${c[f]}" ${B('crosshair.set', f)}></label>`;
    return ['Crosshair', 'Center-screen mark for ranged killers.', `<div class="card"><h2>Shape</h2>
      <div class="row"><select aria-label="Shape" style="width:auto" ${B('crosshair.set', 'shape')}>
        ${opt('cross', 'Cross', c.shape)}${opt('dot', 'Dot', c.shape)}${opt('circle', 'Circle', c.shape)}${opt('t', 'T', c.shape)}</select>
        <label><input type="checkbox" ${c.dot ? 'checked' : ''} ${B('crosshair.set', 'dot')}> Center dot</label>
        <label><input type="checkbox" ${c.outline ? 'checked' : ''} ${B('crosshair.set', 'outline')}> Black outline</label></div>
      <div class="grid">${num('size', 'Size', 4, 200)}${num('thickness', 'Thickness', 1, 12)}${num('gap', 'Gap', 0, 60)}${num('offsetX', 'Offset X', -300, 300)}${num('offsetY', 'Offset Y', -300, 300)}</div>
      <p class="note">Offsets move the mark for killers whose aim point is off-center.</p></div>`];
  },
  perks() {
    const rows = S.perks.list.map((p) => `<div class="item">
      <input type="checkbox" aria-label="Armed" ${p.armed ? 'checked' : ''} ${B('perks.update', 'armed', { id: p.id })}>
      <input type="text" aria-label="Name" value="${esc(p.name)}" ${B('perks.update', 'name', { id: p.id })}>
      <input type="number" aria-label="Seconds" min="1" max="600" value="${p.seconds}" ${B('perks.update', 'seconds', { id: p.id })}>
      <button class="btn sm" ${A('perks.fire', { id: p.id })}>Fire</button>${bindBtn('perks.fire:' + p.id)}
      <button class="btn sm warn" ${A('perks.remove', { id: p.id })} aria-label="Remove ${esc(p.name)}">✕</button></div>`).join('');
    return ['Perk Timers', 'Tick the perks in play, then fire every armed timer with one hotkey. Each timer ends with its own tone.', `<div class="card">
      <h2>Timers (seconds)</h2><div class="list">${rows}</div>
      <div class="row"><button class="btn pri" ${A('perks.fireAll')}>Fire all armed ${key('perks.fireAll')}</button>
        <button class="btn" ${A('perks.clear')}>Clear ${key('perks.clear')}</button></div>
      <div class="row"><select id="pt-preset" style="width:auto" aria-label="Timer preset">${D.timerPresets.map((p, i) => opt(i, `${esc(p.name)} (${p.seconds} s)`, -1)).join('')}</select><button class="btn" data-form="preset">Add preset</button><button class="btn" ${A('perks.add')}>Add empty timer</button></div>
      <p class="note">Default durations come from community data and may not match the current patch. Edit them here. Timers start by hotkey only; nothing is read from the game.</p></div>`];
  },
  streak() {
    const k = S.streak;
    return ['Streak Counter', 'Current streak, best, and attempt number.', `<div class="card"><h2>Streak</h2>
      <div class="row"><div class="slot active"><span class="note">Current</span><span class="big">${k.current}</span></div>
        <div class="slot"><span class="note">Best</span><span class="big">${k.best}</span></div>
        <div class="slot"><span class="note">Attempt</span><span class="big">${k.attempts}</span></div></div>
      <div class="row"><button class="btn pri" ${A('streak.win')}>Win ${key('streak.win')}</button><button class="btn warn" ${A('streak.loss')}>Loss ${key('streak.loss')}</button>
        <button class="btn" ${A('streak.undo')}>Undo</button><button class="btn" ${A('streak.set', { current: 0, best: 0, attempts: 1, history: [] })}>Reset all</button></div>
      <div class="grid"><label class="field"><span>Overlay label</span><input type="text" value="${esc(k.label)}" ${B('streak.set', 'label')}></label>
        <label class="field"><span>Win rule (your reference)</span><select ${B('streak.set', 'rule')}>${Object.entries(D.rules).map(([v, l]) => opt(v, l, k.rule)).join('')}</select></label></div></div>`];
  },
  perkShuffle() {
    const ps = S.perkShuffle; const name = (id) => (D.perks.find((p) => p.id === id) || {}).name;
    const res = ps.result.map((id, i) => `<div class="result"><span class="row">${art('perks', id, 'pi')}${id ? esc(name(id)) : '<span class="note">empty</span>'}</span>
      <label class="note"><input type="checkbox" ${ps.locked[i] ? 'checked' : ''} data-lock="${i}"> keep</label></div>`).join('');
    const pool = D.perks.filter((p) => p.role === ps.role);
    return ['Perk Shuffle', 'Random loadout of four perks.', `<div class="card"><h2>Loadout</h2>
      <div class="row"><select aria-label="Role" style="width:auto" ${B('perkShuffle.set', 'role')}>${opt('survivor', 'Survivor', ps.role)}${opt('killer', 'Killer', ps.role)}</select>
        <button class="btn pri" ${A('perkShuffle.roll')}>Shuffle ${key('perkShuffle.roll')}</button></div>
      <div class="list">${res}</div></div>
      <div class="card"><h2>Perk pool: ${pool.length - ps.excluded.filter((x) => pool.some((p) => p.id === x)).length} of ${pool.length}</h2>
      <div class="checks">${pool.map((p) => `<label><input type="checkbox" ${ps.excluded.includes(p.id) ? '' : 'checked'} data-pool="perkShuffle" value="${p.id}">${art('perks', p.id, 'pi sm')}${esc(p.name)}</label>`).join('')}</div></div>`];
  },
  killerShuffle() {
    const ks = S.killerShuffle; const all = D.characters.filter((c) => c.role === 'killer');
    const name = (id) => (all.find((c) => c.id === id) || {}).name;
    return ['Killer Shuffle', 'Random killer from your roster.', `<div class="card"><h2>Pick</h2>
      <div class="result"><span class="row">${art('portraits', ks.result, 'portrait')}<span class="mid">${ks.result ? esc(name(ks.result)) : '...'}</span></span></div>
      <div class="row"><button class="btn pri" ${A('killerShuffle.roll')}>Pick killer ${key('killerShuffle.roll')}</button>
        <label><input type="checkbox" ${ks.noRepeat ? 'checked' : ''} ${B('killerShuffle.set', 'noRepeat')}> No repeats until all are played</label>
        ${ks.noRepeat ? `<span class="note">${ks.played.length} of ${all.length - ks.excluded.length} played</span><button class="btn sm" ${A('killerShuffle.resetPlayed')}>Restart cycle</button>` : ''}</div></div>
      <div class="card"><h2>Roster: ${all.length - ks.excluded.length} of ${all.length}</h2>
      <div class="checks">${all.map((c) => `<label><input type="checkbox" ${ks.excluded.includes(c.id) ? '' : 'checked'} data-pool="killerShuffle" value="${c.id}">${art('portraits', c.id, 'portrait sm')}${esc(c.name)}</label>`).join('')}</div></div>`];
  },
  settings() {
    const rows = Object.entries(HOTKEY_LABELS).map(([a, label]) => `<div class="result"><span>${label}</span>${bindBtn(a)}</div>`).join('');
    return ['Settings', 'Global hotkeys and overlay options.', `<div class="card"><h2>Bindings</h2><div class="keys">${rows}</div>
      <p class="note">Click a binding, then press the key or mouse button (middle or side buttons). Esc cancels.</p></div>
      <div class="card"><h2>Input mode</h2>
        <div class="row"><select style="width:auto" aria-label="Input mode" ${B('settings.set', 'inputMode')}>${opt('standard', 'Standard: the key is taken by this app', S.settings.inputMode)}${S.passthroughAvailable ? opt('passthrough', 'Pass-through: the key also reaches the game', S.settings.inputMode) : ''}</select></div>
        <p class="note">Standard works without extra rights, keyboard only. Pass-through lets a key do its game action and trigger the tool at once (for example crouch starts the timer), and allows mouse buttons. If pass-through keys do nothing while the game is focused, run this app as administrator.</p></div>
      <div class="card"><h2>Overlays</h2>
        <label><input type="checkbox" ${S.settings.hideFromCapture ? 'checked' : ''} ${B('settings.set', 'hideFromCapture')}> Hide overlay windows from screen capture and recordings</label>
        <p class="note">With this on, OBS display capture and screenshots do not show the overlays. OBS browser sources are not affected.</p>
        <label><input type="checkbox" ${S.settings.closeToTray ? 'checked' : ''} ${B('settings.set', 'closeToTray')}> Closing the window keeps the app running in the tray</label>
        <label><input type="checkbox" ${S.settings.overlaysHidden ? 'checked' : ''} ${B('settings.set', 'overlaysHidden')}> Hide all overlays ${key('overlays.toggleAll')}</label></div>
      <div class="card"><h2>Backup</h2>
        <p class="note">Builds, rulesets, stats, streaks, layouts and hotkeys. Use it to move to another computer or share a setup.</p>
        <div class="row"><button class="btn" data-form="backup">Copy backup to clipboard</button></div>
        <textarea id="bk-json" rows="2" placeholder="Paste a backup here" aria-label="Backup text"></textarea>
        <div class="row"><button class="btn warn" data-form="restore">Restore (replaces current data)</button>${backupMsg ? `<span class="note">${esc(backupMsg)}</span>` : ''}</div></div>`];
  },
};

function rail() {
  let g = ''; let h = '<div class="brand">DBD Overlay</div>';
  for (const t of TOOLS) {
    if (t.g !== g) { g = t.g; h += `<div class="grp">${g}</div>`; }
    const on = S.overlays[t.id] && S.overlays[t.id].open ? '<span class="on" title="Overlay shown"></span>' : '';
    h += `<button data-tool="${t.id}" aria-current="${t.id === cur}" ${t.soon ? 'disabled title="Planned"' : ''}>${t.name}${t.soon ? '<span class="note">soon</span>' : on}</button>`;
  }
  $('#rail').innerHTML = h;
}
function panel(force) {
  const el = document.activeElement;
  if (!force && el && $('#panel').contains(el) && /INPUT|SELECT|TEXTAREA/.test(el.tagName) && el.type !== 'checkbox') return; // do not interrupt editing
  const [title, sub, body] = VIEWS[cur]();
  const scroll = $('#panel').scrollTop;
  const frame = $('#panel iframe');
  $('#panel').innerHTML = `<div><h1>${title}</h1><p class="sub">${sub}</p></div>` +
    (S.overlays[cur] ? `<div class="cols"><div class="list" style="gap:16px">${body}</div>${overlayCard(cur)}</div>` : body);
  // Keep the same preview frame alive across re-renders so it does not flicker.
  const next = $('#panel iframe');
  if (frame && next && frame.src === next.src) next.replaceWith(frame);
  $('#panel').scrollTop = scroll;
}

document.addEventListener('click', (e) => {
  const bind = e.target.closest('[data-bind]');
  if (bind) { capturing = capturing === bind.dataset.bind ? null : bind.dataset.bind; panel(true); return; }
  const tool = e.target.closest('[data-tool]');
  if (tool) { cur = tool.dataset.tool; rail(); panel(true); return; }
  const copy = e.target.closest('[data-copy]');
  if (copy) { api.copy(copy.dataset.copy); copy.textContent = 'Copied'; return; }
  const form = e.target.closest('[data-form]');
  if (form) { FORMS[form.dataset.form](); return; }
  const act = e.target.closest('[data-act]');
  if (act) api.act(act.dataset.act, JSON.parse(act.dataset.p));
});
function onInput(e) {
  const t = e.target;
  const val = t.type === 'checkbox' ? t.checked : t.type === 'number' || t.type === 'range' ? Number(t.value) : t.value;
  if (t.dataset.set) {
    if (e.type === 'input' && (t.type === 'text' || t.type === 'number')) return; // commit on change
    api.act(t.dataset.set, { ...JSON.parse(t.dataset.p), [t.dataset.field]: val });
  } else if (e.type !== 'change') {
    return;
  } else if (t.dataset.pick) {
    const d = JSON.parse(t.dataset.pick); const q = String(val).trim().toLowerCase().replace(/\s*\(.*$/, ''); const hit = D.perks.find((p) => p.name.toLowerCase() === q || (p.aka || '').toLowerCase() === q);
    api.act(d.act, { ...d.p, perk: hit ? hit.id : null });
  } else if (t.dataset.label) {
    const labels = [...S.timer.labels]; labels[Number(t.dataset.label)] = val; api.act('timer.set', { labels });
  } else if (t.dataset.lock) {
    const locked = [...S.perkShuffle.locked]; locked[Number(t.dataset.lock)] = val; api.act('perkShuffle.set', { locked });
  } else if (t.dataset.pool) {
    const ex = new Set(S[t.dataset.pool].excluded); if (val) ex.delete(t.value); else ex.add(t.value);
    api.act(t.dataset.pool + '.set', { excluded: [...ex] });
  } else if (t.dataset.hotkey) {
    api.act('hotkey.set', { action: t.dataset.hotkey, key: val.trim() }); t.blur();
  }
}
document.addEventListener('input', onInput);
document.addEventListener('change', onInput);
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur(); });
setInterval(() => { if (cur === 'timer' && S) document.querySelectorAll('[data-slot]').forEach((n) => { n.textContent = fmt(slotMs(S.timer.slots[Number(n.dataset.slot)])); }); }, 100);

api.init().then((init) => {
  D = init; S = init.state; rail(); panel(true);
  api.onState((s) => { S = s; rail(); panel(false); });
});

// ---- phase 3 views
const pname = (id) => (D.perks.find((p) => p.id === id) || {}).name || '';
const cname = (id) => (D.characters.find((c) => c.id === id) || {}).name || '';
const pick = (act, p, value, role) => `<div class="pick">${art('perks', value, 'pi')}<input type="text" list="dl-${role}" placeholder="Perk name" aria-label="Perk" value="${esc(pname(value))}" data-pick='${esc(JSON.stringify({ act, p }))}'></div>`;
const lists = () => ['survivor', 'killer'].map((r) => `<datalist id="dl-${r}">${D.perks.filter((p) => p.role === r).map((p) => `<option value="${esc(p.name)}">${p.aka ? esc('was ' + p.aka) : ''}</option>${p.aka ? `<option value="${esc(p.aka)}">${esc('now ' + p.name)}</option>` : ''}`).join('')}</datalist>`).join('');
const charOpts = (role, sel) => opt('', role === 'killer' ? 'Any killer' : 'Any', sel || '') + D.characters.filter((c) => c.role === role).map((c) => opt(c.id, esc(c.name), sel)).join('');
const issuesHtml = (list, rs) => (!rs ? '<span class="note">No ruleset selected</span>' : list.length ? list.map((x) => `<span class="bad">${esc(x)}</span>`).join('<br>') : `<span class="good">Legal under ${esc(rs)}</span>`);
const val = (id) => ($('#' + id) ? $('#' + id).value : '');
const LEAGUES = { list: null, msg: '', bad: false };
let backupMsg = '';
const FORMS = {
  backup() { const { derived, calloutIds, gameRunning, hotkeysFailed, passthroughAvailable, ...rest } = S; api.copy(JSON.stringify(rest)); backupMsg = 'Copied to clipboard. Paste it into a text file to keep it.'; panel(true); },
  async restore() { const r = await api.restore(val('bk-json')); backupMsg = r.error ? 'Restore failed: ' + r.error : 'Restored.'; panel(true); },
  preset() { const p = D.timerPresets[Number(val('pt-preset'))]; if (p) api.act('perks.add', p); },
  async leagues() { LEAGUES.msg = 'Loading'; panel(true); const r = await api.leagues(); LEAGUES.list = r.list || null; LEAGUES.bad = Boolean(r.error); LEAGUES.msg = r.error ? 'Could not load: ' + r.error : ''; panel(true); },
  async league() { const p = val('lg-preset'); LEAGUES.msg = 'Importing'; panel(true); const r = await api.importLeague(p); LEAGUES.bad = Boolean(r.error); LEAGUES.msg = r.error ? 'Import failed: ' + r.error : 'Imported'; panel(true); },
  rules() { api.act('rules.import', { json: val('rs-json') }); },
  rule() { api.act('challenge.addRule', { text: val('ch-rule') }); panel(true); },
  stats() { api.act('stats.add', { role: val('st-role'), character: val('st-char'), map: val('st-map'), result: val('st-result'), stages: val('st-stages'), gensLeft: val('st-gens'), kills: val('st-kills'), streak: $('#st-streak').checked, challenge: $('#st-chal').checked }); },
  export() { api.copy(JSON.stringify(S.stats.matches)); },
  member() { api.act('league.add', { name: val('lg-name'), role: val('lg-role'), team: val('lg-team') }); panel(true); },
  folder() { api.callouts('open'); },
  download() { api.callouts('download'); },
  rescan() { api.callouts('scan'); },
  detect() { api.detect(); },
};

Object.assign(VIEWS, {
  builds() {
    const b = S.builds; const rs = S.rulesets.list.find((r) => r.id === b.rulesetId);
    const cards = b.list.map((x) => `<div class="card ${x.id === b.activeId ? 'sel' : ''}">
      <div class="row"><input type="text" style="flex:1;width:auto" aria-label="Build name" value="${esc(x.name)}" ${B('builds.update', 'name', { id: x.id })}>
        <select style="width:auto" aria-label="Role" ${B('builds.update', 'role', { id: x.id })}>${opt('survivor', 'Survivor', x.role)}${opt('killer', 'Killer', x.role)}</select>
        ${x.role === 'killer' ? `<select style="width:auto" aria-label="Killer" ${B('builds.update', 'killer', { id: x.id })}>${charOpts('killer', x.killer)}</select>` : ''}</div>
      <div class="grid2">${x.perks.map((p, i) => pick('builds.setPerk', { id: x.id, slot: i }, p, x.role)).join('')}</div>
      <div class="row"><input type="text" style="flex:1;width:auto" placeholder="Tags: map, league, opponent" aria-label="Tags" value="${esc(x.tags)}" ${B('builds.update', 'tags', { id: x.id })}></div>
      <div>${issuesHtml(S.derived.buildIssues[x.id] || [], S.derived.ruleset)}</div>
      <div class="row"><button class="btn sm ${x.id === b.activeId ? '' : 'pri'}" ${A('builds.set', { activeId: x.id })}>${x.id === b.activeId ? 'On overlay' : 'Show on overlay'}</button>
        <button class="btn sm warn" ${A('builds.remove', { id: x.id })}>Delete</button></div></div>`).join('');
    const kinfo = rs && rs.killers && b.vsKiller ? rs.killers[b.vsKiller] : null;
    const custom = rs && !rs.source;
    const bans = !rs ? '' : `${custom ? `<label class="field"><span>Name</span><input type="text" value="${esc(rs.name)}" ${B('rules.update', 'name', { id: rs.id })}></label>
        <div class="row"><label><input type="checkbox" ${rs.uniquePerTeam ? 'checked' : ''} ${B('rules.update', 'uniquePerTeam', { id: rs.id })}> One copy of each perk per team</label>
        <label class="row">Exhaustion perk limit <input type="number" min="0" max="4" value="${rs.maxExhaustion}" ${B('rules.update', 'maxExhaustion', { id: rs.id })}></label></div>` : `<p class="note">Imported from ${esc(rs.source)}${rs.updated ? ', updated ' + new Date(rs.updated * 1000).toLocaleDateString() : ''}. ${rs.banned.length} survivor perks and ${(rs.killerBanned || []).length} killer perks banned for every killer${rs.maxRepetition ? `, each perk at most ${rs.maxRepetition} per team` : ''}. Import again to update.</p>`}
      ${rs.killers && Object.keys(rs.killers).length ? `<div class="row"><label class="row">Check against killer <select style="width:auto" ${B('builds.set', 'vsKiller')}>${opt('', 'General rules only', b.vsKiller || '')}${Object.entries(rs.killers).sort((x, y) => x[1].name.localeCompare(y[1].name)).map(([id, k]) => opt(id, esc(k.name) + (k.disabled ? ' (not allowed)' : ''), b.vsKiller)).join('')}</select></label></div>` : ''}
      ${kinfo ? `<div class="result"><span class="row">${art('portraits', b.vsKiller, 'portrait')}<span><strong>${esc(kinfo.name)}</strong>${kinfo.disabled ? ' <span class="bad">not allowed</span>' : ''}<br><span class="note">${kinfo.tiers.length ? esc(kinfo.tiers.join(', ')) + '. ' : ''}Maps: ${esc(kinfo.maps.join(', ') || 'not set')}. ${kinfo.survBanned.length} more survivor bans, ${kinfo.killerBanned.length} more killer bans.</span>${kinfo.notes ? `<br><span class="note">${esc(kinfo.notes.slice(0, 300))}</span>` : ''}</span></span></div>` : ''}
      ${rs.source ? (() => { const sv = [...new Set([...(rs.banned || []), ...(kinfo ? kinfo.survBanned : [])])].filter((p) => !(kinfo && kinfo.survWhitelist.includes(p))); const kl = [...new Set([...(rs.killerBanned || []), ...(kinfo ? kinfo.killerBanned : [])])].filter((p) => !(kinfo && kinfo.killerWhitelist.includes(p)));
        const grid = (ids) => `<div class="icons">${ids.map((p) => `<span title="${esc(pname(p))}">${art('perks', p, 'pi sm')}</span>`).join('')}</div>`;
        return `<details><summary>Banned survivor perks${kinfo ? ' vs ' + esc(kinfo.name) : ''}: ${sv.length}</summary>${grid(sv)}</details><details><summary>Banned killer perks${kinfo ? ' on ' + esc(kinfo.name) : ''}: ${kl.length}</summary>${grid(kl)}</details>`; })() : ''}
      <div class="row"><button class="btn sm warn" ${A('rules.remove', { id: rs.id })}>Delete ruleset</button></div>
      ${custom ? `<p class="note">Banned survivor perks: ${rs.banned.length}. Zero for the exhaustion limit means no limit.</p>
      <div class="checks">${D.perks.map((p) => `<label><input type="checkbox" ${rs.banned.includes(p.id) ? 'checked' : ''} data-ban="${rs.id}" value="${p.id}">${art('perks', p.id, 'pi sm')}${esc(p.name)}</label>`).join('')}</div>` : ''}`;
    return ['Build Library', 'Saved builds, checked against a league ruleset.', `${lists()}
      <div class="row"><button class="btn pri" ${A('builds.add', { role: 'survivor' })}>New survivor build</button><button class="btn" ${A('builds.add', { role: 'killer' })}>New killer build</button></div>
      ${cards || '<p class="note">No builds yet.</p>'}
      <div class="card"><h2>Ruleset</h2>
        <div class="row"><select style="width:auto" aria-label="Active ruleset" ${B('builds.set', 'rulesetId')}>${opt('', 'None', b.rulesetId || '')}${S.rulesets.list.map((r) => opt(r.id, esc(r.name), b.rulesetId)).join('')}</select>
          <button class="btn" ${A('rules.add')}>New ruleset</button></div>
        ${bans}
        <div class="field"><span>League presets from balancedbydaylight.com (DBDLeague, Champions of the Fog, DBDRanked and others)</span>
          <div class="row">${LEAGUES.list ? `<select id="lg-preset" style="width:auto;max-width:320px" aria-label="League preset">${LEAGUES.list.map((p) => opt(p.path, esc(p.name), '')).join('')}</select><button class="btn pri" data-form="league">Import preset</button>` : `<button class="btn" data-form="leagues">Load preset list</button>`}
          ${LEAGUES.msg ? `<span class="${LEAGUES.bad ? 'bad' : 'note'}">${esc(LEAGUES.msg)}</span>` : ''}</div></div>
        <div class="field"><span>Import ruleset (JSON): {"name": "...", "banned": ["Perk name"], "uniquePerTeam": true, "maxExhaustion": 1}</span>
          <textarea id="rs-json" rows="3"></textarea></div>
        <div class="row"><button class="btn" data-form="rules">Import</button></div></div>`];
  },
  lobby() {
    const rows = S.lobby.survivors.map((v, i) => `<div class="card">
      <div class="row"><input type="text" style="flex:1;width:auto" aria-label="Survivor name" value="${esc(v.name)}" data-lobbyname="${i}">
        <select style="width:auto" aria-label="Load build" data-lobbybuild="${i}">${opt('', 'Load build...', '')}${S.builds.list.filter((b) => b.role === 'survivor').map((b) => opt(b.id, esc(b.name), '')).join('')}</select></div>
      <div class="grid2">${v.perks.map((p, s) => pick('lobby.setPerk', { i, slot: s }, p, 'survivor')).join('')}</div></div>`).join('');
    return ['Lobby Perks', 'The four survivors\' perks, for stream or scrim review.', `${lists()}${rows}
      <div class="card"><h2>Team check</h2><div>${issuesHtml(S.derived.lobbyIssues, S.derived.ruleset)}</div>
        <div class="row"><button class="btn warn" ${A('lobby.clear')}>Clear all</button></div>
        <p class="note">The ruleset is chosen in Build Library. Entry is manual in this version.</p></div>`];
  },
  score() {
    const sc = S.score; const c = sc.current; const d = S.derived.score;
    const bump = (f, label, max) => `<div class="slot"><span class="note">${label}</span><span class="big">${c[f]}<span class="note"> / ${max}</span></span>
      <div class="row"><button class="btn sm" ${A('score.bump', { field: f, delta: -1 })}>−</button><button class="btn sm pri" ${A('score.bump', { field: f, delta: 1 })}>+</button></div></div>`;
    const hist = d.history.map((h, i) => `<tr><td>${sc.mode === 'target' ? 'Game' : 'Set'} ${i + 1}</td>${h.games.map((g) => `<td>${esc(sc.teams[g.killerTeam])} as ${esc(cname(g.killer) || 'killer')}: ${g.stages} stages, ${g.gensLeft} gens left, ${g.kills} kills</td>`).join('')}<td>${h.winner === null ? 'Tie' : esc(sc.teams[h.winner])}</td></tr>`).join('');
    return ['Match Scoreboard', 'Broadcast scoreboard. A set is two games, one per team as killer. More hook stages wins, then more gens left, then more kills.', `<div class="card"><h2>Match</h2>
        <div class="row"><input type="text" style="width:170px" aria-label="Team 1" value="${esc(sc.teams[0])}" data-team="0"><span class="big">${d.sets[0]} : ${d.sets[1]}</span><input type="text" style="width:170px" aria-label="Team 2" value="${esc(sc.teams[1])}" data-team="1">
          <label class="row">Best of <select style="width:auto" ${B('score.set', 'bestOf')}>${[1, 3, 5, 7, 9].map((n) => opt(n, n, sc.bestOf)).join('')}</select></label></div>
        <div class="row"><label class="row">Format <select style="width:auto" ${B('score.set', 'mode')}>${opt('mirror', 'Mirror: both teams play killer, results compared', sc.mode)}${opt('target', 'Target: killer must reach a win condition', sc.mode)}</select></label>
          ${sc.mode === 'target' ? `<select style="width:auto" aria-label="Win condition" ${B('score.set', 'targetType')}>${opt('stages', 'Hook stages', sc.targetType)}${opt('4k', '4 kills with gens left', sc.targetType)}</select>
            ${sc.targetType === '4k' ? `<label class="row">Gens left at least <input type="number" min="0" max="5" value="${sc.targetGens}" ${B('score.set', 'targetGens')}></label>` : `<label class="row">Stages needed <input type="number" min="1" max="12" value="${sc.targetStages}" ${B('score.set', 'targetStages')}></label>`}` : ''}</div>
        ${d.champion !== null ? `<p class="good">Winner: ${esc(sc.teams[d.champion])}</p>` : ''}</div>
      <div class="card"><h2>Current game</h2>
        <div class="row"><label class="row">Killer side <select style="width:auto" data-killerteam>${opt(0, esc(sc.teams[0]), c.killerTeam)}${opt(1, esc(sc.teams[1]), c.killerTeam)}</select></label>
          <select style="width:auto" aria-label="Killer" ${B('score.current', 'killer')}>${charOpts('killer', c.killer)}</select>
          ${d.pending ? `<span class="note">To beat: ${d.pending.stages} stages, ${d.pending.gensLeft} gens left</span>` : ''}</div>
        <div class="row">${(c.hooks || [0, 0, 0, 0]).map((h, i) => `<div class="slot ${h === 3 ? 'dead' : ''}"><span class="note">${esc(S.lobby.survivors[i].name)}</span>
            <span class="pips">${[1, 2, 3].map((n) => `<i class="${h >= n ? 'on' : ''}"></i>`).join('')}</span>
            <div class="row"><button class="btn sm" ${A('score.hook', { i, delta: -1 })}>−</button><button class="btn sm pri" ${A('score.hook', { i, delta: 1 })}>Hook</button><button class="btn sm warn" ${A('score.hook', { i, dead: true })}>Dead</button></div></div>`).join('')}</div>
        <div class="row"><div class="slot"><span class="note">Hook stages</span><span class="big">${c.stages}<span class="note"> / 12</span></span></div>${bump('gensLeft', 'Gens left', 5)}<div class="slot"><span class="note">Kills</span><span class="big">${c.kills}<span class="note"> / 4</span></span></div></div>
        <div class="row"><button class="btn pri" ${A('score.endGame')}>End game</button><button class="btn" ${A('score.undoGame')}>Undo last game</button><button class="btn warn" ${A('score.reset')}>Reset match</button></div>
        <div class="row"><span class="note">Disconnect</span><button class="btn sm" ${A('score.dc', { side: 'killer' })}>Killer left (0 gens left)</button><button class="btn sm" ${A('score.dc', { side: 'survivor' })}>Survivor left (12 stages, 4 kills)</button></div>
        <p class="note">Press Hook each time a survivor is hooked or reaches the next stage. Dead sets a survivor to 3 stages. Survivor names come from Lobby Perks.</p></div>
      ${hist ? `<div class="card"><h2>Sets</h2><table>${hist}</table></div>` : ''}`];
  },
  stats() {
    const d = S.derived.stats; const role = S._statRole || 'killer';
    const rows = d.by.map((r) => `<tr><td><span class="row">${art('portraits', r.key, 'portrait sm')}${esc(cname(r.key) || r.key)}</span></td><td>${r.played}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.draws}</td><td>${r.rate}%</td></tr>`).join('');
    const recent = S.stats.matches.slice(-8).reverse().map((m) => `<tr><td>${new Date(m.ts).toLocaleDateString()}</td><td>${esc(cname(m.character) || m.role)}</td><td>${esc(m.map)}</td><td>${m.result}</td><td>${m.stages}</td><td>${m.gensLeft}</td><td>${m.kills}</td><td><button class="btn sm warn" ${A('stats.remove', { ts: m.ts })} aria-label="Remove match">✕</button></td></tr>`).join('');
    return ['Statistics', 'Local match log. Stored on this computer only.', `<div class="card"><h2>Add match</h2>
        <div class="grid"><label class="field"><span>Role</span><select id="st-role">${opt('killer', 'Killer', role)}${opt('survivor', 'Survivor', role)}</select></label>
          <label class="field"><span>Character</span><select id="st-char">${opt('', 'Not set', '')}${D.characters.map((c) => opt(c.id, esc(c.name), '')).join('')}</select></label>
          <label class="field"><span>Map</span><input type="text" id="st-map" list="dl-maps" value="${esc((D.maps.find((x) => x.id === S.map.current) || {}).name || '')}"><datalist id="dl-maps">${D.maps.map((x) => `<option value="${esc(x.name)}">`).join('')}</datalist></label>
          <label class="field"><span>Result</span><select id="st-result">${opt('win', 'Win', 'win')}${opt('loss', 'Loss', '')}${opt('draw', 'Draw', '')}</select></label>
          <label class="field"><span>Hook stages</span><input type="number" id="st-stages" min="0" max="12" value="0"></label>
          <label class="field"><span>Gens left</span><input type="number" id="st-gens" min="0" max="5" value="0"></label>
          <label class="field"><span>Kills</span><input type="number" id="st-kills" min="0" max="4" value="0"></label></div>
        <div class="row"><label><input type="checkbox" id="st-streak" checked> Count toward streak</label><label><input type="checkbox" id="st-chal"> Count toward challenge</label></div>
        <div class="row"><button class="btn pri" data-form="stats">Add match</button><button class="btn" data-form="export">Copy all as JSON</button></div></div>
      <div class="card"><h2>Record: ${d.total.wins} W, ${d.total.losses} L, ${d.total.draws} D (${d.total.rate}%)</h2>
        ${rows ? `<table><tr><th>Character</th><th>Played</th><th>W</th><th>L</th><th>D</th><th>Win rate</th></tr>${rows}</table>` : '<p class="note">No matches logged.</p>'}</div>
      ${d.byMap.length ? `<div class="card"><h2>By map</h2><table><tr><th>Map</th><th>Played</th><th>W</th><th>L</th><th>D</th><th>Win rate</th><th>Avg stages</th></tr>${d.byMap.map((r) => `<tr><td>${esc(r.key)}</td><td>${r.played}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.draws}</td><td>${r.rate}%</td><td>${r.avgStages}</td></tr>`).join('')}</table></div>` : ''}
      ${recent ? `<div class="card"><h2>Recent</h2><table><tr><th>Date</th><th>Character</th><th>Map</th><th>Result</th><th>Stages</th><th>Gens</th><th>Kills</th><th></th></tr>${recent}</table></div>` : ''}`];
  },
  challenge() {
    const c = S.challenge;
    return ['Challenges', 'Long runs with rules that stack across matches.', `<div class="card"><h2>Run</h2>
        <div class="row"><input type="text" style="flex:1;width:auto" aria-label="Challenge name" value="${esc(c.name)}" ${B('challenge.set', 'name')}>
          <label class="row">Target wins <input type="number" min="0" max="999" value="${c.target}" ${B('challenge.set', 'target')}></label></div>
        <div class="row"><div class="slot active"><span class="note">Wins</span><span class="big">${c.wins}</span></div><div class="slot"><span class="note">Played</span><span class="big">${c.played}</span></div></div>
        <div class="row"><button class="btn pri" ${A('challenge.result', { win: true })}>Win</button><button class="btn warn" ${A('challenge.result', { win: false })}>Loss</button><button class="btn" ${A('challenge.reset')}>Reset progress</button></div></div>
      <div class="card"><h2>Rules</h2>
        <div class="list">${c.rules.map((r, i) => `<div class="result"><span>${esc(r)}</span><button class="btn sm warn" ${A('challenge.removeRule', { i })} aria-label="Remove rule">✕</button></div>`).join('') || '<p class="note">No rules.</p>'}</div>
        <div class="row"><input type="text" id="ch-rule" style="flex:1;width:auto" placeholder="New rule" aria-label="New rule"><button class="btn" data-form="rule">Add rule</button></div>
        <div class="row"><span class="note">Presets</span>${Object.entries(D.presets).map(([id, p]) => `<button class="btn sm" ${A('challenge.preset', { id })}>${esc(p.name)}</button>`).join('')}</div></div>`];
  },
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.ban) api.act('rules.toggleBan', { id: t.dataset.ban, perk: t.value });
  else if (t.dataset.lobbyname) api.act('lobby.setName', { i: Number(t.dataset.lobbyname), name: t.value });
  else if (t.dataset.lobbybuild && t.value) { api.act('lobby.loadBuild', { i: Number(t.dataset.lobbybuild), id: t.value }); t.blur(); }
  else if (t.dataset.team) { const teams = [...S.score.teams]; teams[Number(t.dataset.team)] = t.value; api.act('score.set', { teams }); }
  else if ('killerteam' in t.dataset) { api.act('score.current', { killerTeam: Number(t.value) }); t.blur(); }
  else if ('mappick' in t.dataset) { api.act('map.pick', { id: t.value }); t.blur(); }
  else if ('penalty' in t.dataset) api.act('timer.set', { penaltyMs: Math.max(1, Number(t.value)) * 1000 });
  else if (t.id === 'st-role') S._statRole = t.value;
});

VIEWS.map = () => {
  const m = S.map; const realms = [...new Set(D.maps.map((x) => x.realm))];
  const has = (id) => (S.calloutIds || []).includes(id);
  const cur = D.maps.find((x) => x.id === m.current);
  const fam = cur ? D.maps.filter((x) => x.family === cur.family) : [];
  const opts = opt('', 'No map', m.current || '') + realms.map((r) => `<optgroup label="${esc(r)}">${D.maps.filter((x) => x.realm === r).map((x) => opt(x.id, esc(x.name) + (has(x.id) ? '' : ' (no image)'), m.current)).join('')}</optgroup>`).join('');
  const missing = D.maps.length - (S.calloutIds || []).length;
  const status = !m.auto ? 'Detection is off. Pick a map below.'
    : m.locked && cur ? `Locked on ${esc(cur.name)}. Unlocks at the end-of-match screen.`
      : S.gameRunning ? 'Waiting for the next map name on screen.' : 'Waiting for Dead by Daylight to start.';
  return ['Map Callouts', 'Clock callouts for the current map: 12 at the top, numbers run clockwise. M = main building, S = shack.', `<div class="card"><h2>Current map</h2>
      <p class="${m.locked ? 'good' : 'note'}">${status}</p>
      <div class="row"><select style="width:auto" aria-label="Map" data-mappick>${opts}</select>
        ${fam.length > 1 ? `<button class="btn" ${A('map.nextVariant')}>Next variant (${fam.indexOf(cur) + 1} of ${fam.length}) ${key('map.nextVariant')}</button>` : ''}
        ${cur ? `<button class="btn" ${A('map.toggleLock')}>${m.locked ? 'Unlock' : 'Lock'} ${key('map.toggleLock')}</button>` : ''}</div></div>
    <div class="card"><h2>Detection</h2>
      <div class="row"><label><input type="checkbox" ${m.auto ? 'checked' : ''} ${B('map.set', 'auto')}> Detect the map from the screen</label>
        <label><input type="checkbox" ${S.settings.onlyWhenGameRuns ? 'checked' : ''} ${B('settings.set', 'onlyWhenGameRuns')}> Only while the game is running</label></div>
      <div class="row"><label class="row">Area read <select style="width:auto" ${B('map.set', 'region')}>${opt('full', 'Whole screen', m.region)}${opt('bottomLeft', 'Bottom left', m.region)}${opt('bottom', 'Bottom strip', m.region)}${opt('center', 'Center', m.region)}</select></label>
        <label class="row">Every <input type="number" min="1" max="10" value="${S.settings.scanSeconds}" ${B('settings.set', 'scanSeconds')}> s</label>
        <button class="btn" data-form="detect">Read screen now</button></div>
      ${m.lastError ? `<p class="bad">${esc(m.lastError)}</p>` : ''}
      <p class="note">Reads the map name shown when a trial loads. The game must run in borderless or windowed mode. The same map must be read twice in a row before it locks. Last text read: ${m.lastText ? `<span class="url">${esc(m.lastText.slice(0, 160))}</span>` : 'none'}</p></div>
    <div class="card"><h2>Callout images: ${(S.calloutIds || []).length} of ${D.maps.length}</h2>
      <div class="row">${missing ? `<button class="btn pri" data-form="download">Download ${missing} images from hens333.com</button>` : ''}
        <button class="btn" data-form="folder">Open callouts folder</button><button class="btn" data-form="rescan">Rescan</button></div>
      ${m.download ? `<p class="note">${esc(m.download)}</p>` : ''}
      <p class="note">Images are Hens' callouts (hens333.com/callouts), map art by Lethia. They belong to their creators and are downloaded to your computer, not shipped with the app. Your own images also work: name the file after the map, for example <kbd>Coal Tower.png</kbd>.</p></div>`];
};

const ROLES = { owner: 'Owner', admin: 'Admin', referee: 'Referee', caster: 'Caster', player: 'Player' };
VIEWS.league = () => {
  const l = S.league;
  const rows = l.members.map((m) => `<tr><td>${esc(m.name)}</td>
    <td>${m.role === 'owner' ? 'Owner' : `<select style="width:auto" aria-label="Role" ${B('league.update', 'role', { id: m.id })}>${Object.entries(ROLES).filter(([r]) => r !== 'owner').map(([r, n]) => opt(r, n, m.role)).join('')}</select>`}</td>
    <td><input type="text" aria-label="Team" value="${esc(m.team)}" ${B('league.update', 'team', { id: m.id })}></td>
    <td>${m.role === 'owner' ? '' : `<span class="row"><button class="btn sm" ${A('league.transfer', { id: m.id })}>Make owner</button><button class="btn sm warn" ${A('league.remove', { id: m.id })}>Remove</button></span>`}</td></tr>`).join('');
  return ['My League', 'Roster and roles. Stored on this computer until a server is connected.', `<div class="card"><h2>League</h2>
      <label class="field"><span>Name</span><input type="text" value="${esc(l.name)}" ${B('league.set', 'name')}></label></div>
    <div class="card"><h2>Members: ${l.members.length}</h2>
      ${rows ? `<table><tr><th>Name</th><th>Role</th><th>Team</th><th></th></tr>${rows}</table>` : '<p class="note">No members. The first member added becomes the owner.</p>'}
      <div class="row"><input type="text" id="lg-name" style="width:180px" placeholder="Name" aria-label="Name">
        <select id="lg-role" style="width:auto" aria-label="Role">${Object.entries(ROLES).filter(([r]) => r !== 'owner').map(([r, n]) => opt(r, n, 'player')).join('')}</select>
        <input type="text" id="lg-team" style="width:140px" placeholder="Team" aria-label="Team"><button class="btn pri" data-form="member">Add member</button></div>
      <p class="note">Profiles, friends, invites and live shared match tracking need accounts and a server. Not connected in this version. See docs/ONLINE.md.</p></div>`];
};

VIEWS.home = () => {
  const rows = TOOLS.filter((t) => S.overlays[t.id]).map((t) => { const o = S.overlays[t.id]; return `<tr>
    <td><button class="btn sm" data-tool="${t.id}">${t.name}</button></td>
    <td><button class="btn sm ${o.open ? 'pri' : ''}" ${A('overlay.toggle', { id: t.id })}>${o.open ? 'Shown' : 'Hidden'}</button></td>
    <td>${t.id === 'crosshair' ? '<span class="note">always click-through</span>' : `<button class="btn sm" ${A('overlay.set', { id: t.id, locked: !o.locked })}>${o.locked ? 'Locked' : 'Movable'}</button>`}</td>
    <td><input type="color" aria-label="${t.name} color" value="${o.color}" ${B('overlay.set', 'color', { id: t.id })}></td>
    <td><input type="range" aria-label="${t.name} size" min="0.5" max="2.5" step="0.05" value="${o.scale}" ${B('overlay.set', 'scale', { id: t.id })}></td></tr>`; }).join('');
  const shown = Object.values(S.overlays).filter((o) => o.open).length;
  return ['Overlays', 'Every overlay in one place. Each one can sit over the game or go into OBS as a browser source.', `<div class="card"><h2>Status</h2>
      <div class="row">${D.platform === 'win32' ? `<span class="${S.gameRunning ? 'good' : 'note'}">${S.gameRunning ? 'Dead by Daylight is running' : 'Dead by Daylight is not running'}</span>` : ''}
        <span class="note">${shown} overlay${shown === 1 ? '' : 's'} shown${S.settings.overlaysHidden ? ', all hidden by hotkey' : ''}</span>
        <span class="note">Input: ${S.settings.inputMode === 'passthrough' ? 'pass-through' : 'standard'}</span></div>
      <div class="row"><button class="btn" ${A('overlays.toggleAll')}>${S.settings.overlaysHidden ? 'Unhide all' : 'Hide all'} ${key('overlays.toggleAll')}</button>
        <button class="btn" ${A('overlays.toggleLock')}>Lock / unlock all ${key('overlays.toggleLock')}</button></div>
      <p class="note">The game must run in borderless or windowed mode for overlays to show on top of it.</p></div>
    <div class="card"><h2>All overlays</h2><table><tr><th>Tool</th><th>On screen</th><th>Position</th><th>Color</th><th>Size</th></tr>${rows}</table></div>
    <div class="card"><h2>About</h2><p class="note">Free and open source (MIT). Not affiliated with Behaviour Interactive. This app reads the screen and never reads game memory or sends input to the game. Behaviour has not published a position on overlay tools: use at your own risk.</p></div>`];
};
