// Main window. Renders the active tool from state; sends actions to the main process.
const TOOLS = [
  { g: 'Play', id: 'timer', name: '1v1 Timer' },
  { g: 'Play', id: 'crosshair', name: 'Crosshair' },
  { g: 'Play', id: 'perks', name: 'Perk Timers' },
  { g: 'Play', id: 'streak', name: 'Streak Counter' },
  { g: 'Play', id: 'perkShuffle', name: 'Perk Shuffle' },
  { g: 'Play', id: 'killerShuffle', name: 'Killer Shuffle' },
  { g: 'Compete', id: 'map', name: 'Map Callouts', soon: true },
  { g: 'Compete', id: 'builds', name: 'Build Library', soon: true },
  { g: 'Compete', id: 'score', name: 'Match Scoreboard', soon: true },
  { g: 'Compete', id: 'lobby', name: 'Lobby Perks', soon: true },
  { g: 'Compete', id: 'stats', name: 'Statistics', soon: true },
  { g: 'Compete', id: 'challenges', name: 'Challenges', soon: true },
  { g: 'App', id: 'settings', name: 'Hotkeys' },
];
const HOTKEY_LABELS = {
  'timer.toggle': 'Timer: start / stop', 'timer.switch': 'Timer: switch player', 'timer.reset': 'Timer: reset',
  'perks.fireAll': 'Perk timers: fire all armed', 'streak.win': 'Streak: win', 'streak.loss': 'Streak: loss',
  'perkShuffle.roll': 'Perk shuffle: roll', 'killerShuffle.roll': 'Killer shuffle: roll', 'overlays.toggleLock': 'Overlays: lock / unlock all',
};

let S = null; let D = null; let cur = 'timer';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const A = (name, payload) => `data-act="${name}" data-p='${esc(JSON.stringify(payload || {}))}'`;
const B = (action, field, extra) => `data-set="${action}" data-field="${field}" data-p='${esc(JSON.stringify(extra || {}))}'`;
const fmt = (ms) => { const s = Math.abs(ms) / 1000; return (ms < 0 ? '-' : '') + Math.floor(s / 60) + ':' + (s % 60).toFixed(1).padStart(4, '0'); };
const slotMs = (x) => x.base + (x.startedAt ? Date.now() - x.startedAt : 0);
const key = (action) => (S.hotkeys[action] ? `<kbd>${esc(S.hotkeys[action])}</kbd>` : '');
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
    ${id === 'crosshair' ? '<p class="note">The crosshair sits at the center of the primary display and never takes mouse input.</p>' : '<p class="note">Unlocked: drag the overlay to move it, drag its edges to resize. Lock it before playing.</p>'}
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
        <button class="btn" ${A('timer.penalty', { ms: 5000 })}>Penalty −5 s</button>
        <button class="btn warn" ${A('timer.reset')}>Reset ${key('timer.reset')}</button>
      </div>
      <div class="row"><label for="tl">Layout</label><select id="tl" style="width:auto" ${B('timer.set', 'layout')}>
        ${opt('dual', 'Dual with rounds', t.layout)}${opt('single', 'Single (active player)', t.layout)}${opt('compact', 'Compact', t.layout)}</select></div>
      <p class="note">Penalty deducts out-of-sight time from the active run.</p></div>`];
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
      <button class="btn sm" ${A('perks.fire', { id: p.id })}>Fire</button>
      <button class="btn sm warn" ${A('perks.remove', { id: p.id })} aria-label="Remove ${esc(p.name)}">✕</button></div>`).join('');
    return ['Perk Timers', 'Tick the perks in play, then fire every armed timer with one hotkey. Each timer ends with its own tone.', `<div class="card">
      <h2>Timers (seconds)</h2><div class="list">${rows}</div>
      <div class="row"><button class="btn pri" ${A('perks.fireAll')}>Fire all armed ${key('perks.fireAll')}</button>
        <button class="btn" ${A('perks.clear')}>Clear</button><button class="btn" ${A('perks.add')}>Add timer</button></div>
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
    const res = ps.result.map((id, i) => `<div class="result"><span>${id ? esc(name(id)) : '<span class="note">empty</span>'}</span>
      <label class="note"><input type="checkbox" ${ps.locked[i] ? 'checked' : ''} data-lock="${i}"> keep</label></div>`).join('');
    const pool = D.perks.filter((p) => p.role === ps.role);
    return ['Perk Shuffle', 'Random loadout of four perks.', `<div class="card"><h2>Loadout</h2>
      <div class="row"><select aria-label="Role" style="width:auto" ${B('perkShuffle.set', 'role')}>${opt('survivor', 'Survivor', ps.role)}${opt('killer', 'Killer', ps.role)}</select>
        <button class="btn pri" ${A('perkShuffle.roll')}>Shuffle ${key('perkShuffle.roll')}</button></div>
      <div class="list">${res}</div></div>
      <div class="card"><h2>Perk pool: ${pool.length - ps.excluded.filter((x) => pool.some((p) => p.id === x)).length} of ${pool.length}</h2>
      <div class="checks">${pool.map((p) => `<label><input type="checkbox" ${ps.excluded.includes(p.id) ? '' : 'checked'} data-pool="perkShuffle" value="${p.id}">${esc(p.name)}</label>`).join('')}</div></div>`];
  },
  killerShuffle() {
    const ks = S.killerShuffle; const all = D.characters.filter((c) => c.role === 'killer');
    const name = (id) => (all.find((c) => c.id === id) || {}).name;
    return ['Killer Shuffle', 'Random killer from your roster.', `<div class="card"><h2>Pick</h2>
      <div class="result"><span class="mid">${ks.result ? esc(name(ks.result)) : '...'}</span></div>
      <div class="row"><button class="btn pri" ${A('killerShuffle.roll')}>Pick killer ${key('killerShuffle.roll')}</button>
        <label><input type="checkbox" ${ks.noRepeat ? 'checked' : ''} ${B('killerShuffle.set', 'noRepeat')}> No repeats until all are played</label>
        ${ks.noRepeat ? `<span class="note">${ks.played.length} of ${all.length - ks.excluded.length} played</span><button class="btn sm" ${A('killerShuffle.resetPlayed')}>Restart cycle</button>` : ''}</div></div>
      <div class="card"><h2>Roster: ${all.length - ks.excluded.length} of ${all.length}</h2>
      <div class="checks">${all.map((c) => `<label><input type="checkbox" ${ks.excluded.includes(c.id) ? '' : 'checked'} data-pool="killerShuffle" value="${c.id}">${esc(c.name)}</label>`).join('')}</div></div>`];
  },
  settings() {
    const rows = Object.entries(HOTKEY_LABELS).map(([a, label]) => `<div class="result"><span>${label}</span>
      <span class="row"><input type="text" style="width:150px" aria-label="${label}" value="${esc(S.hotkeys[a] || '')}" placeholder="none" data-hotkey="${a}">
      ${(S.hotkeysFailed || []).includes(S.hotkeys[a]) ? '<span class="bad">not registered</span>' : ''}</span></div>`).join('');
    return ['Hotkeys', 'Global keys, active while the game is focused.', `<div class="card"><h2>Bindings</h2><div class="list">${rows}</div>
      <p class="note">Format examples: <kbd>F1</kbd> <kbd>Alt+1</kbd> <kbd>Ctrl+Shift+T</kbd> <kbd>num1</kbd>. Leave empty for none. Press Enter to apply.</p>
      <p class="note">A bound key is taken by this app and does not reach the game.</p></div>`];
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
  if (!force && el && $('#panel').contains(el) && /INPUT|SELECT/.test(el.tagName) && el.type !== 'checkbox') return; // do not interrupt editing
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
  const tool = e.target.closest('[data-tool]');
  if (tool) { cur = tool.dataset.tool; rail(); panel(true); return; }
  const copy = e.target.closest('[data-copy]');
  if (copy) { api.copy(copy.dataset.copy); copy.textContent = 'Copied'; return; }
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
